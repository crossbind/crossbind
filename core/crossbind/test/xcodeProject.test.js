import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const state = {
    config: {
        general: { name: 'demo' }, target: {}, app: {}, system: { XCODE_DEVELOPMENT_TEAM: '' }, paths: {},
    },
    targets: [],
};
vi.mock('../src/state/index.js', () => ({ default: state }));
// xcodebuild makes Hermes' xcframework; here an empty folder stands in for it.
const spawnSync = vi.fn((program, args) => {
    fs.mkdirSync(args[args.indexOf('-output') + 1], { recursive: true });
    return { status: 0, stdout: '', stderr: '' };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));

const { xmlPlist, textPlist } = await import('../src/utils/plist.js');
const { default: writeXcodeProject } = await import('../src/actions/xcodeProject.js');
const { publishApp } = await import('../src/actions/buildApp.js');
const { execFileSync } = await vi.importActual('node:child_process');

function part(root, sdk) {
    const dir = path.join(root, `demo.ios-${sdk}`);
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app', 'page'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'hermesvm.framework'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'lib', '0-libdemo.a'), 'archive');
    fs.writeFileSync(path.join(dir, 'app', 'host.hbc'), 'bytecode');
    fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(['-Wl,-force_load,{lib}/0-libdemo.a', '-Wl,-u,_crossbind_keep_demo']));
    return { sdk, dir };
}

describe('property lists', () => {
    test('an XML one indents as the macOS Info.plist always has', () => {
        expect(xmlPlist({ CFBundleName: 'a & b', NSHighResolutionCapable: true })).toBe('<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            + '<plist version="1.0">\n<dict>\n    <key>CFBundleName</key>\n    <string>a &amp; b</string>\n'
            + '    <key>NSHighResolutionCapable</key>\n    <true/>\n</dict>\n</plist>\n');
    });

    test('an XML one writes a number an integer element reads back the same as one, and any other as a real', () => {
        expect(xmlPlist({ a: 3, b: -2, c: 1.5, d: 1e21 })).toContain('<integer>3</integer>\n    <key>b</key>\n    <integer>-2</integer>\n'
            + '    <key>c</key>\n    <real>1.5</real>\n    <key>d</key>\n    <real>1e+21</real>');
    });

    test('the text one quotes every value, escaping quotes and backslashes', () => {
        expect(textPlist({ a: ['x "y"', 'c:\\d'], b: { c: 1 } })).toBe('// !$*UTF8*$!\n{\n\t"a" = (\n\t\t"x \\"y\\"",\n\t\t"c:\\\\d",\n\t);\n'
            + '\t"b" = {\n\t\t"c" = "1";\n\t};\n}\n');
    });
});

describe('an iOS app\'s Xcode project', () => {
    test('links each SDK\'s archives from beside the project, signed by the app\'s team', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'with space', 'demo-ios');
        const sim = part(root, 'iphonesimulator');

        writeXcodeProject(to, { parts: [sim], identity: { id: 'com.example.demo', team: 'ABCDE12345' }, label: 'Demo & App', version: '1.2.3' });

        const project = fs.readFileSync(path.join(to, 'demo.xcodeproj', 'project.pbxproj'), 'utf8');
        expect(fs.readFileSync(path.join(to, 'lib', 'iphonesimulator', '0-libdemo.a'), 'utf8')).toBe('archive');
        expect(fs.readFileSync(path.join(to, 'app', 'host.hbc'), 'utf8')).toBe('bytecode');
        expect(project).toContain('"OTHER_LDFLAGS[sdk=iphonesimulator*]" = (\n\t\t\t\t\t"-Wl,-force_load,\\"$(PROJECT_DIR)/lib/iphonesimulator/0-libdemo.a\\"",');
        expect(project).toContain('"-Wl,-u,_crossbind_keep_demo",');
        // The host's own code checks certificates, whatever the app's extensions link.
        expect(project).toContain('"-framework",\n\t\t\t\t\t"Security",');
        expect(project).not.toContain('iphoneos*');
        expect(project).toContain('"PRODUCT_BUNDLE_IDENTIFIER" = "com.example.demo";');
        expect(project).toContain('"DEVELOPMENT_TEAM" = "ABCDE12345";');
        expect(project).toContain('"MARKETING_VERSION" = "1.2.3";');
        expect(fs.readFileSync(path.join(to, 'Info.plist'), 'utf8')).toContain('<key>LSRequiresIPhoneOS</key>\n    <true/>');
        expect(fs.readFileSync(path.join(to, 'Info.plist'), 'utf8')).toContain('<key>CFBundleDisplayName</key>\n    <string>Demo &amp; App</string>');
        expect(fs.readFileSync(path.join(to, 'main.m'), 'utf8')).toContain('return crossbind_app_main(argc, argv);');
        expect(spawnSync).toHaveBeenCalledWith('xcodebuild', [
            '-create-xcframework', '-framework', `${sim.dir}/hermesvm.framework`, '-output', `${to}/Frameworks/hermesvm.xcframework`,
        ], { encoding: 'utf8' });
        if (process.platform === 'darwin') {
            expect(execFileSync('plutil', ['-lint', path.join(to, 'demo.xcodeproj', 'project.pbxproj')], { encoding: 'utf8' })).toContain(': OK');
        }
    });

    test("lets an iPad's system and page open more of the app's windows where app.ios.multipleWindows says so", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const scenes = (multipleWindows) => {
            const to = path.join(root, String(multipleWindows));
            writeXcodeProject(to, { parts: [part(root, 'iphonesimulator')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1.0.0', multipleWindows });
            return fs.readFileSync(path.join(to, 'Info.plist'), 'utf8');
        };

        expect(scenes(true)).toContain('<key>UIApplicationSupportsMultipleScenes</key>\n        <true/>');
        expect(scenes(false)).toContain('<key>UIApplicationSupportsMultipleScenes</key>\n        <false/>');
    });

    test("has the app's icon in an asset catalog, from which Xcode makes every size", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        writeXcodeProject(to, { parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1', icon: 'png' });

        const set = path.join(to, 'Assets.xcassets', 'AppIcon.appiconset');
        const project = fs.readFileSync(path.join(to, 'demo.xcodeproj', 'project.pbxproj'), 'utf8');
        expect(fs.readFileSync(path.join(set, 'icon.png'), 'utf8')).toBe('png');
        expect(JSON.parse(fs.readFileSync(path.join(set, 'Contents.json'), 'utf8')).images)
            .toEqual([{ filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }]);
        expect(project).toContain('"path" = "Assets.xcassets";');
        expect(project).toContain('"ASSETCATALOG_COMPILER_APPICON_NAME" = "AppIcon";');
        // The launch screen keeps the system's color.
        expect(fs.existsSync(path.join(to, 'Assets.xcassets', 'LaunchBackground.colorset'))).toBe(false);
        expect(fs.readFileSync(path.join(to, 'Info.plist'), 'utf8')).toContain('<key>UILaunchScreen</key>\n    <dict/>');
        if (process.platform === 'darwin') {
            expect(execFileSync('plutil', ['-lint', path.join(to, 'demo.xcodeproj', 'project.pbxproj')], { encoding: 'utf8' })).toContain(': OK');
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('launches on app.window.backgroundColor, from a color set of its asset catalog', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        writeXcodeProject(to, { parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1', background: '#1e2a3b' });

        const set = JSON.parse(fs.readFileSync(path.join(to, 'Assets.xcassets', 'LaunchBackground.colorset', 'Contents.json'), 'utf8'));
        const project = fs.readFileSync(path.join(to, 'demo.xcodeproj', 'project.pbxproj'), 'utf8');
        expect(set.colors).toEqual([{ color: { 'color-space': 'srgb', components: { alpha: '1.000', red: '0x1E', green: '0x2A', blue: '0x3B' } }, idiom: 'universal' }]);
        expect(fs.readFileSync(path.join(to, 'Info.plist'), 'utf8')).toContain('<key>UILaunchScreen</key>\n    <dict>\n        <key>UIColorName</key>\n        <string>LaunchBackground</string>');
        expect(project).toContain('"path" = "Assets.xcassets";');
        expect(project).not.toContain('ASSETCATALOG_COMPILER_APPICON_NAME');
        if (process.platform === 'darwin') {
            expect(execFileSync('plutil', ['-extract', 'UILaunchScreen.UIColorName', 'raw', path.join(to, 'Info.plist')], { encoding: 'utf8' }).trim()).toBe('LaunchBackground');
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('gives iOS the reasons of app.permissions, without which it lets the app use none of those devices', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        writeXcodeProject(to, {
            parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1',
            usage: { NSCameraUsageDescription: 'To scan & read barcodes' },
        });

        expect(fs.readFileSync(path.join(to, 'Info.plist'), 'utf8')).toContain('<key>NSCameraUsageDescription</key>\n    <string>To scan &amp; read barcodes</string>');
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("takes the Info.plist keys of the app's extensions, a number as a number, and refuses one crossbind writes otherwise", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        const write = (plist) => writeXcodeProject(to, {
            parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1', plist,
        });
        write([['the extension contacts', { NSContactsUsageDescription: 'To pick a contact', UIBackgroundModes: ['fetch'], ContactsLimit: 25 }]]);
        const plist = fs.readFileSync(path.join(to, 'Info.plist'), 'utf8');
        expect(plist).toContain('<key>NSContactsUsageDescription</key>\n    <string>To pick a contact</string>');
        expect(plist).toContain('<key>UIBackgroundModes</key>\n    <array>\n        <string>fetch</string>\n    </array>');
        expect(plist).toContain('<key>ContactsLimit</key>\n    <integer>25</integer>');
        if (process.platform === 'darwin') {
            expect(execFileSync('plutil', ['-lint', path.join(to, 'Info.plist')], { encoding: 'utf8' })).toContain('OK');
        }
        fs.writeFileSync(path.join(to, 'kept.txt'), 'kept');
        expect(() => write([['the extension rename', { CFBundleDisplayName: 'Other' }]]))
            .toThrow("crossbind: the extension rename gives the Info.plist key CFBundleDisplayName, which crossbind writes from the app's config.");
        // The keys merge before the project goes, so the one written before stays as it was.
        expect(fs.existsSync(path.join(to, 'kept.txt'))).toBe(true);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('opens the links of app.urlSchemes', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        writeXcodeProject(to, { parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1', urlSchemes: ['myapp'] });

        const plist = fs.readFileSync(path.join(to, 'Info.plist'), 'utf8');
        expect(plist).toContain('<key>CFBundleURLSchemes</key>');
        expect(plist).toContain('<string>myapp</string>');
        if (process.platform === 'darwin') {
            const schemeOf = (key) => execFileSync('plutil', ['-extract', key, 'raw', path.join(to, 'Info.plist')], { encoding: 'utf8' }).trim();
            expect(schemeOf('CFBundleURLTypes.0.CFBundleURLSchemes.0')).toBe('myapp');
            expect(schemeOf('CFBundleURLTypes.0.CFBundleURLName')).toBe('$(PRODUCT_BUNDLE_IDENTIFIER)');
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("continues the user activities of app.activityTypes and of the app's extensions", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        writeXcodeProject(to, {
            parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1', activityTypes: ['com.example.demo.edit', 'com.example.notes.open'],
        });

        expect(fs.readFileSync(path.join(to, 'Info.plist'), 'utf8'))
            .toContain('<key>NSUserActivityTypes</key>\n    <array>\n        <string>com.example.demo.edit</string>\n        <string>com.example.notes.open</string>\n    </array>');
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('shows the quick actions of app.shortcutItems and of its extensions on its icon', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        writeXcodeProject(to, {
            parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1',
            shortcutItems: [{ type: 'new-note', title: 'New note', subtitle: 'Blank', icon: 'compose' }, { type: 'scan', title: 'Scan', subtitle: null, icon: null }],
        });

        const plist = fs.readFileSync(path.join(to, 'Info.plist'), 'utf8');
        expect(plist).toContain('<key>UIApplicationShortcutItemIconType</key>\n            <string>UIApplicationShortcutIconTypeCompose</string>');
        if (process.platform === 'darwin') {
            const valueOf = (key) => execFileSync('plutil', ['-extract', key, 'raw', path.join(to, 'Info.plist')], { encoding: 'utf8' }).trim();
            expect(valueOf('UIApplicationShortcutItems.0.UIApplicationShortcutItemSubtitle')).toBe('Blank');
            expect(valueOf('UIApplicationShortcutItems.1.UIApplicationShortcutItemType')).toBe('scan');
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('is not written from no part at all', () => {
        expect(() => writeXcodeProject(path.join(os.tmpdir(), 'crossbind-none'), { parts: [], identity: { id: 'a', team: '' }, version: '1' }))
            .toThrow('no part of the iOS app demo is built');
    });

    test('takes only a bundle id and a team id in their own forms', () => {
        const ios = { platform: 'ios', arch: 'iphoneos', buildType: 'release' };
        state.config.app = { id: 'not an id' };
        expect(() => publishApp(ios, { to: path.join(os.tmpdir(), 'crossbind-id') })).toThrow('app.id "not an id" is no bundle id');
        state.config.app = { id: 'com.example.demo', team: 'team' };
        expect(() => publishApp(ios, { to: path.join(os.tmpdir(), 'crossbind-id') })).toThrow('"team" (app.team or XCODE_DEVELOPMENT_TEAM) is no Apple team id');
        state.config.app = {};
    });
});

describe("an iOS app's store statements", () => {
    const write = (options) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-xcode-'));
        const to = path.join(root, 'demo-ios');
        writeXcodeProject(to, { parts: [part(root, 'iphoneos')], identity: { id: 'com.example.demo', team: '' }, label: 'Demo', version: '1.2.3', ...options });
        return { to, project: fs.readFileSync(path.join(to, 'demo.xcodeproj', 'project.pbxproj'), 'utf8'), info: fs.readFileSync(path.join(to, 'Info.plist'), 'utf8') };
    };

    test("tells App Store Connect app.encryption, so that it stops asking for every build", () => {
        expect(write({ encryption: false }).info).toContain('<key>ITSAppUsesNonExemptEncryption</key>\n    <false/>');
        expect(write({ encryption: true }).info).toContain('<key>ITSAppUsesNonExemptEncryption</key>\n    <true/>');
        expect(write({}).info).not.toContain('ITSAppUsesNonExemptEncryption');
    });

    test("carries a privacy manifest of app.privacy's reasons, and none without them", () => {
        const { to, project } = write({ privacy: { fileTimestamp: ['C617.1'], diskSpace: ['E174.1', '85F4.1'] } });
        const manifest = fs.readFileSync(path.join(to, 'PrivacyInfo.xcprivacy'), 'utf8');
        expect(manifest).toContain('<key>NSPrivacyAccessedAPIType</key>\n            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>');
        expect(manifest).toContain('<string>NSPrivacyAccessedAPICategoryDiskSpace</string>\n            <key>NSPrivacyAccessedAPITypeReasons</key>\n            <array>\n                <string>E174.1</string>\n                <string>85F4.1</string>');
        expect(project).toContain('"path" = "PrivacyInfo.xcprivacy";');
        if (process.platform === 'darwin') {
            expect(execFileSync('plutil', ['-extract', 'NSPrivacyAccessedAPITypes.1.NSPrivacyAccessedAPITypeReasons.1', 'raw', path.join(to, 'PrivacyInfo.xcprivacy')], { encoding: 'utf8' }).trim()).toBe('85F4.1');
            expect(execFileSync('plutil', ['-lint', path.join(to, 'demo.xcodeproj', 'project.pbxproj')], { encoding: 'utf8' })).toContain(': OK');
        }
        const plain = write({});
        expect(fs.existsSync(path.join(plain.to, 'PrivacyInfo.xcprivacy'))).toBe(false);
        expect(plain.project).not.toContain('PrivacyInfo');
    });

    test('is signed with the entitlements its extensions claim, and claims none without them', () => {
        const { to, project } = write({ entitlements: { 'aps-environment': 'development', 'com.apple.developer.associated-domains': ['applinks:example.com'] } });
        const entitlements = fs.readFileSync(path.join(to, 'demo.entitlements'), 'utf8');
        expect(entitlements).toContain('<key>aps-environment</key>\n    <string>development</string>');
        expect(entitlements).toContain('<key>com.apple.developer.associated-domains</key>\n    <array>\n        <string>applinks:example.com</string>\n    </array>');
        expect(project).toContain('"CODE_SIGN_ENTITLEMENTS" = "demo.entitlements";');
        const plain = write({});
        expect(fs.existsSync(path.join(plain.to, 'demo.entitlements'))).toBe(false);
        expect(plain.project).not.toContain('CODE_SIGN_ENTITLEMENTS');
    });

    test("claims the domains of app.links beside its extensions' own, once each, and opens app.fileTypes' documents where they are", () => {
        const { to, info } = write({
            entitlements: { 'com.apple.developer.associated-domains': ['webcredentials:example.com'] },
            links: ['example.com', 'example.com/invite', '*.example.org'],
            fileTypes: [{ name: 'GeoJSON', extensions: ['geojson'], mimeTypes: [], role: 'editor', contentTypes: [] }],
        });
        const entitlements = fs.readFileSync(path.join(to, 'demo.entitlements'), 'utf8');
        expect(entitlements).toContain([
            '<key>com.apple.developer.associated-domains</key>', '    <array>', '        <string>webcredentials:example.com</string>',
            '        <string>applinks:example.com</string>', '        <string>applinks:*.example.org</string>', '    </array>',
        ].join('\n'));
        expect(info).toContain('<key>LSSupportsOpeningDocumentsInPlace</key>\n    <true/>');
        expect(info).toContain('<string>$(PRODUCT_BUNDLE_IDENTIFIER).geojson</string>');
        expect(write({}).info).not.toContain('CFBundleDocumentTypes');
    });

    test('numbers its build as given, else as its version', () => {
        const numbered = write({ build: '42' }).project;
        expect(numbered).toContain('"CURRENT_PROJECT_VERSION" = "42";');
        expect(numbered).toContain('"MARKETING_VERSION" = "1.2.3";');
        expect(write({}).project).toContain('"CURRENT_PROJECT_VERSION" = "1.2.3";');
    });
});

describe("an iOS app's build", () => {
    test('stops on an app.encryption, an app.privacy or a build number it cannot take, before its project is written', () => {
        const ios = { platform: 'ios', arch: 'iphoneos', buildType: 'release' };
        const to = path.join(os.tmpdir(), 'crossbind-ios-statements');
        state.config.app = { encryption: 'no' };
        expect(() => publishApp(ios, { to })).toThrow('app.encryption "no" is no boolean');
        state.config.app = { privacy: { fileTimestamp: ['E174.1'] } };
        expect(() => publishApp(ios, { to })).toThrow('app.privacy.fileTimestamp ["E174.1"] is no list');
        state.config.app = {};
        vi.stubEnv('CROSSBIND_APP_BUILD_NUMBER', '1.0');
        expect(() => publishApp(ios, { to })).toThrow('CROSSBIND_APP_BUILD_NUMBER "1.0" is no build number');
        vi.unstubAllEnvs();
    });
});
