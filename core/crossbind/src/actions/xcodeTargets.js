import fs from 'node:fs';
import path from 'node:path';
import { xmlPlist } from '../utils/plist.js';
import { PRIVACY_CATEGORIES } from '../utils/appOptions.js';
import { isHeader, targetFrameworks, targetModule, targetPlist, widgetsWithoutBackground } from '../utils/appTargets.js';

const APP_GROUPS = 'com.apple.security.application-groups';
// The kind of each file Xcode compiles or copies into a target, by its ending: a folder is copied as it is, and an asset
// catalog compiled.
const FILE_TYPES = {
    '.swift': 'sourcecode.swift', '.m': 'sourcecode.c.objc', '.mm': 'sourcecode.cpp.objcpp', '.c': 'sourcecode.c.c', '.cpp': 'sourcecode.cpp.cpp',
    '.cc': 'sourcecode.cpp.cpp', '.cxx': 'sourcecode.cpp.cpp', '.h': 'sourcecode.c.h', '.hpp': 'sourcecode.cpp.h', '.xcassets': 'folder.assetcatalog',
    '.storyboard': 'file.storyboard', '.xib': 'file.xib', '.strings': 'text.plist.strings', '.xcstrings': 'text.json.xcstrings', '.png': 'image.png',
    '.json': 'text.json',
};

// The privacy manifest of these reasons for Apple's required reason API, which App Store Connect asks of each bundle that
// calls one.
export const privacyManifest = (privacy) => xmlPlist({
    NSPrivacyAccessedAPITypes: Object.entries(privacy).map(([name, reasons]) => ({
        NSPrivacyAccessedAPIType: PRIVACY_CATEGORIES[name].type,
        NSPrivacyAccessedAPITypeReasons: reasons,
    })),
});

// Xcode names its objects by 24 hex digits: each target's go by its place among them, apart from the app's own.
const idOf = (target, index) => `CE${target.toString(16).toUpperCase().padStart(4, '0')}${index.toString(16).toUpperCase().padStart(18, '0')}`;

// Writes a target's folder beside the app's project, targets/<name>/: its sources and resources in files/, where they are
// in their extension, its Info.plist, and its entitlements, the App Group among them where it asks for it, and its
// privacy manifest where it has them.
function writeTargetFiles(to, target, { label, appGroup }) {
    const dir = `targets/${target.name}`;
    fs.mkdirSync(`${to}/${dir}/files`, { recursive: true });
    [...target.sources, ...(target.resources ?? [])].forEach((file) => fs.cpSync(path.join(target.root, file), `${to}/${dir}/files/${file}`, { recursive: true }));
    fs.writeFileSync(`${to}/${dir}/Info.plist`, xmlPlist(targetPlist(target, label, appGroup)));
    const own = target.entitlements ?? {};
    const entitlements = target.appGroup ? { ...own, [APP_GROUPS]: [...new Set([...(own[APP_GROUPS] ?? []), appGroup])] } : own;
    const hasEntitlements = Object.keys(entitlements).length > 0;
    if (hasEntitlements) fs.writeFileSync(`${to}/${dir}/${target.name}.entitlements`, xmlPlist(entitlements));
    const hasPrivacy = Object.keys(target.privacy ?? {}).length > 0;
    if (hasPrivacy) fs.writeFileSync(`${to}/${dir}/PrivacyInfo.xcprivacy`, privacyManifest(target.privacy));
    return { dir, hasEntitlements, hasPrivacy };
}

const linkedFrameworks = (frameworks) => (frameworks.length > 0 ? { OTHER_LDFLAGS: ['$(inherited)', ...frameworks.flatMap((name) => ['-framework', name])] } : {});

// A target's build settings: its bundle, of the app's id and its name, signed as the app is, with the app's version and
// build, and its own deployment target and frameworks.
const targetSettings = (target, { dir, hasEntitlements }, { identity, version, build }) => ({
    PRODUCT_NAME: target.name,
    PRODUCT_MODULE_NAME: targetModule(target.name),
    PRODUCT_BUNDLE_IDENTIFIER: `${identity.id}.${target.name}`,
    DEVELOPMENT_TEAM: identity.team,
    CODE_SIGN_STYLE: 'Automatic',
    ...(hasEntitlements ? { CODE_SIGN_ENTITLEMENTS: `${dir}/${target.name}.entitlements` } : {}),
    INFOPLIST_FILE: `${dir}/Info.plist`,
    MARKETING_VERSION: version,
    CURRENT_PROJECT_VERSION: build,
    SKIP_INSTALL: 'YES',
    APPLICATION_EXTENSION_API_ONLY: 'YES',
    // Objective-C's @import, and the frameworks it links of itself.
    CLANG_ENABLE_MODULES: 'YES',
    LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
    ...(target.sources.some((file) => file.endsWith('.swift')) ? { SWIFT_VERSION: '5.0' } : {}),
    ...(target.deploymentTarget ? { IPHONEOS_DEPLOYMENT_TARGET: target.deploymentTarget } : {}),
    ...linkedFrameworks(targetFrameworks(target)),
});

// The project's objects of one target, by ids of its place among them: its files, build phases, configurations and the
// target, with what the app's target takes of it, a dependency on it and the copy of its product into the app's PlugIns.
function targetObjects(target, place, written, options) {
    const objects = {};
    let count = 0;
    const add = (object) => {
        count += 1;
        objects[idOf(place, count)] = object;
        return idOf(place, count);
    };
    const reference = (file, type) => add({ isa: 'PBXFileReference', lastKnownFileType: type, path: file, sourceTree: '<group>' });
    const typeOf = (file) => FILE_TYPES[path.extname(file)] ?? (fs.statSync(path.join(target.root, file)).isDirectory() ? 'folder' : 'file');
    const phase = (isa, files) => add({ isa, buildActionMask: 2147483647, files: files.map((fileRef) => add({ isa: 'PBXBuildFile', fileRef })), runOnlyForDeploymentPostprocessing: 0 });
    // Its headers are in its group, which its sources import from beside them, and compile with them.
    const headers = target.sources.filter(isHeader).map((file) => reference(`files/${file}`, typeOf(file)));
    const sources = target.sources.filter((file) => !isHeader(file)).map((file) => reference(`files/${file}`, typeOf(file)));
    const resources = [...(target.resources ?? []).map((file) => reference(`files/${file}`, typeOf(file))),
        ...(written.hasPrivacy ? [reference('PrivacyInfo.xcprivacy', 'text.xml')] : [])];
    const info = reference('Info.plist', 'text.plist.xml');
    const signed = written.hasEntitlements ? [reference(`${target.name}.entitlements`, 'text.plist.entitlements')] : [];
    const product = add({ isa: 'PBXFileReference', explicitFileType: 'wrapper.app-extension', includeInIndex: 0, path: `${target.name}.appex`, sourceTree: 'BUILT_PRODUCTS_DIR' });
    const group = add({ isa: 'PBXGroup', children: [info, ...signed, ...headers, ...sources, ...resources], path: written.dir, sourceTree: '<group>' });
    const phases = [phase('PBXSourcesBuildPhase', sources), phase('PBXFrameworksBuildPhase', []), phase('PBXResourcesBuildPhase', resources)];
    const buildSettings = targetSettings(target, written, options);
    const configurations = ['Debug', 'Release'].map((name) => add({ isa: 'XCBuildConfiguration', buildSettings, name }));
    const list = add({ isa: 'XCConfigurationList', buildConfigurations: configurations, defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Release' });
    const native = add({
        isa: 'PBXNativeTarget', buildConfigurationList: list, buildPhases: phases, buildRules: [], dependencies: [], name: target.name,
        productName: target.name, productReference: product, productType: 'com.apple.product-type.app-extension',
    });
    const proxy = add({ isa: 'PBXContainerItemProxy', containerPortal: options.project, proxyType: 1, remoteGlobalIDString: native, remoteInfo: target.name });
    const dependency = add({ isa: 'PBXTargetDependency', target: native, targetProxy: proxy });
    const embedded = add({ isa: 'PBXBuildFile', fileRef: product, settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] } });
    return { objects, group, product, native, dependency, embedded };
}

// Writes the folder of each target of Apple's app extensions the app's extensions add, and gives the project's objects
// for them: each a target whose bundle is the app's id and its name, which the app builds first and embeds in its PlugIns.
export function writeTargets(to, targets, options) {
    widgetsWithoutBackground(targets, (target, file) => fs.readFileSync(path.join(target.root, file), 'utf8')).forEach((name) => {
        console.warn(`crossbind: the widget target ${name} names no containerBackground in its Swift, which iOS 17 asks of a widget's view: a debug build `
            + 'draws "Please adopt containerBackground API" in its place. Its view gives its background with .containerBackground(.background, for: .widget).');
    });
    const made = targets.map((target, place) => targetObjects(target, place, writeTargetFiles(to, target, options), options));
    return {
        objects: Object.assign({}, ...made.map(({ objects }) => objects)),
        groups: made.map(({ group }) => group),
        products: made.map(({ product }) => product),
        dependencies: made.map(({ dependency }) => dependency),
        targets: made.map(({ native }) => native),
        embedded: made.map(({ embedded }) => embedded),
    };
}
