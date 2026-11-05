import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import state from '../state/index.js';
import loadSystemConfig, { updateSystemConfig } from '../utils/systemConfig.js';
import { askLine, askYesNo, hasTerminal } from '../utils/ask.js';
import openUrl from '../utils/openUrl.js';
import { readSecret, storeSecret } from '../utils/keychain.js';
import { entry, writeOption } from '../utils/configWriter.js';
import { readAppIcon, windowsIcon } from '../utils/appIcon.js';
import {
    PRIVACY_CATEGORIES, appCategory, appDisplayName, appEncryption, appId, appPrivacy, appUpdater, appUrlSchemes,
} from '../utils/appOptions.js';
import { isJsonValue } from '../utils/appExtensions.js';
import { unreasonedImports } from '../utils/requiredReasonApis.js';
import { resolveHermesDsym } from '../utils/hermes.js';
import { imageRoleFor } from '../utils/pullDockerImage.js';
import { isUnderBase } from '../utils/replaceBasePathForDocker.js';
import {
    androidAppId, androidVersion, appBuildNumber, appTeam, appVersion,
} from './buildApp.js';
import runTool from './run.js';
import { makeUploadKey, releaseSigningEnv } from './uploadKey.js';
import { appStoreKey } from './appleSigning.js';
import { inWindowsImage, jsignScript, windowsSigning } from './windowsSigning.js';
import { xcodebuild, xcodeTeams } from './xcodebuild.js';

// The api an extension's build-side code gets in place of crossbind's own modules, which it never imports: what the run
// is, the project and its app as the build reads them, the terminal, this machine's settings and keychain, and the
// signing and tools crossbind builds and packages each platform's apps with.

const PATH_PART = /^[A-Za-z_$][\w$]*$/;
const SETTING = /^[A-Z][A-Z0-9_]*$/;
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function refuse() {
    throw new TypeError('crossbind: api.config is read-only: api.config.write writes an option into crossbind.config.js.');
}

const views = new WeakMap();
const READ_ONLY = {
    get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        const own = Reflect.getOwnPropertyDescriptor(target, key);
        // A proxy gives a property that never changes as it is.
        if (own && !own.configurable && !own.writable) return value;
        return readOnly(value);
    },
    // A configurable property's value is a view too; one that never changes is given as it is, as a proxy must.
    getOwnPropertyDescriptor(target, key) {
        const own = Reflect.getOwnPropertyDescriptor(target, key);
        return own?.configurable && 'value' in own ? { ...own, value: readOnly(own.value) } : own;
    },
    set: refuse,
    defineProperty: refuse,
    deleteProperty: refuse,
    setPrototypeOf: refuse,
    preventExtensions: refuse,
};

function readOnly(value) {
    if (value === null || typeof value !== 'object') return value;
    if (!views.has(value)) views.set(value, new Proxy(value, READ_ONLY));
    return views.get(value);
}

const deepFrozen = (value) => {
    if (value !== null && typeof value === 'object') Object.values(value).forEach(deepFrozen);
    return Object.freeze(value);
};

const valueAt = (object, keys) => keys.reduce((value, key) => (isObject(value) ? value[key] : undefined), object);
const withValue = (object, [key, ...rest], value) => ({ ...object, [key]: rest.length === 0 ? value : withValue(isObject(object?.[key]) ? object[key] : {}, rest, value) });

// What crossbind checks of an option written into crossbind.config.js, as its builds read it.
const OPTION_CHECKS = {
    'app.id': (config, platform) => (platform === 'android' ? androidAppId(config) : appId(config)),
    'app.name': appDisplayName,
    'app.icon': readAppIcon,
    'app.encryption': appEncryption,
    'app.privacy': appPrivacy,
    'app.updater': appUpdater,
};

// Writes an option into crossbind.config.js once the user says yes on a terminal, and into this run's config. One the
// config sets already is the user's to change, and one the builds would refuse fails as invalid, for the caller to ask
// again.
async function writeConfig(name, platform, key, value) {
    const keys = typeof key === 'string' ? key.split('.') : [];
    if (keys.length === 0 || !keys.every((part) => PATH_PART.test(part))) throw new Error(`crossbind: ${name} names ${JSON.stringify(key)}, which is no option of crossbind.config.js, as 'app.id' is.`);
    if (!isJsonValue(value)) throw new Error(`crossbind: ${name} gives ${key} a value that is no JSON value, which is all crossbind writes into crossbind.config.js.`);
    // A copy of its own, as the value may hold the api's views of the config.
    const plain = JSON.parse(JSON.stringify(value));
    const text = `${keys.slice(0, -1).map((part) => `${part}.`).join('')}${entry(keys.at(-1), plain)}`;
    if (valueAt(state.config, keys) !== undefined) throw new Error(`crossbind: set ${text} in crossbind.config.js in place of the ${key} there.`);
    const changed = withValue(state.config, keys, plain);
    try {
        OPTION_CHECKS[key]?.(changed, platform);
    } catch (error) {
        throw Object.assign(error, { isInvalid: true });
    }
    if (!hasTerminal()) throw new Error(`crossbind: ${name} would write ${text} into crossbind.config.js, which takes a yes on a terminal: set it there yourself.`);
    if (!await askYesNo(`Write ${text} into crossbind.config.js? [Y/n] `)) throw new Error(`crossbind: set ${text} in crossbind.config.js.`);
    if (!writeOption(state.config.paths.project, keys, plain)) {
        throw new Error(`crossbind: crossbind.config.js is no config crossbind can write ${key} into safely: set ${text} in it yourself.`);
    }
    state.config[keys[0]] = changed[keys[0]];
}

function settingsOf(name) {
    return Object.freeze({
        get: (key) => state.config.system[key],
        set(values) {
            if (!isObject(values) || !Object.entries(values).every(([key, value]) => SETTING.test(key) && typeof value === 'string')) {
                throw new Error(`crossbind: ${name} sets settings that are no object of this machine's settings, each an uppercase name with a string.`);
            }
            updateSystemConfig(values);
            state.config.system = loadSystemConfig();
        },
    });
}

// The keychain keeps an extension's secrets under its own service, each by a path the account names, as Windows keeps
// one in a file beside that path.
function secretsOf(name) {
    const service = `crossbind ${name}`;
    const keyOf = (account) => {
        if (typeof account !== 'string' || !ACCOUNT.test(account)) throw new Error(`crossbind: ${name} names the secret ${JSON.stringify(account)}, which is no name of letters, digits, dots, dashes and underscores.`);
        return path.join(os.homedir(), '.crossbind', 'secrets', name, account);
    };
    return Object.freeze({
        get: (account) => readSecret(keyOf(account), { service }),
        set(account, secret) {
            const key = keyOf(account);
            if (typeof secret !== 'string' || !secret) throw new Error(`crossbind: ${name} keeps no secret of ${account}, which is no text.`);
            fs.mkdirSync(path.dirname(key), { recursive: true, mode: 0o700 });
            return storeSecret(key, secret, { service });
        },
    });
}

function terminalOf(name) {
    const assertTerminal = (question) => {
        if (!hasTerminal()) throw new Error(`crossbind: ${name} asks ${JSON.stringify(question.trim())}, with no terminal to answer it.`);
    };
    return {
        ask(question) {
            assertTerminal(question);
            return askLine(question);
        },
        askYesNo(question) {
            assertTerminal(question);
            return askYesNo(question);
        },
    };
}

// Runs a tool to its end where crossbind packages an app of the target's platform: on this Mac, with Apple's tools on
// the PATH, for a macOS app, and for a Linux or Windows app in crossbind's image of its platform, which sees the
// project's base alone, the windows one with the key that signs the app for a tool that signs. An installer's api alone
// has the target of the app it makes.
function runOf(name, target) {
    return (command, options) => {
        if (!target) throw new Error(`crossbind: ${name} runs a tool with api.run, which an installer's api alone has.`);
        if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === 'string')) {
            throw new Error(`crossbind: ${name} runs no command with api.run, which takes a list of strings: the program and its arguments.`);
        }
        const { cwd = state.config.paths.project, isSigning = false } = options ?? {};
        if (typeof cwd !== 'string') throw new Error(`crossbind: ${name} runs ${command[0]} in ${JSON.stringify(cwd)}, which is no path of a folder.`);
        const dir = path.resolve(state.config.paths.project, cwd);
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`crossbind: ${name} runs ${command[0]} in ${dir}, which is no folder.`);
        if (target.platform !== 'darwin' && !isUnderBase(dir, state.config.paths.base)) {
            throw new Error(`crossbind: ${name} runs ${command[0]} in ${dir}, outside ${state.config.paths.base}, the project's base and all the ${imageRoleFor(target)} container sees. Build the app into a folder under it.`);
        }
        if (target.platform === 'win32') inWindowsImage(command, dir, isSigning ? windowsSigning() : null);
        else runTool(null, command, null, target, { workdir: dir });
    };
}

// The api of an extension's run on a platform: the options the command line gave it, the run's build number once the
// publish picked it, which the app's facts then show, and an installer's target, the app it makes.
export default function extensionApi(name, {
    platform, options = {}, isGuided, run = {}, target = null,
}) {
    const buildEnv = () => (run.buildNumber === undefined || run.buildNumber === null
        ? process.env : { ...process.env, CROSSBIND_APP_BUILD_NUMBER: String(run.buildNumber) });
    const write = (key, value) => writeConfig(name, platform, key, value);
    let view = null;
    return Object.freeze({
        name,
        platform,
        isGuided,
        options: Object.freeze({ ...options }),
        project: Object.freeze({
            get root() { return state.config.paths.project; },
            get name() { return state.config.general.name; },
            get package() { return readOnly(state.config.package); },
        }),
        get workDir() { return path.join(state.config.paths.build, name); },
        get config() {
            if (view?.config !== state.config) {
                view = {
                    config: state.config,
                    proxy: new Proxy(state.config, { ...READ_ONLY, get: (target, key, receiver) => (key === 'write' ? write : READ_ONLY.get(target, key, receiver)) }),
                };
            }
            return view.proxy;
        },
        app: Object.freeze({
            get id() { return platform === 'android' ? androidAppId() : appId(state.config); },
            get name() { return appDisplayName(state.config); },
            get version() { return state.config.package?.version ?? '1.0.0'; },
            get appleVersion() { return appVersion(); },
            get versionCode() { return androidVersion(buildEnv()).code; },
            get buildNumber() { return appBuildNumber(buildEnv()); },
            get team() { return appTeam(); },
            get encryption() { return appEncryption(state.config); },
            get updater() {
                const updater = appUpdater(state.config);
                return updater && Object.freeze({ url: updater.url, publicKey: updater.publicKey.toString('base64'), version: updater.version });
            },
            get urlSchemes() { return Object.freeze(appUrlSchemes(state.config)); },
            get category() {
                const category = appCategory(state.config);
                return category && Object.freeze({ macos: category.darwin, linux: category.linux });
            },
        }),
        log: (text) => console.log(text),
        warn: (text) => console.warn(text),
        ...terminalOf(name),
        openUrl: (url) => openUrl(url),
        run: runOf(name, target),
        settings: settingsOf(name),
        secrets: secretsOf(name),
        android: Object.freeze({
            signing: () => releaseSigningEnv(),
            async makeUploadKey() {
                await makeUploadKey();
                state.config.system = loadSystemConfig();
            },
        }),
        apple: Object.freeze({
            key: () => appStoreKey(),
            teams: () => xcodeTeams(),
            xcodebuild: (what, args, xcodebuildOptions) => xcodebuild(what, args, xcodebuildOptions),
            unreasonedApis: (binary, privacy) => unreasonedImports(binary, privacy),
            privacyCategories: deepFrozen(structuredClone(PRIVACY_CATEGORIES)),
            dsyms: async () => [await resolveHermesDsym()],
        }),
        windows: Object.freeze({
            icon() {
                const icon = readAppIcon(state.config);
                return icon && windowsIcon(icon);
            },
            // The script that signs a file in the windows image with the key, which a tool that signs as it builds runs.
            get signer() { return windowsSigning() ? jsignScript() : null; },
        }),
    });
}
