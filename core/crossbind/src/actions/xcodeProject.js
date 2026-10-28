import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import state from '../state/index.js';
import { IOS_DEPLOYMENT_TARGET } from '../utils/iosToolchain.js';
import { textPlist, xmlPlist } from '../utils/plist.js';
import { PRIVACY_CATEGORIES } from '../utils/appOptions.js';

// The SDKs an iOS app builds for, one target each, and the slice of Hermes' release each takes.
export const IOS_SDKS = ['iphoneos', 'iphonesimulator'];
export const HERMES_SLICES = { iphoneos: 'ios-arm64', iphonesimulator: 'ios-arm64_x86_64-simulator' };
// What the host's own code needs from the system: Xcode adds it only for the sources it compiles itself.
const SYSTEM_LIBS = ['-framework', 'UIKit', '-framework', 'WebKit', '-framework', 'CoreGraphics', '-lc++'];

const MAIN = `// crossbind writes this project anew on every build: the app comes prebuilt in lib/, and its files are in app/.
int crossbind_app_main(int argc, char *argv[]);

int main(int argc, char *argv[]) { return crossbind_app_main(argc, argv); }
`;

const OBJECT_NAMES = ['project', 'mainGroup', 'products', 'target', 'product', 'main', 'info', 'app', 'hermes', 'mainBuild',
    'appBuild', 'hermesLink', 'hermesEmbed', 'sources', 'frameworks', 'resources', 'embed', 'projectDebug', 'projectRelease',
    'targetDebug', 'targetRelease', 'projectConfigs', 'targetConfigs', 'assets', 'assetsBuild', 'privacy', 'privacyBuild'];
// Xcode names its objects by 24 hex digits. Fixed ones leave the project unchanged while what it holds is.
const ID = Object.fromEntries(OBJECT_NAMES.map((name, index) => [name, `CB${(index + 1).toString(16).toUpperCase().padStart(22, '0')}`]));

const PROJECT_SETTINGS = {
    SDKROOT: 'iphoneos',
    SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator',
    IPHONEOS_DEPLOYMENT_TARGET: IOS_DEPLOYMENT_TARGET,
    TARGETED_DEVICE_FAMILY: '1,2',
    // crossbind's iOS archives are arm64 alone, for devices and the Simulator alike.
    ARCHS: 'arm64',
    ALWAYS_SEARCH_USER_PATHS: 'NO',
    CLANG_ENABLE_OBJC_ARC: 'YES',
    DEAD_CODE_STRIPPING: 'YES',
};

const ORIENTATIONS = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];

// The color set of app.window.backgroundColor, which the launch screen shows.
const LAUNCH_COLOR = 'LaunchBackground';

const infoPlist = (name, urlSchemes, hasBackground, usage, encryption) => xmlPlist({
    CFBundleDevelopmentRegion: 'en',
    CFBundleDisplayName: name,
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '$(MARKETING_VERSION)',
    ...(urlSchemes.length > 0 ? { CFBundleURLTypes: [{ CFBundleURLName: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundleURLSchemes: urlSchemes }] } : {}),
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
    ...(encryption === null ? {} : { ITSAppUsesNonExemptEncryption: encryption }),
    LSRequiresIPhoneOS: true,
    UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false },
    UILaunchScreen: hasBackground ? { UIColorName: LAUNCH_COLOR } : {},
    UISupportedInterfaceOrientations: ORIENTATIONS,
    'UISupportedInterfaceOrientations~ipad': [...ORIENTATIONS, 'UIInterfaceOrientationPortraitUpsideDown'],
    // The reasons of app.permissions, without which iOS lets the app use none of those devices.
    ...usage,
});

function objects(name, targetSettings, hasAssets, hasPrivacy) {
    const file = (path, type) => ({ isa: 'PBXFileReference', lastKnownFileType: type, path, sourceTree: '<group>' });
    const phase = (isa, files, extra = {}) => ({ isa, buildActionMask: 2147483647, files, runOnlyForDeploymentPostprocessing: 0, ...extra });
    const configuration = (configurationName, buildSettings) => ({ isa: 'XCBuildConfiguration', buildSettings, name: configurationName });
    const configurations = (debug, release) => ({
        isa: 'XCConfigurationList', buildConfigurations: [debug, release], defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Release',
    });
    // The app's icon and launch screen color, in an asset catalog.
    const assets = hasAssets ? {
        [ID.assets]: file('Assets.xcassets', 'folder.assetcatalog'),
        [ID.assetsBuild]: { isa: 'PBXBuildFile', fileRef: ID.assets },
    } : {};
    const privacy = hasPrivacy ? {
        [ID.privacy]: file('PrivacyInfo.xcprivacy', 'text.xml'),
        [ID.privacyBuild]: { isa: 'PBXBuildFile', fileRef: ID.privacy },
    } : {};
    return {
        ...assets,
        ...privacy,
        [ID.main]: file('main.m', 'sourcecode.c.objc'),
        [ID.info]: file('Info.plist', 'text.plist.xml'),
        [ID.app]: file('app', 'folder'),
        [ID.hermes]: file('Frameworks/hermesvm.xcframework', 'wrapper.xcframework'),
        [ID.product]: {
            isa: 'PBXFileReference', explicitFileType: 'wrapper.application', includeInIndex: 0, path: `${name}.app`, sourceTree: 'BUILT_PRODUCTS_DIR',
        },
        [ID.mainBuild]: { isa: 'PBXBuildFile', fileRef: ID.main },
        [ID.appBuild]: { isa: 'PBXBuildFile', fileRef: ID.app },
        [ID.hermesLink]: { isa: 'PBXBuildFile', fileRef: ID.hermes },
        [ID.hermesEmbed]: { isa: 'PBXBuildFile', fileRef: ID.hermes, settings: { ATTRIBUTES: ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] } },
        [ID.sources]: phase('PBXSourcesBuildPhase', [ID.mainBuild]),
        [ID.frameworks]: phase('PBXFrameworksBuildPhase', [ID.hermesLink]),
        [ID.resources]: phase('PBXResourcesBuildPhase', [ID.appBuild, ...(hasAssets ? [ID.assetsBuild] : []), ...(hasPrivacy ? [ID.privacyBuild] : [])]),
        [ID.embed]: phase('PBXCopyFilesBuildPhase', [ID.hermesEmbed], { dstPath: '', dstSubfolderSpec: 10, name: 'Embed Frameworks' }),
        [ID.mainGroup]: {
            isa: 'PBXGroup',
            children: [ID.main, ID.info, ID.app, ...(hasAssets ? [ID.assets] : []), ...(hasPrivacy ? [ID.privacy] : []), ID.hermes, ID.products],
            sourceTree: '<group>',
        },
        [ID.products]: { isa: 'PBXGroup', children: [ID.product], name: 'Products', sourceTree: '<group>' },
        [ID.target]: {
            isa: 'PBXNativeTarget',
            buildConfigurationList: ID.targetConfigs,
            buildPhases: [ID.sources, ID.frameworks, ID.resources, ID.embed],
            buildRules: [],
            dependencies: [],
            name,
            productName: name,
            productReference: ID.product,
            productType: 'com.apple.product-type.application',
        },
        [ID.project]: {
            isa: 'PBXProject',
            buildConfigurationList: ID.projectConfigs,
            compatibilityVersion: 'Xcode 14.0',
            developmentRegion: 'en',
            hasScannedForEncodings: 0,
            knownRegions: ['en', 'Base'],
            mainGroup: ID.mainGroup,
            productRefGroup: ID.products,
            projectDirPath: '',
            projectRoot: '',
            targets: [ID.target],
        },
        [ID.projectDebug]: configuration('Debug', PROJECT_SETTINGS),
        [ID.projectRelease]: configuration('Release', PROJECT_SETTINGS),
        [ID.targetDebug]: configuration('Debug', targetSettings),
        [ID.targetRelease]: configuration('Release', targetSettings),
        [ID.projectConfigs]: configurations(ID.projectDebug, ID.projectRelease),
        [ID.targetConfigs]: configurations(ID.targetDebug, ID.targetRelease),
    };
}

// The asset catalog: the app's icon, from which Xcode makes every size, and the launch screen's color.
function writeAssets(catalog, icon, background) {
    const info = { author: 'xcode', version: 1 };
    const assetSet = (set, contents) => {
        fs.mkdirSync(`${catalog}/${set}`, { recursive: true });
        fs.writeFileSync(`${catalog}/Contents.json`, JSON.stringify({ info }, null, 2));
        fs.writeFileSync(`${catalog}/${set}/Contents.json`, JSON.stringify({ ...contents, info }, null, 2));
    };
    if (icon) {
        assetSet('AppIcon.appiconset', { images: [{ filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }] });
        fs.writeFileSync(`${catalog}/AppIcon.appiconset/icon.png`, icon);
    }
    if (background) {
        const [red, green, blue] = [1, 3, 5].map((at) => `0x${background.slice(at, at + 2).toUpperCase()}`);
        assetSet(`${LAUNCH_COLOR}.colorset`, { colors: [{ color: { 'color-space': 'srgb', components: { alpha: '1.000', red, green, blue } }, idiom: 'universal' }] });
    }
}

// The privacy manifest of app.privacy, without which App Store Connect refuses an app that calls required reason API.
const privacyManifest = (privacy) => xmlPlist({
    NSPrivacyAccessedAPITypes: Object.entries(privacy).map(([name, reasons]) => ({
        NSPrivacyAccessedAPIType: PRIVACY_CATEGORIES[name].type,
        NSPrivacyAccessedAPITypeReasons: reasons,
    })),
});

// An iOS app as an Xcode project, written anew from the parts its SDK targets built: each brings its archives and
// their link line, and its slice of Hermes; the first also the app's files. Xcode signs the app and runs it, in the
// Simulator or on a device, and makes every size of its icon from the one PNG given.
export default function writeXcodeProject(to, {
    parts, identity, label, version, build = version, icon = null, urlSchemes = [], background = null, usage = {}, encryption = null, privacy = {},
}) {
    const { name } = state.config.general;
    if (parts.length === 0) throw new Error(`crossbind: no part of the iOS app ${name} is built, so there is no Xcode project to write.`);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(`${to}/${name}.xcodeproj`, { recursive: true });
    const linkFlags = {};
    parts.forEach(({ sdk, dir }) => {
        fs.cpSync(`${dir}/lib`, `${to}/lib/${sdk}`, { recursive: true });
        // The quotes keep a project path with spaces in one argument.
        const args = JSON.parse(fs.readFileSync(`${dir}/link.json`, 'utf8'))
            .map((arg) => arg.replace(/\{lib\}\/(.+)$/, `"$(PROJECT_DIR)/lib/${sdk}/$1"`));
        linkFlags[`OTHER_LDFLAGS[sdk=${sdk}*]`] = [...args, ...SYSTEM_LIBS];
    });
    fs.cpSync(`${parts[0].dir}/app`, `${to}/app`, { recursive: true });
    const frameworks = parts.flatMap(({ dir }) => ['-framework', `${dir}/hermesvm.framework`]);
    const result = spawnSync('xcodebuild', ['-create-xcframework', ...frameworks, '-output', `${to}/Frameworks/hermesvm.xcframework`], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`crossbind: cannot make Hermes' xcframework for ${to}: ${result.stderr || result.error?.message}`);

    fs.writeFileSync(`${to}/main.m`, MAIN);
    fs.writeFileSync(`${to}/Info.plist`, infoPlist(label, urlSchemes, Boolean(background), usage, encryption));
    writeAssets(`${to}/Assets.xcassets`, icon, background);
    const hasPrivacy = Object.keys(privacy).length > 0;
    if (hasPrivacy) fs.writeFileSync(`${to}/PrivacyInfo.xcprivacy`, privacyManifest(privacy));
    const targetSettings = {
        ...(icon ? { ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon' } : {}),
        PRODUCT_NAME: name,
        PRODUCT_BUNDLE_IDENTIFIER: identity.id,
        DEVELOPMENT_TEAM: identity.team,
        CODE_SIGN_STYLE: 'Automatic',
        INFOPLIST_FILE: 'Info.plist',
        MARKETING_VERSION: version,
        CURRENT_PROJECT_VERSION: build,
        LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/Frameworks'],
        ...linkFlags,
    };
    fs.writeFileSync(`${to}/${name}.xcodeproj/project.pbxproj`, textPlist({
        archiveVersion: 1, classes: {}, objectVersion: 56, objects: objects(name, targetSettings, Boolean(icon || background), hasPrivacy), rootObject: ID.project,
    }));
    return to;
}
