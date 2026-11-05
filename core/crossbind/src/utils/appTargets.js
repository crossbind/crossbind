import { IOS_DEPLOYMENT_TARGET } from './iosToolchain.js';

// Apple's app extensions an iOS app's extensions add, each a target of the app's Xcode project of its own, by their
// kinds: the extension point each runs at, which an other target names itself, and the options it needs or may give.
const KINDS = {
    widget: { point: 'com.apple.widgetkit-extension', needs: [], takes: [] },
    share: { point: 'com.apple.share-services', needs: ['principalClass', 'activation'], takes: [] },
    'notification-service': { point: 'com.apple.usernotifications.service', needs: ['principalClass'], takes: [] },
    'notification-content': { point: 'com.apple.usernotifications.content-extension', needs: ['principalClass', 'categories'], takes: [] },
    other: { point: null, needs: ['extensionPoint'], takes: ['principalClass'] },
};
const KIND_KEYS = ['principalClass', 'activation', 'categories', 'extensionPoint'];
const TARGET_KEYS = ['name', 'kind', 'sources', 'resources', 'displayName', 'plist', 'entitlements', 'frameworks', 'privacy', 'appGroup',
    'deploymentTarget', ...KIND_KEYS, 'attributes'];
const NEEDED = {
    principalClass: 'the class iOS makes as it starts the target',
    activation: "what of the share sheet's items it takes, as { images: 10 }",
    categories: 'the notification categories it shows',
    extensionPoint: 'the extension point iOS runs it at, as com.apple.keyboard-service',
};
// What of the share sheet's items a share extension takes, by the keys of Apple's activation rule: a count of each kind,
// and text or none.
const ACTIVATION = {
    attachments: 'NSExtensionActivationSupportsAttachmentsWithMaxCount',
    files: 'NSExtensionActivationSupportsFileWithMaxCount',
    images: 'NSExtensionActivationSupportsImageWithMaxCount',
    movies: 'NSExtensionActivationSupportsMovieWithMaxCount',
    text: 'NSExtensionActivationSupportsText',
    urls: 'NSExtensionActivationSupportsWebURLWithMaxCount',
    webPages: 'NSExtensionActivationSupportsWebPageWithMaxCount',
};
// The attributes crossbind writes from a target's options, and the Info.plist keys it writes for every target, the App
// Group, which the target's code reads, of one that asks for it.
const WRITTEN_ATTRIBUTES = { NSExtensionActivationRule: 'activation', UNNotificationExtensionCategory: 'categories' };
const APP_GROUP_KEY = 'CrossbindAppGroup';
const WRITTEN_KEYS = ['CFBundleDevelopmentRegion', 'CFBundleDisplayName', 'CFBundleExecutable', 'CFBundleIdentifier', 'CFBundleInfoDictionaryVersion',
    'CFBundleName', 'CFBundlePackageType', 'CFBundleShortVersionString', 'CFBundleVersion', 'NSExtension', APP_GROUP_KEY];

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CLASS = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXTENSION_POINT = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const VERSION = /^\d+\.\d+$/;
// ExtensionKit's points, whose extensions are of another product, in the app's Extensions, which crossbind makes none of.
const EXTENSION_KIT_POINTS = ['com.apple.appintents-extension'];
// What a target compiles apart from its headers, and the sources of Objective-C, beside which a class goes by its own name.
export const isHeader = (file) => /\.(h|hpp)$/.test(file);
const isObjectiveC = (file) => /\.(m|mm)$/.test(file);
const kindOf = (kind) => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} target`;

const isBelow = (version, floor) => {
    const [major, minor] = version.split('.').map(Number);
    const [floorMajor, floorMinor] = floor.split('.').map(Number);
    return major < floorMajor || (major === floorMajor && minor < floorMinor);
};

// A target's name and kind, of the keys a target takes alone.
export function checkedTargetKind(at, target) {
    const unknown = Object.keys(target).find((key) => !TARGET_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${at} takes ${TARGET_KEYS.join(', ')}; ${unknown} is none of them.`);
    if (typeof target.name !== 'string' || !NAME.test(target.name)) {
        throw new Error(`crossbind: ${at}.name ${JSON.stringify(target.name)} is no name of lowercase letters and digits, which dashes may join.`);
    }
    if (!Object.hasOwn(KINDS, target.kind)) throw new Error(`crossbind: ${at}.kind ${JSON.stringify(target.kind)} is none of ${Object.keys(KINDS).join(', ')}.`);
}

function checkedActivation(at, activation) {
    const isTaken = (key, value) => Object.hasOwn(ACTIVATION, key) && (key === 'text' ? value === true : Number.isInteger(value) && value >= 1);
    if (activation === null || typeof activation !== 'object' || Array.isArray(activation) || Object.keys(activation).length === 0
        || !Object.entries(activation).every(([key, value]) => isTaken(key, value))) {
        throw new Error(`crossbind: ${at}.activation is no object of ${Object.keys(ACTIVATION).join(', ')}, each a count from 1 and text true, as { images: 10, urls: 1 } is.`);
    }
}

// What a target's kind takes and the rest of its own keys, once its sources and the values every part takes are checked.
export function checkedTargetOptions(at, target, sources) {
    const { kind } = target;
    for (const key of KIND_KEYS) {
        const isGiven = target[key] !== undefined;
        if (isGiven && !KINDS[kind].needs.includes(key) && !KINDS[kind].takes.includes(key)) throw new Error(`crossbind: ${at}, ${kindOf(kind)}, takes no ${key}.`);
        if (!isGiven && KINDS[kind].needs.includes(key)) throw new Error(`crossbind: ${at}, ${kindOf(kind)}, has no ${key}: ${NEEDED[key]}.`);
    }
    if (kind === 'widget' && !sources.some((file) => file.endsWith('.swift'))) {
        throw new Error(`crossbind: ${at} is a widget, whose SwiftUI needs a Swift source among its sources.`);
    }
    if (target.principalClass !== undefined && (typeof target.principalClass !== 'string' || !CLASS.test(target.principalClass))) {
        throw new Error(`crossbind: ${at}.principalClass ${JSON.stringify(target.principalClass)} is no class name.`);
    }
    if (target.activation !== undefined) checkedActivation(at, target.activation);
    if (target.categories !== undefined
        && (!Array.isArray(target.categories) || target.categories.length === 0 || !target.categories.every((id) => typeof id === 'string' && id !== ''))) {
        throw new Error(`crossbind: ${at}.categories is no list of the notification categories the target shows.`);
    }
    if (target.extensionPoint !== undefined && (typeof target.extensionPoint !== 'string' || !EXTENSION_POINT.test(target.extensionPoint))) {
        throw new Error(`crossbind: ${at}.extensionPoint ${JSON.stringify(target.extensionPoint)} is no extension point, as com.apple.keyboard-service is.`);
    }
    if (EXTENSION_KIT_POINTS.includes(target.extensionPoint)) {
        throw new Error(`crossbind: ${at}.extensionPoint ${target.extensionPoint} is ExtensionKit's, whose extensions crossbind makes none of yet.`);
    }
    // The attributes of an option its kind takes, which an other target gives itself.
    const written = Object.keys(target.attributes ?? {}).find((key) => Object.hasOwn(WRITTEN_ATTRIBUTES, key) && KINDS[kind].needs.includes(WRITTEN_ATTRIBUTES[key]));
    if (written) throw new Error(`crossbind: ${at}.attributes gives ${written}, which crossbind writes from the target's ${WRITTEN_ATTRIBUTES[written]}.`);
    const own = Object.keys(target.plist ?? {}).find((key) => WRITTEN_KEYS.includes(key));
    if (own) throw new Error(`crossbind: ${at}.plist gives ${own}, which crossbind writes for each target.`);
    const files = ['Info.plist', ...(target.privacy ? ['PrivacyInfo.xcprivacy'] : [])];
    const resource = (target.resources ?? []).find((file) => files.includes(file.split('/').at(-1)));
    if (resource) throw new Error(`crossbind: ${at}.resources names ${resource}, a file crossbind writes into the target's bundle.`);
    const version = target.deploymentTarget;
    if (version !== undefined && (typeof version !== 'string' || !VERSION.test(version))) {
        throw new Error(`crossbind: ${at}.deploymentTarget ${JSON.stringify(version)} is no iOS version, as '17.0' is.`);
    }
    if (version !== undefined && isBelow(version, IOS_DEPLOYMENT_TARGET)) {
        throw new Error(`crossbind: ${at}.deploymentTarget ${version} is below the app's iOS ${IOS_DEPLOYMENT_TARGET}, which each of its targets runs on as well.`);
    }
    if (target.appGroup !== undefined && typeof target.appGroup !== 'boolean') throw new Error(`crossbind: ${at}.appGroup is no boolean.`);
    if (target.displayName !== undefined && (typeof target.displayName !== 'string' || target.displayName.trim() === '')) {
        throw new Error(`crossbind: ${at}.displayName is no name the system shows.`);
    }
}

// The Swift module a target's sources make, whose name takes no dash.
export const targetModule = (name) => name.replace(/-/g, '_');

// A target's Info.plist, as crossbind writes it, with the target's own keys: its bundle, by Xcode's settings, its
// extension point, principal class and attributes, and the App Group it asks for. The principal class of a target
// without Objective-C is Swift's, in its module, as Xcode's templates name it; one beside Objective-C goes by the name its
// runtime knows.
export function targetPlist(target, label, appGroup) {
    const hasObjectiveC = target.sources.some(isObjectiveC);
    const attributes = {
        ...(target.kind === 'notification-content' ? { UNNotificationExtensionInitialContentSizeRatio: 1 } : {}),
        ...target.attributes,
        ...(target.activation ? { NSExtensionActivationRule: Object.fromEntries(Object.entries(target.activation).map(([key, value]) => [ACTIVATION[key], value])) } : {}),
        ...(target.categories ? { UNNotificationExtensionCategory: target.categories.length === 1 ? target.categories[0] : target.categories } : {}),
    };
    const principal = target.principalClass && (hasObjectiveC ? target.principalClass : `$(PRODUCT_MODULE_NAME).${target.principalClass}`);
    return {
        CFBundleDevelopmentRegion: 'en',
        CFBundleDisplayName: target.displayName ?? label,
        CFBundleExecutable: '$(EXECUTABLE_NAME)',
        CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
        CFBundleInfoDictionaryVersion: '6.0',
        CFBundleName: '$(PRODUCT_NAME)',
        CFBundlePackageType: '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
        CFBundleShortVersionString: '$(MARKETING_VERSION)',
        CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
        NSExtension: {
            NSExtensionPointIdentifier: target.extensionPoint ?? KINDS[target.kind].point,
            ...(principal ? { NSExtensionPrincipalClass: principal } : {}),
            ...(Object.keys(attributes).length > 0 ? { NSExtensionAttributes: attributes } : {}),
        },
        ...(target.appGroup ? { [APP_GROUP_KEY]: appGroup } : {}),
        ...target.plist,
    };
}
