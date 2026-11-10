import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
import { compileSwift, swiftLinkArgs } from './appSwift.js';
import { unpackPackages } from './linuxPackages.js';
import { APPLE_SIGNING, appleSigning, notarizeApp } from './appleSigning.js';
import { WINDOWS_SIGNING, signWindows, windowsSigning } from './windowsSigning.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';
import findFiles from '../utils/findFiles.js';
import { getContentHash, getFilesFingerprint } from '../utils/hash.js';
import { xmlPlist } from '../utils/plist.js';
import {
    androidAppId, appBackgroundColor, appCategory, appCopyright, appDarkBackgroundColor, appDisplayName, appEncryption, appFiles, appHeader, appId,
    appPermissions, appPrivacy, appUrlSchemes, iosAppGroup, iosMultipleWindows, urlSchemeOwners, usageDescriptions,
} from '../utils/appOptions.js';
import { carriedFilesOf, copyCarriedFiles } from '../utils/appFiles.js';
import { activityTypeOwners, fileTypeOwners, linkOwners, macDocumentTypes, shortcutItemOwners } from '../utils/appLaunches.js';
import { unreasonedApis, unreasonedWarning } from '../utils/requiredReasonApis.js';
import {
    appExtensionsOf, extensionCmakeArgs, extensionPart, mergedEntitlements, mergedPlist, mergedPrivacy, registrationSource,
} from '../utils/appExtensions.js';
import { androidIcons, iosIcon, linuxIcon, macIcon, readAppIcon, windowsIcon } from '../utils/appIcon.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import { writeNativeSourceStamp } from '../utils/nativeSourceStamp.js';
import resetCMakeCacheForSource from '../utils/resetCMakeCacheForSource.js';
import resolveAppHostRoot, { resolveAppEmbindJsiRoot } from '../utils/resolveAppHost.js';
import resolveHermes, { HERMES } from '../utils/hermes.js';
import { getDockerImage, imageRoleFor } from '../utils/pullDockerImage.js';
import { isUnderBase } from '../utils/replaceBasePathForDocker.js';
import { chosenRunner } from '../utils/selectRunner.js';
import { DARWIN_DEPLOYMENT_TARGET } from '../utils/darwinToolchain.js';
import extensionsInApp from './extensionsInApp.js';

const cpuCount = Math.max(1, os.cpus().length - 1);
const BRIDGE = 'AppBridge';
const LINUX_MULTIARCH = { x64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu' };
// Where the android-app, linux and windows images keep the Hermes of the release crossbind pins.
const IMAGE_HERMES = `/opt/crossbind/hermes/${HERMES.version}`;

// What the app's extensions add to an app of this platform.
const extensionsOf = (platform) => extensionPart(extensionsInApp(platform, (message) => console.warn(`crossbind: ${message}.`)), platform);

// The App Group an iOS app shares with the targets of its extensions' that ask for one, or none; app.ios.appGroup is
// checked all the same.
function appGroupOf(platform, extensions) {
    if (platform !== 'ios') return null;
    const group = iosAppGroup(state.config);
    return extensions.targets.some(({ appGroup }) => appGroup) ? group : null;
}

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
// development only what runs it: the Simulator, or the iPhone or iPad CROSSBIND_APP_DEVICE names, the attached Android
// device, or this machine.
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
    const devSdk = env.CROSSBIND_APP_DEVICE ? 'iphoneos' : 'iphonesimulator';
    return getTargetParams({ platform: ['ios'], arch: dev ? [devSdk] : IOS_SDKS, runtime: ['mt'], runtimeEnv: ['app'] }, true);
}

// The Apple team that signs an iOS app: the project's app.team, else the machine's XCODE_DEVELOPMENT_TEAM, else none.
export function appTeam() {
    const team = state.config.app.team ?? state.config.system.XCODE_DEVELOPMENT_TEAM ?? '';
    if (team && !/^[A-Z0-9]{10}$/.test(team)) {
        throw new Error(`crossbind: ${JSON.stringify(team)} (app.team or XCODE_DEVELOPMENT_TEAM) is no Apple team id, which is ten capital letters and digits.`);
    }
    return team;
}

// Apple takes dot-separated integers alone as an app's version.
export const appVersion = () => (state.config.package?.version ?? '1.0.0').replace(/[-+].*$/, '');

const BUILD_NUMBER = 'CROSSBIND_APP_BUILD_NUMBER';
// Google Play takes no larger version code.
export const MAX_VERSION_CODE = 2100000000;

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

// A development build claims no scheme, no file type and no user activity: the built app, of the same id, owns them, and
// a link it opens shows its own page.
const urlSchemesOf = (target) => (target.buildType === 'release' ? appUrlSchemes(state.config) : []);
const fileTypesOf = (target) => (target.buildType === 'release' ? fileTypeOwners(state.config) : []);
const activityTypesOf = (target) => (target.buildType === 'release' ? activityTypeOwners(state.config).map(({ type }) => type) : []);

// The app's Info.plist, with the keys its extensions give.
const infoPlist = (name, version, hasIcon, urlSchemes, fileTypes, activityTypes) => xmlPlist(mergedPlist({
    CFBundleDisplayName: appDisplayName(state.config),
    ...(fileTypes.length > 0 ? { CFBundleDocumentTypes: macDocumentTypes(fileTypes) } : {}),
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
    ...(activityTypes.length > 0 ? { NSUserActivityTypes: activityTypes } : {}),
    ...usageDescriptions(state.config, 'darwin'),
}, extensionsOf('darwin').plist));

// The app's own files, as app.files lists them, by the project's folder.
const ownFiles = () => ({ root: state.config.paths.project, paths: appFiles(state.config) });

// The host's bytecode and the data the packages ship, beside the page's folder.
function copyAppFiles(dir, hbc, target) {
    fs.mkdirSync(`${dir}/page`, { recursive: true });
    fs.copyFileSync(hbc, `${dir}/host.hbc`);
    Object.entries(getData('data', target)).forEach(([source, dataName]) => {
        if (fs.existsSync(source)) fs.cpSync(source, `${dir}/data/${dataName}`, { recursive: true });
    });
    copyCarriedFiles(dir, extensionsOf(target.platform).files, ownFiles());
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
    fs.writeFileSync(`${app}/Contents/Info.plist`, infoPlist(name, appVersion(), Boolean(icon), urlSchemesOf(target), fileTypesOf(target), activityTypesOf(target)));
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

// The container that signs a Windows app sees the project's base alone.
function assertUnderBase(app, target) {
    if (isUnderBase(app, state.config.paths.base)) return;
    throw new Error(`crossbind: the Windows app ${app} is outside ${state.config.paths.base}, the project's base and all the ${imageRoleFor(target)} container sees. Build the app into a directory under it.`);
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
    // The hardened runtime keeps the app from the devices of app.permissions unless its signature claims them, beside what
    // its extensions claim.
    const devices = Object.fromEntries(Object.keys(appPermissions(state.config)).map((name) => [ENTITLEMENTS[name], true]));
    const claims = mergedEntitlements([['app.permissions', devices], ...extensionsOf('darwin').entitlements]);
    const entitlements = Object.keys(claims).length > 0 ? `${state.config.paths.build}/${path.basename(app)}.entitlements` : null;
    if (entitlements) fs.writeFileSync(entitlements, xmlPlist(claims));
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

// Where publishApp last put this project's apps, for `crossbind app publish`, which runs Vite and so cannot know the
// outDir it builds into: an iOS or Android app's project, and each arch's desktop app under its platform's name on the
// command line.
const appOutputsFile = () => `${state.config.paths.build}/app-outputs.json`;
const readAppOutputs = () => (fs.existsSync(appOutputsFile()) ? JSON.parse(fs.readFileSync(appOutputsFile(), 'utf8')) : {});
// What each desktop app's installers wrote beside it, as builds recorded them.
const shippedFiles = () => new Set(Object.values(readAppOutputs()).filter(Array.isArray).flat()
    .flatMap(({ installers = [] }) => installers.flatMap(({ files }) => files)));
// The command line's names of the desktop platforms.
export const DESKTOP_PLATFORMS = { darwin: 'macos', linux: 'linux', win32: 'windows' };

// The platform an app is built for, which its page reads as import.meta.env.CROSSBIND_APP_PLATFORM: CROSSBIND_APP_PLATFORM,
// else this machine's desktop.
export const appPlatform = (env = process.env) => env.CROSSBIND_APP_PLATFORM || DESKTOP_PLATFORMS[process.platform];

// Forgets what the builds wrote, as a publish's own build writes it anew, but for the installers' files, which a folder the
// bundler kept holds still, for the page to leave out.
export function clearAppOutputs() {
    const earlier = [...shippedFiles()];
    if (earlier.length > 0) fs.writeFileSync(appOutputsFile(), JSON.stringify({ earlier: [{ installers: [{ files: earlier }] }] }));
    else fs.rmSync(appOutputsFile(), { force: true });
}

// What a publisher's upload gets of the app the build wrote for a platform: a desktop platform's apps, one for each arch.
export function appOutputOf(platform) {
    const output = readAppOutputs()[platform];
    if (!output) throw new Error(`crossbind: the build wrote no ${platform} app, so there is nothing to publish.`);
    return Object.values(DESKTOP_PLATFORMS).includes(platform) ? { apps: output } : output;
}

const madeFile = (file) => (fs.existsSync(file) ? file : null);

// What a publisher's upload takes of an app: an iOS app's project, an Android app's with its APK, bundle and native
// debug symbols where the build made them, and each arch's desktop app with its installers.
export function recordAppOutput(target, to, { installers = [] } = {}) {
    const outputs = readAppOutputs();
    const app = path.resolve(to);
    const desktop = DESKTOP_PLATFORMS[target.platform];
    const mobile = target.platform === 'android'
        ? { project: app, apk: madeFile(`${app}.apk`), bundle: madeFile(`${app}.aab`), symbols: madeFile(`${app}-symbols.zip`) }
        : { project: app };
    const recorded = desktop
        ? { [desktop]: [...(outputs[desktop] ?? []).filter((entry) => entry.app !== app), {
            app,
            arch: target.arch,
            installers: installers.map(({ name, files }) => ({ name, files: files.map((file) => path.resolve(file)) })),
        }] }
        : { [target.platform]: mobile };
    fs.mkdirSync(state.config.paths.build, { recursive: true });
    fs.writeFileSync(appOutputsFile(), `${JSON.stringify({ ...outputs, ...recorded }, null, 4)}\n`);
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
        const ownPrivacy = appPrivacy(state.config);
        const build = appBuildNumber();
        // The app's own options are checked first, then what its extensions add.
        const options = {
            parts, identity: { id: appId(state.config), team: appTeam() }, label: appDisplayName(state.config), version: appVersion(),
            build: build === null ? appVersion() : String(build), icon: icon && iosIcon(icon), urlSchemes: appUrlSchemes(state.config),
            fileTypes: fileTypeOwners(state.config), links: linkOwners(state.config).map(({ link }) => link),
            activityTypes: activityTypeOwners(state.config).map(({ type }) => type), shortcutItems: shortcutItemOwners(state.config),
            background: appBackgroundColor(state.config), darkBackground: appDarkBackgroundColor(state.config), usage: usageDescriptions(state.config, 'ios'),
            encryption: appEncryption(state.config), multipleWindows: iosMultipleWindows(state.config),
        };
        const extensions = extensionsOf('ios');
        const privacy = mergedPrivacy(ownPrivacy, extensions.privacy);
        writeXcodeProject(to, {
            ...options, privacy, entitlements: mergedEntitlements(extensions.entitlements), plist: extensions.plist, targets: extensions.targets,
            appGroup: appGroupOf('ios', extensions),
        });
        if (target.buildType === 'release') warnUnreasonedApis(to, privacy);
    } else if (target.platform === 'android') {
        const icon = readAppIcon(state.config);
        const options = {
            parts: appParts(target), id: androidAppId(state.config), label: appDisplayName(state.config), version: androidVersion(), icons: icon && androidIcons(icon),
            urlSchemes: appUrlSchemes(state.config), background: appBackgroundColor(state.config), darkBackground: appDarkBackgroundColor(state.config),
            permissions: Object.keys(appPermissions(state.config)),
            fileTypes: fileTypeOwners(state.config), links: linkOwners(state.config).map(({ link }) => link), shortcutItems: shortcutItemOwners(state.config),
        };
        const extensions = extensionsOf('android');
        writeGradleProject(to, {
            ...options, java: extensions.java, extensionPermissions: extensions.permissions, manifests: extensions.manifests, resources: extensions.resources, maven: extensions.maven,
        });
    } else if (path.resolve(to) !== path.resolve(built)) {
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(built, to, { recursive: true, verbatimSymlinks: true });
    }
    if (page) {
        // The app may land inside the page's own directory, which it then leaves out, with every app built there and what
        // packages it: what is named after a target of the app, and every installer's files as a build recorded them, which
        // a folder the bundler left as it was holds still.
        const apps = state.targets.filter((t) => t.runtimeEnv === 'app')
            .flatMap((t) => [appOutputName(t), `${state.config.general.name}-${t.platform}-${t.arch}`]).filter((name) => !name.endsWith('.app'));
        const shipped = shippedFiles();
        const isApp = (entry) => entry === path.basename(to) || entry.endsWith('.app')
            || apps.some((app) => entry === app || entry.startsWith(`${app}.`) || entry.startsWith(`${app}-`))
            || shipped.has(path.resolve(page, entry));
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
    if (['ios', 'android'].includes(target.platform)) recordAppOutput(target, to);
    else if (target.platform === 'win32') signWindowsApp(to, target, page);
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
    // A desktop host's title and window, a Windows one's version, the app's icon and its extensions with their options, as
    // where the page opens files: a bad app section stops the build before anything compiles.
    const icon = readAppIcon(state.config);
    const extensions = extensionsOf(target.platform);
    const header = appHeader(state.config, target.platform, appGroupOf(target.platform, extensions));
    const carried = carriedFilesOf(extensions.files, ownFiles());
    const carriedPaths = new Set(carried);
    // Whether the extension that owns a launch has native code, or for the app's own one that holds the role.
    const hasNative = (extension, role) => extensions.native.some(({ name, roles }) => (extension === null ? roles.includes(role) : name === extension));
    // A desktop's system hands an app no https link: its owners there are those with native code, whose onOpenUrl a
    // phone's code may share.
    const isPhone = ['ios', 'android'].includes(target.platform);
    const links = linkOwners(state.config).filter(({ extension }) => isPhone || hasNative(extension, 'links'));
    // Another system continues no user activity: its owners there are those with native code, whose onUserActivity
    // Apple's code may share.
    const isApple = ['darwin', 'ios'].includes(target.platform);
    const activities = activityTypeOwners(state.config).filter(({ extension }) => isApple || hasNative(extension, 'activities'));
    // A desktop has no quick actions either.
    const shortcuts = shortcutItemOwners(state.config).filter(({ extension }) => isPhone || hasNative(extension, 'shortcuts'));
    const registration = registrationSource(extensions.native, urlSchemeOwners(state.config), fileTypeOwners(state.config), links, activities, shortcuts);

    const buildType = target.buildType === 'release' ? 'Release' : 'Debug';
    const { build } = state.config.paths;
    const appHostRoot = resolveAppHostRoot();
    appExtensionsOf(state.config.extensions).filter(({ replaces }) => replaces)
        .forEach(({ name, root, replaces }) => logger.info(`[${target.path}] the extension ${name} of ${root} takes the host's ${replaces.join(', ')}`));
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
    // The extensions' sources compile with the host, which links what they need: a framework on macOS, a library elsewhere.
    // An iOS host is a static library, whose frameworks the app's Xcode project links.
    const hostLinkArgs = [...linkArgs, ...(target.platform === 'darwin' ? extensions.frameworks.map((framework) => `-framework ${framework}`) : extensions.libraries)];

    const fingerprintFile = `${build}/${target.appName}.fingerprint`;
    const fingerprint = getContentHash(JSON.stringify({
        builder: getFilesFingerprint([fileURLToPath(import.meta.url), fileURLToPath(new URL('../utils/appIcon.js', import.meta.url))]),
        header,
        // A desktop app carries its icon; an iOS or Android one gets it as its project is written.
        icon: ['ios', 'android'].includes(target.platform) ? null : icon?.hash ?? null,
        // A macOS app's bundle takes its id, name and version from it.
        infoPlist: target.platform === 'darwin'
            ? infoPlist(state.config.general.name, appVersion(), Boolean(icon), urlSchemesOf(target), fileTypesOf(target), activityTypesOf(target)) : null,
        hermes: HERMES.version,
        inputs,
        linkArgs,
        libs: libs.map((lib) => {
            const stat = fs.existsSync(lib) ? fs.statSync(lib) : null;
            return { lib, size: stat ? stat.size : null, mtimeMs: stat ? stat.mtimeMs : null };
        }),
        env: getEnv(target),
        data: getData('data', target),
        // What the app carries, by its size and time, as a large model would take long to read at each build.
        carried: carried.map((file) => {
            const stat = fs.statSync(file);
            return { file, size: stat.size, mtimeMs: stat.mtimeMs };
        }),
        version: state.config.package?.version,
        runtime: getFilesFingerprint(filesUnder([
            `${appHostRoot}/cpp`, `${appHostRoot}/js`, `${appHostRoot}/third_party`, `${jsiRoot}/cpp/src`, `${jsiRoot}/js`,
            `${state.config.paths.cli}/assets/js-runtime/adapters`,
        ])),
        extraSources: getFilesFingerprint(extraSources),
        // An iOS app's frameworks reach its Xcode project through what the host's build writes.
        extensions: {
            registration,
            files: getFilesFingerprint(filesUnder(extensions.roots).filter((file) => !carriedPaths.has(path.resolve(file)))),
            compiled: extensions.compiled,
            link: hostLinkArgs.slice(linkArgs.length),
            frameworks: extensions.frameworks,
        },
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
    writeIfChanged(`${workDir}/extensions.cpp`, registration);
    // A Windows host's executable carries the app's icon, which its resource script takes from beside the header.
    if (target.platform === 'win32') {
        if (icon) writeIfChanged(`${workDir}/icon.ico`, windowsIcon(icon));
        else fs.rmSync(`${workDir}/icon.ico`, { force: true });
    }
    // An Apple app's Swift, which CMake's Makefiles take none of: each extension's compiles first, its header joins the
    // extension's includes, and its library the host's link, or an iOS app's Xcode project's.
    const swift = ['darwin', 'ios'].includes(target.platform) ? compileSwift(target, extensions.compiled, workDir, buildType === 'Release') : [];
    const swiftLink = swiftLinkArgs(target, swift.map(({ library }) => library));
    // A Linux app's extensions' packages beside crossbind's sysroot, each extension's in a sysroot of its own, whose
    // headers its sources include and whose libraries the host links against.
    const sysroots = target.platform === 'linux' ? await unpackPackages(target, extensions.compiled, {
        cache: `${build}/linux-packages`, workDir, unpack: (deb, root) => run(null, ['dpkg-deb', '-x', deb, root], platformPrefix, target),
    }) : [];
    const compiled = extensions.compiled.map((part) => ({
        ...part, includes: [...part.includes, ...[...swift, ...sysroots].filter(({ name: owner }) => owner === part.name).flatMap(({ includes }) => includes)],
    }));
    const ownLink = target.platform === 'darwin' ? swiftLink : sysroots.flatMap(({ libDir }) => [`-L${libDir}`, `-Wl,-rpath-link,${libDir}`]);
    run(null, [
        // An iOS host builds with crossbind's iOS toolchain file rather than as an Xcode project of its own.
        target.platform === 'ios' ? 'ios-cmake' : 'cmake', `${appHostRoot}/cpp`,
        `-DCMAKE_BUILD_TYPE=${buildType}`,
        `-DCROSSBIND_APP_FILE=${hostName}`,
        `-DCROSSBIND_JSI_ROOT=${jsiRoot}`,
        `-DCROSSBIND_HERMES=${hermes}`,
        `-DCROSSBIND_EXTRA_SOURCES=${extraSources.join(';')}`,
        `-DCROSSBIND_EXTENSION_REGISTRATION=${workDir}/extensions.cpp`,
        ...extensionCmakeArgs(compiled),
        `-DCROSSBIND_LINK_ARGS=${[...hostLinkArgs, ...ownLink].join(';')}`,
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
        const frameworks = extensions.frameworks.flatMap((framework) => ['-framework', framework]);
        assembleIosPart(target, { library: `${workDir}/lib${name}.a`, linkArgs: [...linkArgs, ...frameworks, ...swiftLink], hbc: `${workDir}/host.hbc`, hermes });
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
