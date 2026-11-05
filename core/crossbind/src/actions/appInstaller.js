import fs from 'node:fs';
import path from 'node:path';
import extensionApi from './extensionApi.js';
import { appleSigning } from './appleSigning.js';
import { DESKTOP_PLATFORMS, recordAppOutput } from './buildApp.js';
import { windowsSigning } from './windowsSigning.js';
import state from '../state/index.js';
import { hasTerminal } from '../utils/ask.js';
import { appInstallers } from '../utils/appOptions.js';
import {
    extensionStep, ownExtensions, withListed, withoutNamed,
} from '../utils/appExtensions.js';
import resolveAppHostRoot from '../utils/resolveAppHost.js';

const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

// crossbind's own installers, which the host brings as it brings its other extensions.
export const builtInInstallers = () => withoutNamed(ownExtensions(resolveAppHostRoot()), state.config?.app).filter(({ installer }) => installer);

// The installers an app has: crossbind's own, but for those whose role the app's extensions take, each in the place of the
// app's extension of its name that has an installer, then those of the app's other extensions.
export function installersOf(extensions) {
    const taken = extensions.flatMap(({ replaces }) => replaces ?? []);
    return withListed(builtInInstallers().filter(({ name }) => !taken.includes(name)), extensions.filter((extension) => extension.installer));
}

// The installers of the target's platform that make what installs its app: every one, or those app.installers names,
// which names none that is no installer, and those that run last whatever it names.
export function installersFor(target) {
    const all = installersOf(state.config.extensions ?? []);
    const named = appInstallers(state.config);
    const unknown = named?.find((name) => !all.some((extension) => extension.name === name));
    if (unknown) throw new Error(`crossbind: app.installers names ${unknown}, which is no installer: ${listed(all.filter(({ installer }) => !installer.isLast).map(({ name }) => name))} are.`);
    const platform = DESKTOP_PLATFORMS[target.platform];
    const taken = all.filter(({ name, installer }) => installer.platforms.includes(platform) && (!named || named.includes(name) || installer.isLast));
    return [...taken.filter(({ installer }) => !installer.isLast), ...taken.filter(({ installer }) => installer.isLast)];
}

const apiOf = (name, target) => extensionApi(name, { platform: DESKTOP_PLATFORMS[target.platform], isGuided: hasTerminal(), target });

// The installers an extension replaces, told once a run, which checks them for each of its targets.
const toldReplacing = new Set();

// What a desktop app ships with stops a build that could not make it here, before anything compiles: the keys that sign
// the app, the installers app.installers names, and what each installer checks, which it does knowing those that run.
export async function checkInstaller(target) {
    if (!DESKTOP_PLATFORMS[target.platform]) return;
    if (target.platform === 'darwin') appleSigning();
    if (target.platform === 'win32') windowsSigning();
    const installers = installersFor(target);
    const own = builtInInstallers().map(({ name }) => name);
    installers.filter((extension) => own.includes(extension.name) && state.config.extensions?.includes(extension) && !toldReplacing.has(extension.name))
        .forEach(({ name, root }) => {
            toldReplacing.add(name);
            console.log(`crossbind: the extension ${name} of ${root} replaces crossbind's own installer of its name.`);
        });
    const names = Object.freeze(installers.map(({ name }) => name));
    for (const { name, installer } of installers) {
        if (installer.check) await extensionStep(name, 'check', () => installer.check(apiOf(name, target), Object.freeze({ installers: names })));
    }
}

// The files an installer made, by their paths, a relative one beside the app.
function madeFiles(name, app, files) {
    if (!Array.isArray(files) || !files.every((file) => typeof file === 'string')) {
        throw new Error(`crossbind: the installer ${name} made no list of files, which its make returns.`);
    }
    return files.map((file) => {
        const made = path.resolve(path.dirname(app), file);
        if (!fs.statSync(made, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: the installer ${name} made ${made}, which is no file.`);
        return made;
    });
}

// What installs a desktop app, beside it: each installer's that made any, by its name, with the files it made, in the
// order they run, each seeing what those before it made.
export async function writeInstallers(app, target) {
    const made = [];
    for (const { name, installer } of installersFor(target)) {
        const files = await extensionStep(name, 'make', () => installer.make(apiOf(name, target), Object.freeze({ app, arch: target.arch, made: structuredClone(made) })));
        const madeNow = madeFiles(name, app, files);
        if (madeNow.length > 0) made.push({ name, files: madeNow });
    }
    return made;
}

// A desktop app with its page ships with what installs it. Installers write beside the app, in the page's own folder, so
// they run once every app of the build has its page.
export async function shipApp(target, to) {
    if (!DESKTOP_PLATFORMS[target.platform]) return;
    const app = path.resolve(to);
    recordAppOutput(target, app, { installers: await writeInstallers(app, target) });
}
