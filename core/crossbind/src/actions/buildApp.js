import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import virtual from '@rollup/plugin-virtual';
import run from './run.js';
import createLib from './createLib.js';
import getData from './getData.js';
import getEnv from './getEnv.js';
import { copyWindowsNotices, filesUnder, linkInputs } from './buildNode.js';
import { suppressNodeBuiltinWarnings } from './buildJs.js';
import { isNativeSourceNewerThan } from './isSourceNewer.js';
import { createNativeBridges } from './nativeBridges.js';
import { getTargetParams } from './target.js';
import writeXcodeProject, { HERMES_SLICES, IOS_SDKS } from './xcodeProject.js';
import writeGradleProject, { ANDROID_ABIS } from './gradleProject.js';
import { attachedDevice } from './androidDevice.js';
import { packageAndroidRelease } from './androidGradle.js';
import writeInstaller, { assertUnderBase } from './appInstaller.js';
import writeUpdate from './appUpdate.js';
import { APPLE_SIGNING, appleSigning, notarizeApp } from './appleSigning.js';
import { WINDOWS_SIGNING, signWindows, windowsSigning } from './windowsSigning.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';
import findFiles from '../utils/findFiles.js';
import { getContentHash, getFilesFingerprint } from '../utils/hash.js';
import { xmlPlist } from '../utils/plist.js';
import {
    appBackgroundColor, appCategory, appCopyright, appDisplayName, appEncryption, appHeader, appId, appPermissions, appPrivacy, appUrlSchemes,
    usageDescriptions,
} from '../utils/appOptions.js';
import { unreasonedApis, unreasonedWarning } from '../utils/requiredReasonApis.js';
import { androidIcons, iosIcon, linuxIcon, macIcon, readAppIcon, windowsIcon } from '../utils/appIcon.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import { writeNativeSourceStamp } from '../utils/nativeSourceStamp.js';
import resetCMakeCacheForSource from '../utils/resetCMakeCacheForSource.js';
import resolveAppHostRoot, { resolveAppEmbindJsiRoot } from '../utils/resolveAppHost.js';
import resolveHermes, { HERMES } from '../utils/hermes.js';
import { getDockerImage, imageRoleFor } from '../utils/pullDockerImage.js';
import { chosenRunner } from '../utils/selectRunner.js';
import { DARWIN_DEPLOYMENT_TARGET } from '../utils/darwinToolchain.js';

const cpuCount = Math.max(1, os.cpus().length - 1);
const BRIDGE = 'AppBridge';
const LINUX_MULTIARCH = { x64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu' };
// Where the android-app, linux and windows images keep the Hermes of the release crossbind pins.
const IMAGE_HERMES = `/opt/crossbind/hermes/${HERMES.version}`;

// Where an app keeps its executable and its files: a macOS bundle, a Linux or Windows directory, or the app folder of an
// iOS app's Xcode project or of an Android app's Gradle project, which link the executable themselves.
export function appLayout(target) {
    const { name } = state.config.general;
    if (target.platform === 'darwin') return { executable: `Contents/MacOS/${name}`, resources: 'Contents/Resources' };
    if (target.platform === 'ios') return { executable: null, resources: 'app' };
    if (target.platform === 'android') return { executable: null, resources: 'app/src/main/assets/app' };
    return { executable: target.platform === 'win32' ? `${name}.exe` : name, resources: 'resources' };
}

// The name a bundler gives the app beside the page it built. An iOS app is one Xcode project for both SDKs, and an
// Android app one Gradle project for both ABIs.
export function appOutputName(target) {
    const { name } = state.config.general;
    if (target.platform === 'darwin') return `${name}.app`;
    if (['ios', 'android'].includes(target.platform)) return `${name}-${target.platform}`;
    return `${name}-${target.platform}-${target.arch}`;
}

// An Android, Linux or Windows app builds in one of crossbind's images, which a local or remote runner does not have.
export function assertAppRunner(target) {
    if (['darwin', 'ios'].includes(target.platform)) return;
    const runner = chosenRunner(state.config.system);
    if (['DOCKER_RUN', 'DOCKER_EXEC'].includes(runner)) return;
    const app = { android: 'an Android', win32: 'a Windows' }[target.platform] ?? 'a Linux';
    throw new Error(`crossbind: ${app} app builds in crossbind's ${imageRoleFor(target)} image, which RUNNER=${runner} does not use. Build it with RUNNER=DOCKER_RUN.`);
}

// The app a bundler builds: this machine's desktop app, or with CROSSBIND_APP_PLATFORM an iOS app for both SDKs, an
// Android app for both ABIs, or a Linux or Windows app for both arches, which builds in Docker on any machine. During
// development only what runs it: the Simulator, the attached device, or this machine.
export function appTargetParams({ dev = false } = {}, env = process.env) {
    const platform = env.CROSSBIND_APP_PLATFORM;
    const app = (platforms, archs) => {
        platforms.forEach((name) => assertAppRunner({ platform: name, runtimeEnv: 'app' }));
        return getTargetParams({ platform: platforms, arch: archs, runtime: ['mt'], runtimeEnv: ['app'] }, true);
    };
    if (!platform) return app([process.platform], [process.arch]);
    if (platform === 'android') return app(['android'], dev ? [attachedDevice().abi] : ANDROID_ABIS);
    if (platform === 'linux') {
        if (dev && process.platform !== 'linux') {
            throw new Error('crossbind: a Linux app runs on Linux, and so does its development session; build it here with crossbind app build -p linux.');
        }
        return app(['linux'], dev ? [process.arch] : Object.keys(LINUX_MULTIARCH));
    }
    if (platform === 'macos') {
        if (process.platform !== 'darwin') throw new Error('crossbind: macOS apps build on macOS.');
        return app(['darwin'], [process.arch]);
    }
    if (platform === 'windows') {
        if (dev && process.platform !== 'win32') {
            throw new Error('crossbind: a Windows app runs on Windows, and so does its development session; build it here with crossbind app build -p windows.');
        }
        return app(['win32'], dev ? [process.arch] : ['x64', 'arm64']);
    }
    if (platform !== 'ios') {
        throw new Error(`crossbind: CROSSBIND_APP_PLATFORM=${platform} names no platform an app builds for. Set it to android, ios, linux, macos or windows, or leave it unset for this machine's desktop app.`);
    }
    if (process.platform !== 'darwin') throw new Error('crossbind: iOS apps build on macOS, with Xcode.');
    return getTargetParams({ platform: ['ios'], arch: dev ? ['iphonesimulator'] : IOS_SDKS, runtime: ['mt'], runtimeEnv: ['app'] }, true);
}

// The Apple team that signs an iOS app: the project's app.team, else the machine's XCODE_DEVELOPMENT_TEAM, else none.
function appTeam() {
    const team = state.config.app.team ?? state.config.system.XCODE_DEVELOPMENT_TEAM ?? '';
    if (team && !/^[A-Z0-9]{10}$/.test(team)) {
        throw new Error(`crossbind: ${JSON.stringify(team)} (app.team or XCODE_DEVELOPMENT_TEAM) is no Apple team id, which is ten capital letters and digits.`);
    }
    return team;
}

// An Android application id: dot-separated parts of letters, digits and underscores that each start with a letter.
export const ANDROID_APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

// An Android app's id: the project's app.id, else one made from the project's name.
export function androidAppId() {
    const id = state.config.app.id ?? `dev.crossbind.${state.config.general.name.replace(/[^A-Za-z0-9.]/g, '_')}`;
    if (!ANDROID_APP_ID.test(id)) {
        throw new Error(`crossbind: ${JSON.stringify(id)} (app.id, else made from the project's name) is no Android application id, which takes dot-separated parts of letters, digits and underscores that each start with a letter, as com.example.app does. Set app.id in crossbind.config.js.`);
    }
    return id;
}

// Apple takes dot-separated integers alone as an app's version.
const appVersion = () => (state.config.package?.version ?? '1.0.0').replace(/[-+].*$/, '');

const BUILD_NUMBER = 'CROSSBIND_APP_BUILD_NUMBER';
// Google Play takes no larger version code.
const MAX_VERSION_CODE = 2100000000;

// The number CI or a publish gives a build, which iOS takes as its build and Android as its version code:
// CROSSBIND_APP_BUILD_NUMBER, a whole number both stores take, else none.
export function appBuildNumber(env = process.env) {
    const value = env[BUILD_NUMBER];
    if (!value) return null;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_VERSION_CODE) {
        throw new Error(`crossbind: ${BUILD_NUMBER} ${JSON.stringify(value)} is no build number, which is a whole number from 1 to ${MAX_VERSION_CODE}, as both stores take.`);
    }
    return Number(value);
}

// Android takes any name for an app's version, and a positive integer that grows from release to release as its code:
// the build number, else one made of the version's numbers.
export function androidVersion(env = process.env) {
    const [major = 0, minor = 0, patch = 0] = appVersion().split('.').map(Number);
    return { name: state.config.package?.version ?? '1.0.0', code: appBuildNumber(env) ?? Math.max(1, major * 1000000 + minor * 1000 + patch) };
}

// The apps this run built or found current. A part of an iOS app that an earlier run built may be stale.
const currentApps = new Set();

// What a host compiles and links against beside the project's archives: Hermes, on Linux WebKitGTK and on Windows the
// WebView2 SDK's headers. Apple's Hermes is React Native's release on this machine; the others are in the image the host
// builds in, android-app, linux or windows, whose reference stands for them in the fingerprint. An Android host shares
// the C++ runtime of Hermes' libraries.
async function hostInputs(target) {
    if (['darwin', 'ios'].includes(target.platform)) {
        const hermes = await resolveHermes();
        return { hermes, cmakeArgs: [], inputs: [hermes] };
    }
    assertAppRunner(target);
    const inputs = [getDockerImage(imageRoleFor(target), target.platform === 'android' ? 'linux/amd64' : undefined)];
    if (target.platform === 'android') {
        return { hermes: `${IMAGE_HERMES}/android`, cmakeArgs: ['-DANDROID_STL=c++_shared'], inputs };
    }
    if (target.platform === 'win32') {
        return { hermes: `${IMAGE_HERMES}/win32-${target.arch}`, cmakeArgs: ['-DCROSSBIND_WEBVIEW2_INCLUDE=/opt/crossbind/webview2/include'], inputs };
    }
    return {
        hermes: `${IMAGE_HERMES}/linux-${target.arch}`,
        cmakeArgs: [
            `-DCROSSBIND_GTK_SYSROOT=/opt/crossbind/webkitgtk/${LINUX_MULTIARCH[target.arch]}`,
            `-DCROSSBIND_GTK_MULTIARCH=${LINUX_MULTIARCH[target.arch]}`,
        ],
        inputs,
    };
}

// The app host package's scripts import crossbind's own runtime modules under crossbind/runtime/.
const runtimeModules = () => ({
    name: 'crossbind-runtime-modules',
    resolveId: (id) => (id.startsWith('crossbind/runtime/')
        ? `${state.config.paths.cli}/assets/js-runtime/${id.slice('crossbind/runtime/'.length)}`
        : null),
});

async function bundle(input, file, plugins) {
    const build = await rollup({ input, plugins, onwarn: suppressNodeBuiltinWarnings });
    await build.write({ file, format: 'iife' });
    await build.close();
}

// A development build claims no scheme: the built app, of the same id, owns them, and a link it opens shows its own page.
const urlSchemesOf = (target) => (target.buildType === 'release' ? appUrlSchemes(state.config) : []);

const infoPlist = (name, version, hasIcon, urlSchemes) => xmlPlist({
    CFBundleDisplayName: appDisplayName(state.config),
    CFBundleExecutable: name,
    // Contents/Resources/icon.icns.
    ...(hasIcon ? { CFBundleIconFile: 'icon' } : {}),
    CFBundleIdentifier: appId(state.config),
    CFBundleName: appDisplayName(state.config),
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    ...(urlSchemes.length > 0 ? { CFBundleURLTypes: [{ CFBundleURLName: appId(state.config), CFBundleURLSchemes: urlSchemes }] } : {}),
    CFBundleVersion: version,
    ...(appCategory(state.config) ? { LSApplicationCategoryType: appCategory(state.config).darwin } : {}),
    LSMinimumSystemVersion: DARWIN_DEPLOYMENT_TARGET,
    NSPrincipalClass: 'NSApplication',
    NSHighResolutionCapable: true,
    // The app menu's About item shows it.
    ...(appCopyright(state.config) ? { NSHumanReadableCopyright: appCopyright(state.config) } : {}),
    ...usageDescriptions(state.config, 'darwin'),
});

// The host's bytecode and the data the packages ship, beside the page's folder.
function copyAppFiles(dir, hbc, target) {
    fs.mkdirSync(`${dir}/page`, { recursive: true });
    fs.copyFileSync(hbc, `${dir}/host.hbc`);
    Object.entries(getData('data', target)).forEach(([source, dataName]) => {
        if (fs.existsSync(source)) fs.cpSync(source, `${dir}/data/${dataName}`, { recursive: true });
    });
}

// Everything but the page: the host and the app's files, its icon, and on macOS Hermes beside them. A Windows host
// carries its icon itself.
function assembleApp(target, { executable, hbc, hermes, icon }) {
    const app = `${state.config.paths.build}/${target.appName}`;
    const { name } = state.config.general;
    const layout = appLayout(target);
    fs.rmSync(app, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(`${app}/${layout.executable}`), { recursive: true });
    fs.copyFileSync(executable, `${app}/${layout.executable}`);
    copyAppFiles(`${app}/${layout.resources}`, hbc, target);
    if (target.platform === 'linux' && icon) fs.writeFileSync(`${app}/${layout.resources}/icon.png`, linuxIcon(icon));
    if (target.platform !== 'darwin') return;
    fs.writeFileSync(`${app}/Contents/Info.plist`, infoPlist(name, appVersion(), Boolean(icon), urlSchemesOf(target)));
    if (icon) fs.writeFileSync(`${app}/Contents/Resources/icon.icns`, macIcon(icon));
    const framework = `${app}/Contents/Frameworks/hermesvm.framework`;
    fs.cpSync(`${hermes}/Library/Frameworks/macosx/hermesvm.framework`, framework, { recursive: true, verbatimSymlinks: true });
    // The release carries Intel and Apple silicon; an app of one arch needs its own half.
    const library = `${framework}/Versions/Current/hermesvm`;
    run(null, ['lipo', library, '-thin', target.arch === 'x64' ? 'x86_64' : 'arm64', '-output', `${library}.thin`], null, target);
    fs.renameSync(`${library}.thin`, library);
}

// What an iOS SDK target brings to the app's Xcode project: the host and the archives it links, copied beside a link
// line that names them under {lib}, its slice of Hermes, and the app's files.
function assembleIosPart(target, { library, linkArgs, hbc, hermes }) {
    const part = `${state.config.paths.build}/${target.appName}`;
    fs.rmSync(part, { recursive: true, force: true });
    fs.mkdirSync(`${part}/lib`, { recursive: true });
    let count = 0;
    const place = (file) => {
        const name = `${count++}-${path.basename(file)}`;
        fs.copyFileSync(file, `${part}/lib/${name}`);
        return `{lib}/${name}`;
    };
    const args = [`-Wl,-force_load,${place(library)}`, ...linkArgs.map((arg) => {
        const archive = arg.match(/^(-Wl,-force_load,)?(\/.+\.a)$/);
        if (archive) return `${archive[1] ?? ''}${place(archive[2])}`;
        if (arg.endsWith('.a')) throw new Error(`crossbind: the iOS app cannot take ${arg} into its Xcode project, as it names no absolute path.`);
        return arg;
    })];
    fs.writeFileSync(`${part}/link.json`, JSON.stringify(args, null, 2));
    fs.cpSync(`${hermes}/Library/Frameworks/universal/hermesvm.xcframework/${HERMES_SLICES[target.arch]}/hermesvm.framework`,
        `${part}/hermesvm.framework`, { recursive: true, verbatimSymlinks: true });
    copyAppFiles(`${part}/app`, hbc, target);
}

// What an Android ABI target brings to the app's Gradle project: the host, the libraries beside it and the packages'
// shared libraries it links, and the app's files. A release's host build left the packages' libraries stripped beside
// the host, and every library as linked in symbols/.
function assembleAndroidPart(target, { libDir, sharedLibs, hbc }) {
    const part = `${state.config.paths.build}/${target.appName}`;
    fs.rmSync(part, { recursive: true, force: true });
    fs.mkdirSync(`${part}/lib`, { recursive: true });
    const shipped = sharedLibs.map((file) => (fs.existsSync(`${libDir}/${path.basename(file)}`) ? `${libDir}/${path.basename(file)}` : file));
    [...['libcrossbind_app.so', 'libjsi.so', 'libc++_shared.so'].map((file) => `${libDir}/${file}`), ...shipped]
        .forEach((file) => fs.copyFileSync(file, `${part}/lib/${path.basename(file)}`));
    if (fs.existsSync(`${libDir}/symbols`)) fs.cpSync(`${libDir}/symbols`, `${part}/symbols`, { recursive: true });
    copyAppFiles(`${part}/app`, hbc, target);
}

// The parts of an iOS or Android app this run has for its build type, one per SDK or ABI.
const appParts = (target) => state.targets
    .filter((t) => t.platform === target.platform && t.runtimeEnv === 'app' && t.buildType === target.buildType && currentApps.has(t.appName))
    .map((t) => ({ arch: t.arch, dir: `${state.config.paths.build}/${t.appName}` }));

// A Linux or Windows app also ships as one archive, next to its directory: a Windows one as a zip, made in the windows
// image.
function archiveApp(app, target) {
    if (target.platform === 'win32') {
        assertUnderBase(app, target);
        fs.rmSync(`${app}.zip`, { force: true });
        run(null, ['zip', '-q', '-r', '-X', `${path.basename(app)}.zip`, path.basename(app)], null, target, { workdir: path.dirname(app) });
        return;
    }
    const result = spawnSync('tar', ['-czf', `${app}.tar.gz`, '-C', path.dirname(app), path.basename(app)], {
        encoding: 'utf8',
        env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    if (result.status !== 0) throw new Error(`crossbind: cannot archive ${app}: ${result.stderr || result.error?.message}`);
}

const ENTITLEMENTS = {
    camera: 'com.apple.security.device.camera',
    microphone: 'com.apple.security.device.audio-input',
    location: 'com.apple.security.personal-information.location',
};

// Apple silicon runs signed code only, and a bundle's signature covers every file in it, so an app is signed once the
// page is in: with the Developer ID the environment names, in the hardened runtime notarizing asks for, or else ad hoc,
// which runs on the machine that built it.
function signApp(app, target, signing) {
    const sign = signing ? ['--sign', signing.identity, '--options', 'runtime', '--timestamp'] : ['--sign', '-', '--timestamp=none'];
    run(null, ['codesign', '--force', ...sign, `${app}/Contents/Frameworks/hermesvm.framework`], null, target);
    // The hardened runtime keeps the app from the devices of app.permissions unless its signature claims them.
    const claims = Object.keys(appPermissions(state.config)).map((name) => ENTITLEMENTS[name]);
    const entitlements = claims.length > 0 ? `${state.config.paths.build}/${path.basename(app)}.entitlements` : null;
    if (entitlements) fs.writeFileSync(entitlements, xmlPlist(Object.fromEntries(claims.map((claim) => [claim, true]))));
    run(null, ['codesign', '--force', ...sign, ...(entitlements ? ['--entitlements', entitlements] : []), app], null, target);
}

// A Windows app is signed before its zip and its setup program are made of it; one with its page that is not, the build
// says SmartScreen warns of.
function signWindowsApp(app, target, page) {
    assertUnderBase(app, target);
    const signing = windowsSigning();
    if (signing) signWindows([`${app}/${appLayout(target).executable}`], signing);
    else if (page) console.warn(`crossbind: ${path.basename(app)} is not signed, so SmartScreen warns of it and of its setup program once they are downloaded. Set ${WINDOWS_SIGNING.storetype} and the key it names to sign them with Authenticode.`);
}

// A macOS app with its page is the one that ships: Apple notarizes it, or the build says why another Mac refuses it.
function shipMacApp(app, signing) {
    const notarize = `${APPLE_SIGNING.key}, ${APPLE_SIGNING.keyId} and ${APPLE_SIGNING.issuer} to have Apple notarize it`;
    if (signing?.notary) notarizeApp(app, signing.notary);
    else if (signing) console.warn(`crossbind: ${path.basename(app)} is signed with your Developer ID but not notarized, so another Mac opens it only once its user allows it in System Settings. Set ${notarize}.`);
    else console.warn(`crossbind: ${path.basename(app)} is signed ad hoc, which opens it on this Mac alone. Set ${APPLE_SIGNING.identity} to sign it with your Developer ID, and ${notarize}.`);
}

// App Store Connect refuses an iOS app whose archives call required reason API without app.privacy's reasons; the build
// names them, from the archives a device gets.
function warnUnreasonedApis(project, privacy) {
    const device = `${project}/lib/iphoneos`;
    if (!fs.existsSync(device)) return;
    const archives = fs.readdirSync(device).filter((file) => file.endsWith('.a')).map((file) => `${device}/${file}`);
    const warning = unreasonedWarning(unreasonedApis(archives, privacy));
    if (warning) console.warn(warning);
}

// Where publishApp last put this project's iOS and Android apps, for `crossbind app publish`, which runs Vite and so
// cannot know the outDir it builds into.
const appOutputsFile = () => `${state.config.paths.build}/app-outputs.json`;
const readAppOutputs = () => (fs.existsSync(appOutputsFile()) ? JSON.parse(fs.readFileSync(appOutputsFile(), 'utf8')) : {});

export const clearAppOutputs = () => fs.rmSync(appOutputsFile(), { force: true });

export function appOutputOf(platform) {
    const output = readAppOutputs()[platform];
    if (!output) throw new Error(`crossbind: the build wrote no ${platform} app, so there is nothing to publish.`);
    return output;
}

function recordAppOutput(platform, to) {
    fs.mkdirSync(state.config.paths.build, { recursive: true });
    fs.writeFileSync(appOutputsFile(), `${JSON.stringify({ ...readAppOutputs(), [platform]: path.resolve(to) }, null, 4)}\n`);
}

// Where a build without a bundler puts an app: under its own name, or for iOS and Android as the project of its build
// type.
export function appOutputPath(target) {
    const { output } = state.config.paths;
    if (!['ios', 'android'].includes(target.platform)) return `${output}/${target.appName}`;
    return `${output}/${appOutputName(target)}${target.buildType === 'debug' ? '.debug' : ''}`;
}

// The built app with a page's files at `to`: the bundler's output for its page, or the project's output for a build
// with none. An iOS app is its Xcode project and an Android app its Gradle project, with every SDK or ABI built so far.
export function publishApp(target, { to = appOutputPath(target), page = null } = {}) {
    const built = `${state.config.paths.build}/${target.appName}`;
    if (target.platform === 'ios') {
        const parts = appParts(target).map(({ arch, dir }) => ({ sdk: arch, dir }));
        const icon = readAppIcon(state.config);
        const privacy = appPrivacy(state.config);
        const build = appBuildNumber();
        writeXcodeProject(to, {
            parts, identity: { id: appId(state.config), team: appTeam() }, label: appDisplayName(state.config), version: appVersion(),
            build: build === null ? appVersion() : String(build), icon: icon && iosIcon(icon), urlSchemes: appUrlSchemes(state.config),
            background: appBackgroundColor(state.config), usage: usageDescriptions(state.config, 'ios'), encryption: appEncryption(state.config), privacy,
        });
        if (target.buildType === 'release') warnUnreasonedApis(to, privacy);
    } else if (target.platform === 'android') {
        const icon = readAppIcon(state.config);
        writeGradleProject(to, {
            parts: appParts(target), id: androidAppId(), label: appDisplayName(state.config), version: androidVersion(), icons: icon && androidIcons(icon),
            urlSchemes: appUrlSchemes(state.config), background: appBackgroundColor(state.config), permissions: Object.keys(appPermissions(state.config)),
        });
    } else if (path.resolve(to) !== path.resolve(built)) {
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(built, to, { recursive: true, verbatimSymlinks: true });
    }
    if (page) {
        // The app may land inside the page's own directory, which it then leaves out, with every app built there and what
        // packages it.
        const apps = new Set([path.basename(to), ...state.targets.filter((t) => t.runtimeEnv === 'app')
            .flatMap((t) => [appOutputName(t), `${state.config.general.name}-${t.platform}-${t.arch}`])]);
        const isApp = (entry) => entry.endsWith('.app') || apps.has(entry.replace(/\.dmg$/, '.app'))
            || apps.has(entry.replace(/(\.tar\.gz|\.app\.zip|\.zip|\.apk|\.aab|\.deb|-setup\.exe|\.update\.json)$/, ''));
        fs.readdirSync(page).filter((entry) => !isApp(entry)).forEach((entry) => {
            fs.cpSync(`${page}/${entry}`, `${to}/${appLayout(target).resources}/page/${entry}`, { recursive: true });
        });
    }
    if (target.platform === 'darwin') {
        const signing = appleSigning();
        signApp(to, target, signing);
        if (page) shipMacApp(to, signing);
    } else if (target.platform === 'android' && target.buildType === 'release') {
        packageAndroidRelease(to);
    }
    if (['ios', 'android'].includes(target.platform)) {
        recordAppOutput(target.platform, to);
    } else if (target.platform !== 'darwin') {
        if (target.platform === 'win32') signWindowsApp(to, target, page);
        archiveApp(to, target);
    }
    // A desktop app with its page ships with what installs it, and with an updater's key with its update too.
    if (page && ['darwin', 'linux', 'win32'].includes(target.platform)) {
        writeInstaller(to, target);
        writeUpdate(to, target);
    }
    return to;
}

// Builds an app's host from the project's archives and the given bridges, its Hermes bytecode and the page runtime the
// page loads as crossbind.js, and puts them into an app without a page.
export default async function buildApp(target, { bridges = [], force = false } = {}) {
    if (['darwin', 'ios'].includes(target.platform) && process.platform !== 'darwin') {
        logger.info(`[${target.path}] app skipped (macOS and iOS apps build on a macOS host)`);
        return false;
    }
    if (state.config.export.type === 'cargo') {
        logger.info(`[${target.path}] app skipped (cargo package - staticlib only)`);
        return false;
    }
    // Where the page opens files, a desktop host's title and window, a Windows one's version, and the app's icon: a bad
    // app section stops the build before anything compiles.
    const header = appHeader(state.config, target.platform);
    const icon = readAppIcon(state.config);

    const buildType = target.buildType === 'release' ? 'Release' : 'Debug';
    const { build } = state.config.paths;
    const appHostRoot = resolveAppHostRoot();
    const jsiRoot = resolveAppEmbindJsiRoot();
    const { hermes, cmakeArgs, inputs } = await hostInputs(target);

    // The bridges compile against the embind runtime, which speaks the JSI of the Hermes the host links. Android's
    // Hermes comes without JSI's headers, which the host package has from the same release.
    const headerDirs = [`${jsiRoot}/cpp/src`, `${hermes}/include`, ...(target.platform === 'android' ? [`${appHostRoot}/third_party/jsi/include`] : [])];
    createLib(target, BRIDGE, {
        buildSource: false,
        nativeGlob: [`${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`, ...bridges],
        headerDirs,
        // Headers in the image count by their path, which names the Hermes release.
        inputs: headerDirs.flatMap((dir) => (fs.existsSync(dir) ? findFiles('**/*.h', { cwd: dir }) : [dir])),
    });
    const { libs, linkArgs, extraSources } = linkInputs(target, { bridge: BRIDGE });
    const sharedLibs = libs.filter((lib) => lib.endsWith('.so'));

    const fingerprintFile = `${build}/${target.appName}.fingerprint`;
    const fingerprint = getContentHash(JSON.stringify({
        builder: getFilesFingerprint([fileURLToPath(import.meta.url), fileURLToPath(new URL('../utils/appIcon.js', import.meta.url))]),
        header,
        // A desktop app carries its icon; an iOS or Android one gets it as its project is written.
        icon: ['ios', 'android'].includes(target.platform) ? null : icon?.hash ?? null,
        // A macOS app's bundle takes its id, name and version from it.
        infoPlist: target.platform === 'darwin' ? infoPlist(state.config.general.name, appVersion(), Boolean(icon), urlSchemesOf(target)) : null,
        hermes: HERMES.version,
        inputs,
        linkArgs,
        libs: libs.map((lib) => {
            const stat = fs.existsSync(lib) ? fs.statSync(lib) : null;
            return { lib, size: stat ? stat.size : null, mtimeMs: stat ? stat.mtimeMs : null };
        }),
        env: getEnv(target),
        data: getData('data', target),
        version: state.config.package?.version,
        runtime: getFilesFingerprint(filesUnder([
            `${appHostRoot}/cpp`, `${appHostRoot}/js`, `${appHostRoot}/third_party`, `${jsiRoot}/cpp/src`, `${jsiRoot}/js`,
            `${state.config.paths.cli}/assets/js-runtime/adapters`,
        ])),
        extraSources: getFilesFingerprint(extraSources),
    }));
    const isChanged = !fs.existsSync(fingerprintFile) || fs.readFileSync(fingerprintFile, { encoding: 'utf8' }) !== fingerprint;
    if (!force && !isChanged && fs.existsSync(`${build}/${target.appName}`) && fs.existsSync(`${build}/${target.appJsName}`)) {
        logger.cachedStep(target, 'app');
        currentApps.add(target.appName);
        return false;
    }

    const platformPrefix = `App-${buildType}`;
    const workDir = `${build}/${platformPrefix}/${target.path}`;
    const { name } = state.config.general;
    // An Android app's activity loads its host by this one name.
    const hostName = target.platform === 'android' ? 'crossbind_app' : name;
    logger.startStep(target, 'app');
    resetCMakeCacheForSource(workDir, `${appHostRoot}/cpp`, target);
    // The host includes it from its build directory; written only when it changed, it recompiles nothing otherwise.
    writeIfChanged(`${workDir}/crossbind_app.h`, header);
    // A Windows host's executable carries the app's icon, which its resource script takes from beside the header.
    if (target.platform === 'win32') {
        if (icon) writeIfChanged(`${workDir}/icon.ico`, windowsIcon(icon));
        else fs.rmSync(`${workDir}/icon.ico`, { force: true });
    }
    run(null, [
        // An iOS host builds with crossbind's iOS toolchain file rather than as an Xcode project of its own.
        target.platform === 'ios' ? 'ios-cmake' : 'cmake', `${appHostRoot}/cpp`,
        `-DCMAKE_BUILD_TYPE=${buildType}`,
        `-DCROSSBIND_APP_FILE=${hostName}`,
        `-DCROSSBIND_JSI_ROOT=${jsiRoot}`,
        `-DCROSSBIND_HERMES=${hermes}`,
        `-DCROSSBIND_EXTRA_SOURCES=${extraSources.join(';')}`,
        `-DCROSSBIND_LINK_ARGS=${linkArgs.join(';')}`,
        `-DCROSSBIND_LINK_DEPENDS=${libs.join(';')}`,
        // An Android release ships the packages' shared libraries stripped as well, and keeps them as they come.
        ...(target.platform === 'android' ? [`-DCROSSBIND_SHARED_LIBS=${sharedLibs.join(';')}`] : []),
        ...cmakeArgs,
    ], platformPrefix, target);
    run(null, ['cmake', '--build', '.', '-j', String(cpuCount)], platformPrefix, target, { exclusive: true });
    if (target.platform === 'win32') copyWindowsNotices(target);

    const systemConfig = `export default ${JSON.stringify({ env: getEnv(target) })};`;
    await bundle(`${appHostRoot}/js/host.js`, `${workDir}/host.js`, [
        virtual({ 'crossbind/systemConfig': systemConfig }), runtimeModules(), nodeResolve(), commonjs(),
    ]);
    // Without -Xes6-block-scoping, hermesc compiles let and const as var, and closures made in a loop share one binding.
    run(null, [`${hermes}/bin/hermesc`, '-O', '-Xes6-block-scoping', '-emit-binary', '-out', `${workDir}/host.hbc`, `${workDir}/host.js`],
        platformPrefix, target);
    await bundle(`${appHostRoot}/js/page.js`, `${build}/${target.appJsName}`, []);
    if (target.platform === 'ios') {
        assembleIosPart(target, { library: `${workDir}/lib${name}.a`, linkArgs, hbc: `${workDir}/host.hbc`, hermes });
    } else if (target.platform === 'android') {
        assembleAndroidPart(target, { libDir: workDir, sharedLibs, hbc: `${workDir}/host.hbc` });
    } else {
        assembleApp(target, { executable: `${workDir}/${path.basename(appLayout(target).executable)}`, hbc: `${workDir}/host.hbc`, hermes, icon });
    }
    logger.doneStep(target, 'app');

    fs.writeFileSync(fingerprintFile, fingerprint);
    writeNativeSourceStamp(`${build}/${target.appName}`, state.config.paths.native);
    currentApps.add(target.appName);
    return true;
}

// The app of the project as it stands, for a bundler plugin, which needs the host before the page asks for anything:
// the bridges a plain build binds, found in the project's headers and sources, then its own archive and the host.
export async function buildProjectApp(target) {
    const bridges = createNativeBridges([target]).headers.flatMap((header) => header.bridge ?? []);
    const force = isNativeSourceNewerThan(`${state.config.paths.build}/${target.appName}`);
    createLib(target, 'Source', { force, buildSource: true });
    return buildApp(target, { bridges, force });
}
