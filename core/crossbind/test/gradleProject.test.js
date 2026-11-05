import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const state = { config: { general: { name: 'demo-app' }, target: {}, app: {}, paths: {}, extensions: [] }, targets: [] };
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: writeGradleProject } = await import('../src/actions/gradleProject.js');
const { androidVersion, appBuildNumber, publishApp } = await import('../src/actions/buildApp.js');

function part(root, arch) {
    const dir = path.join(root, `demo-app.android-${arch}`);
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'app', 'page'), { recursive: true });
    ['libcrossbind_app.so', 'libjsi.so', 'libc++_shared.so'].forEach((lib) => fs.writeFileSync(path.join(dir, 'lib', lib), `${arch} ${lib}`));
    fs.writeFileSync(path.join(dir, 'app', 'host.hbc'), 'bytecode');
    return { arch, dir };
}

describe("an Android app's Gradle project", () => {
    test("packages each ABI's libraries and the app's files, under the app's id, name and version", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'with space', 'demo-app-android');

        writeGradleProject(to, {
            parts: [part(root, 'arm64-v8a'), part(root, 'x86_64')],
            id: 'com.example.demo',
            label: "Demo's App",
            version: { name: '1.2.3-beta.1', code: 1002003 },
        });

        const main = path.join(to, 'app', 'src', 'main');
        const gradle = fs.readFileSync(path.join(to, 'app', 'build.gradle'), 'utf8');
        expect(fs.readFileSync(path.join(main, 'jniLibs', 'x86_64', 'libcrossbind_app.so'), 'utf8')).toBe('x86_64 libcrossbind_app.so');
        expect(fs.readFileSync(path.join(main, 'jniLibs', 'arm64-v8a', 'libc++_shared.so'), 'utf8')).toBe('arm64-v8a libc++_shared.so');
        expect(fs.readFileSync(path.join(main, 'assets', 'app', 'host.hbc'), 'utf8')).toBe('bytecode');
        expect(fs.existsSync(path.join(main, 'java', 'dev', 'crossbind', 'app', 'CrossbindActivity.java'))).toBe(true);
        expect(fs.readFileSync(path.join(main, 'java', 'dev', 'crossbind', 'app', 'Extensions.java'), 'utf8'))
            .toContain('        Map<String, Extension> all = new LinkedHashMap<>();\n        ALL = Collections.unmodifiableMap(all);\n');
        expect(gradle).toContain("applicationId 'com.example.demo'");
        expect(gradle).toContain('versionCode 1002003');
        expect(gradle).toContain("versionName '1.2.3-beta.1'");
        expect(gradle).toContain("abiFilters 'arm64-v8a', 'x86_64'");
        expect(gradle).toContain("manifestPlaceholders = [appName: 'Demo\\'s App', appIcon: '@android:drawable/sym_def_app_icon', launchMode: 'standard', appTheme: '@android:style/Theme.DeviceDefault.DayNight']");
        expect(fs.existsSync(path.join(main, 'res', 'mipmap-anydpi'))).toBe(false);
        expect(gradle).toMatch(/implementation\('com\.facebook\.hermes:hermes-android:\d+\.\d+\.\d+'\)/);
        // Android's default pattern would leave out the page's _app and .well-known directories.
        expect(gradle).toContain("ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'");
        if (process.platform !== 'win32') expect(fs.statSync(path.join(to, 'gradlew')).mode & 0o111).not.toBe(0);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('asks Maven for nothing the android-app image did not resolve, so the image builds it offline', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo-app-android');
        writeGradleProject(to, { parts: [part(root, 'arm64-v8a'), part(root, 'x86_64')], id: 'com.example.demo', label: 'demo-app', version: { name: '1.0.0', code: 1 } });
        const image = path.join(import.meta.dirname, '..', '..', '..', 'tooling', 'docker', 'android-app');
        const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        for (const file of ['settings.gradle', 'build.gradle', 'gradle.properties']) {
            expect(read(path.join(image, file))).toBe(read(path.join(to, file)));
        }
        // The image's verification metadata, which an app whose extensions ask Maven for more verifies by, with theirs.
        expect(read(path.join(import.meta.dirname, '..', '..', 'app-host', 'android-verification-metadata.xml')))
            .toBe(read(path.join(image, 'gradle', 'verification-metadata.xml')));
        expect(fs.existsSync(path.join(to, 'gradle', 'verification-metadata.xml'))).toBe(false);
        const written = read(path.join(to, 'app', 'build.gradle'));
        const warmed = read(path.join(image, 'app', 'build.gradle'));
        const block = (text, name) => text.match(new RegExp(`^( *)${name} \\{[\\s\\S]*?^\\1\\}`, 'm'))?.[0];
        for (const name of ['lint', 'packaging', 'dependencies']) {
            expect(block(warmed, name)).toBeTruthy();
            expect(block(warmed, name)).toBe(block(written, name));
        }
        expect(warmed.match(/^ {4}compileSdk \d+$/m)?.[0]).toBe(written.match(/^ {4}compileSdk \d+$/m)?.[0]);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("launches with the app's icon: its foregrounds, and the adaptive icon that puts them on white", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo-app-android');
        const icons = { 'mipmap-mdpi/ic_launcher_foreground.png': 'mdpi png', 'mipmap-xxxhdpi/ic_launcher_foreground.png': 'xxxhdpi png' };
        writeGradleProject(to, { parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 }, icons });
        const res = path.join(to, 'app', 'src', 'main', 'res');
        expect(fs.readFileSync(path.join(res, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'), 'utf8')).toBe('xxxhdpi png');
        expect(fs.readFileSync(path.join(res, 'mipmap-anydpi', 'ic_launcher.xml'), 'utf8'))
            .toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground" />');
        expect(fs.readFileSync(path.join(to, 'app', 'build.gradle'), 'utf8')).toContain("appIcon: '@mipmap/ic_launcher'");
        expect(fs.readFileSync(path.join(to, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')).toContain('android:icon="${appIcon}"');
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('shows app.window.backgroundColor in its theme until the page paints, and none without it', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const projectOf = (background) => {
            const to = path.join(root, `demo-${background ?? 'none'}`);
            writeGradleProject(to, { parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 }, background });
            const main = path.join(to, 'app', 'src', 'main');
            return {
                manifest: fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8'),
                gradle: fs.readFileSync(path.join(to, 'app', 'build.gradle'), 'utf8'),
                values: fs.readFileSync(path.join(main, 'res', 'values', 'background.xml'), 'utf8'),
            };
        };
        const colored = projectOf('#1e1e1e');
        expect(colored.manifest).toContain('android:theme="${appTheme}"');
        expect(colored.gradle).toContain("appTheme: '@style/CrossbindBackground'");
        expect(colored.values).toContain('<color name="crossbind_background">#1e1e1e</color>');
        expect(colored.values).toContain('<style name="CrossbindBackground" parent="@android:style/Theme.DeviceDefault.DayNight">');
        expect(colored.values).toContain('<item name="android:windowBackground">@color/crossbind_background</item>');
        const plain = projectOf(null);
        expect(plain.gradle).toContain("appTheme: '@android:style/Theme.DeviceDefault.DayNight'");
        expect(plain.values).toContain('<color name="crossbind_background">#00000000</color>');
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('opens the links of app.urlSchemes in its one activity, which a link that comes while it runs reaches as well', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const projectOf = (urlSchemes) => {
            const to = path.join(root, `demo-${urlSchemes.length}`);
            writeGradleProject(to, { parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 }, urlSchemes });
            return {
                manifest: fs.readFileSync(path.join(to, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8'),
                gradle: fs.readFileSync(path.join(to, 'app', 'build.gradle'), 'utf8'),
            };
        };
        const { manifest, gradle } = projectOf(['myapp', 'other']);
        expect(manifest).toContain('android:launchMode="${launchMode}"');
        expect(gradle).toContain("launchMode: 'singleTask'");
        expect(manifest).toContain([
            '                <action android:name="android.intent.action.VIEW" />',
            '                <category android:name="android.intent.category.DEFAULT" />',
            '                <category android:name="android.intent.category.BROWSABLE" />',
            '                <data android:scheme="myapp" />',
            '                <data android:scheme="other" />',
            '            </intent-filter>',
            '        </activity>',
        ].join('\n'));
        const plain = projectOf([]);
        expect(plain.manifest).not.toContain('android.intent.action.VIEW');
        expect(plain.gradle).toContain("launchMode: 'standard'");
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("opens app.fileTypes' files by their MIME types, else their extensions, and app.links' https links, which Android verifies", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo');
        writeGradleProject(to, {
            parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 },
            fileTypes: [
                { name: 'GeoJSON', extensions: ['geojson'], mimeTypes: ['application/geo+json'], role: 'editor', contentTypes: [] },
                { name: 'Track', extensions: ['trk'], mimeTypes: [], role: 'viewer', contentTypes: [] },
            ],
            links: ['example.com/invite', '*.example.org'],
        });
        const manifest = fs.readFileSync(path.join(to, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
        const data = (lines) => lines.map((line) => `                <data ${line} />`).join('\n');
        expect(manifest).toContain(data(['android:scheme="content"', 'android:mimeType="application/geo+json"']));
        expect(manifest).not.toContain('android:scheme="file"');
        expect(manifest).toContain(data([
            'android:scheme="content"', 'android:host="*"', 'android:mimeType="*/*"',
            'android:pathPattern=".*\\\\.trk"', 'android:pathPattern=".*\\\\..*\\\\.trk"',
        ]));
        expect(manifest).toContain([
            '            <intent-filter android:autoVerify="true">',
            '                <action android:name="android.intent.action.VIEW" />',
            '                <category android:name="android.intent.category.DEFAULT" />',
            '                <category android:name="android.intent.category.BROWSABLE" />',
            data(['android:scheme="https"', 'android:host="example.com"', 'android:pathPrefix="/invite"']),
            '            </intent-filter>',
        ].join('\n'));
        expect(manifest).toContain(data(['android:scheme="https"', 'android:host="*.example.org"']));
        expect(fs.readFileSync(path.join(to, 'app', 'build.gradle'), 'utf8')).toContain("launchMode: 'singleTask'");
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("asks Maven for its extensions' libraries, checking each file Gradle resolves by the image's metadata and theirs", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo-app-android');
        const verification = path.join(root, 'verification-metadata.xml');
        fs.writeFileSync(verification, [
            '<verification-metadata>', '   <components>', '      <component group="com.example" name="demo-library" version="1.0.0">',
            '         <artifact name="demo-library-1.0.0.jar">', '            <sha256 value="91c7" origin="Generated by Gradle"/>', '         </artifact>',
            '      </component>', '   </components>', '</verification-metadata>', '',
        ].join('\n'));
        writeGradleProject(to, {
            parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 },
            maven: [{ name: 'probe', coordinates: ['com.example:demo-library:1.0.0'], verification }],
        });
        expect(fs.readFileSync(path.join(to, 'app', 'build.gradle'), 'utf8')).toContain("    implementation 'com.example:demo-library:1.0.0'\n}\n");
        const merged = fs.readFileSync(path.join(to, 'gradle', 'verification-metadata.xml'), 'utf8');
        expect(merged).toContain('<component group="com.example" name="demo-library" version="1.0.0">');
        expect(merged).toContain('<component group="androidx.webkit" name="webkit"');
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("takes each extension's Java beside the activity, which calls its class, and refuses one that brings a file the project has", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo-app-android');
        const javaOf = (name, file, className) => {
            const dir = path.join(root, name, 'android');
            fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
            fs.writeFileSync(path.join(dir, file), `package ${className.replace(/\.[^.]+$/, '')};`);
            return { name, dir, className };
        };
        const write = (java) => writeGradleProject(to, { parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 }, java });
        const clipboard = path.join('dev', 'crossbind', 'clipboard', 'ClipboardExtension.java');
        const kotlin = path.join('dev', 'crossbind', 'storage', 'Keychain.kt');
        const storage = javaOf('secure-storage', path.join('dev', 'crossbind', 'storage', 'StorageExtension.java'), 'dev.crossbind.storage.StorageExtension');
        fs.writeFileSync(path.join(storage.dir, kotlin), 'package dev.crossbind.storage');
        write([javaOf('clipboard', clipboard, 'dev.crossbind.clipboard.ClipboardExtension'), storage]);
        const sources = path.join(to, 'app', 'src', 'main', 'java');
        expect(fs.readFileSync(path.join(sources, clipboard), 'utf8')).toBe('package dev.crossbind.clipboard;');
        // Kotlin beside the Java, which the Android Gradle plugin compiles with it.
        expect(fs.readFileSync(path.join(sources, kotlin), 'utf8')).toBe('package dev.crossbind.storage');
        expect(fs.existsSync(path.join(sources, 'dev', 'crossbind', 'app', 'CrossbindActivity.java'))).toBe(true);
        // In the extensions' order, in which each hears what the activity does.
        expect(fs.readFileSync(path.join(sources, 'dev', 'crossbind', 'app', 'Extensions.java'), 'utf8')).toContain(`        Map<String, Extension> all = new LinkedHashMap<>();
        all.put("clipboard", new dev.crossbind.clipboard.ClipboardExtension());
        all.put("secure-storage", new dev.crossbind.storage.StorageExtension());
        ALL = Collections.unmodifiableMap(all);
`);
        for (const [name, file] of [['activity', 'CrossbindActivity.java'], ['registry', 'Extensions.java']]) {
            const shadow = path.join('dev', 'crossbind', 'app', file);
            expect(() => write([javaOf(name, shadow, 'dev.crossbind.app.Shadow')]))
                .toThrow(`crossbind: the extension ${name} has ${shadow} in its Java, which the app's Gradle project has already.`);
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('is not written from no part at all', () => {
        expect(() => writeGradleProject(path.join(os.tmpdir(), 'crossbind-none'), { parts: [], id: 'a.b', version: { name: '1', code: 1 } }))
            .toThrow('no part of the Android app demo-app is built');
    });

    test("takes only an Android application id, which it makes from the project's name without app.id", () => {
        const android = { platform: 'android', arch: 'x86_64', buildType: 'release' };
        const to = path.join(os.tmpdir(), 'crossbind-android-id');
        state.config.app = { id: 'com.example.my-app' };
        expect(() => publishApp(android, { to })).toThrow('"com.example.my-app" (app.id, else made from the project\'s name) is no Android application id');
        state.config.app = {};
        // dev.crossbind.demo_app passes, and only the missing parts stop the project.
        expect(() => publishApp(android, { to })).toThrow('no part of the Android app demo-app is built');
        state.config.general.name = '3d-viewer';
        expect(() => publishApp(android, { to })).toThrow('"dev.crossbind.3d_viewer" (app.id, else made');
        state.config.general.name = 'demo-app';
    });

    test('asks for the Android permissions behind app.permissions, and no other', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const manifestOf = (permissions) => {
            const to = path.join(root, `demo-${permissions.length}`);
            writeGradleProject(to, { parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 }, permissions });
            return fs.readFileSync(path.join(to, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
        };
        expect(manifestOf(['camera', 'location'])).toContain([
            '    <uses-permission android:name="android.permission.INTERNET" />',
            '    <uses-permission android:name="android.permission.CAMERA" />',
            '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
            '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
        ].join('\n'));
        expect(manifestOf(['microphone'])).toContain('android.permission.RECORD_AUDIO');
        const plain = manifestOf([]);
        expect(plain).toContain('android.permission.INTERNET');
        expect(plain.match(/uses-permission/g)).toHaveLength(1);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("asks for its extensions' permissions too, each once, and takes their manifests' elements and their resources", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo-app-android');
        const file = path.join(root, 'share', 'AndroidManifest.xml');
        fs.mkdirSync(path.join(root, 'share', 'res', 'xml'), { recursive: true });
        fs.writeFileSync(file, [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<!-- <application android:label="not this one"> -->',
            '<!<!---->-- <application android:label="nor this one, which one pass of removing comments leaves"> -->',
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
            '    <queries>',
            '        <intent><action android:name="android.intent.action.SEND" /></intent>',
            '    </queries>',
            '    <application>',
            '        <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.share"',
            '            android:exported="false" android:grantUriPermissions="true">',
            '            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/share_paths" />',
            '        </provider>',
            '    </application>',
            '</manifest>',
        ].join('\n'));
        fs.writeFileSync(path.join(root, 'share', 'res', 'xml', 'share_paths.xml'), '<paths><cache-path name="shared" path="shared/" /></paths>\n');
        writeGradleProject(to, {
            parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 }, permissions: ['camera'],
            extensionPermissions: ['android.permission.CAMERA', 'android.permission.READ_CONTACTS'], manifests: [{ name: 'share', file }],
            resources: [{ name: 'share', dir: path.join(root, 'share', 'res') }],
        });
        const main = path.join(to, 'app', 'src', 'main');
        const manifest = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
        expect(manifest).toContain([
            '    <uses-permission android:name="android.permission.INTERNET" />',
            '    <uses-permission android:name="android.permission.CAMERA" />',
            '    <uses-permission android:name="android.permission.READ_CONTACTS" />',
            '    <queries>',
            '        <intent><action android:name="android.intent.action.SEND" /></intent>',
            '    </queries>',
        ].join('\n'));
        expect(manifest).toContain([
            '        <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.share"',
            '            android:exported="false" android:grantUriPermissions="true">',
            '            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/share_paths" />',
            '        </provider>',
            '    </application>',
        ].join('\n'));
        expect(manifest).not.toContain('not this one');
        expect(manifest.match(/android\.permission\.CAMERA/g)).toHaveLength(1);
        expect(fs.readFileSync(path.join(main, 'res', 'xml', 'share_paths.xml'), 'utf8')).toContain('cache-path');
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('takes the Java alone of folders that hold a manifest and resources too, as two extensions of that layout have', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo-app-android');
        const extensionOf = (name) => {
            const dir = path.join(root, name, 'android');
            const className = `dev.crossbind.${name}.Extension`;
            fs.mkdirSync(path.join(dir, 'dev', 'crossbind', name), { recursive: true });
            fs.mkdirSync(path.join(dir, 'res', 'values'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'dev', 'crossbind', name, 'Extension.java'), `package dev.crossbind.${name};`);
            fs.writeFileSync(path.join(dir, 'AndroidManifest.xml'), `<manifest xmlns:android="x"><application><meta-data android:name="${name}" android:value="a$&b$'" /></application></manifest>`);
            fs.writeFileSync(path.join(dir, 'res', 'values', `${name}.xml`), '<resources />');
            return {
                java: { name, dir, className }, manifest: { name, file: path.join(dir, 'AndroidManifest.xml') }, resources: { name, dir: path.join(dir, 'res') },
            };
        };
        const extensions = [extensionOf('first'), extensionOf('second')];

        writeGradleProject(to, {
            parts: [part(root, 'x86_64')],
            id: 'com.example.demo',
            label: 'Demo',
            version: { name: '1.0.0', code: 1 },
            java: extensions.map(({ java }) => java),
            manifests: extensions.map(({ manifest }) => manifest),
            resources: extensions.map(({ resources }) => resources),
        });

        const main = path.join(to, 'app', 'src', 'main');
        expect(fs.readdirSync(path.join(main, 'java'))).toEqual(['dev']);
        expect(fs.existsSync(path.join(main, 'java', 'dev', 'crossbind', 'second', 'Extension.java'))).toBe(true);
        expect(fs.existsSync(path.join(main, 'res', 'values', 'first.xml'))).toBe(true);
        const manifest = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
        expect(manifest).toContain('<meta-data android:name="first" android:value="a$&b$\'" />');
        expect(manifest).toContain('<meta-data android:name="second" android:value="a$&b$\'" />');
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("refuses an extension's manifest that gives the app's application attributes or a prefix of its own, and a resource the app has", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-'));
        const to = path.join(root, 'demo-app-android');
        const write = (options) => writeGradleProject(to, { parts: [part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 }, ...options });
        const manifestOf = (text) => {
            const file = path.join(root, `manifest-${text.length}.xml`);
            fs.writeFileSync(file, text);
            return [{ name: 'share', file }];
        };
        expect(() => write({ manifests: manifestOf('<manifest xmlns:android="x"><application android:label="Share"></application></manifest>') }))
            .toThrow("gives its <application> attributes, which are the app's own: it holds what the extension adds to the app's alone.");
        expect(() => write({ manifests: manifestOf('<manifest xmlns:dist="y"><uses-feature android:name="a" /></manifest>') }))
            .toThrow("declares the prefix dist, which the app's has not: it takes android and tools.");
        expect(() => write({ manifests: manifestOf('<uses-permission android:name="a" />') })).toThrow('is no <manifest> of elements, as an AndroidManifest.xml is.');
        expect(() => write({ manifests: manifestOf('<manifest xmlns:android="x" package="com.example.share"><application /></manifest>') }))
            .toThrow("gives its <manifest> package, which is the app's own.");
        expect(() => write({ manifests: manifestOf('<manifest xmlns:android="x">\n<uses-permission android:name="android.permission.CAMERA"/>\n</manifest>') }))
            .toThrow('asks for a permission with <uses-permission>, which its app.android.permissions lists, as the app asks for each once.');
        // A refused manifest leaves the project written before as it was.
        write({});
        fs.writeFileSync(path.join(to, 'kept.txt'), 'kept');
        expect(() => write({ manifests: manifestOf('<manifest xmlns:dist="y"></manifest>') })).toThrow('declares the prefix dist');
        expect(fs.existsSync(path.join(to, 'kept.txt'))).toBe(true);
        fs.mkdirSync(path.join(root, 'res', 'values'), { recursive: true });
        fs.writeFileSync(path.join(root, 'res', 'values', 'background.xml'), '<resources />');
        expect(() => write({ resources: [{ name: 'theme', dir: path.join(root, 'res') }] }))
            .toThrow(`crossbind: the extension theme has ${path.join('values', 'background.xml')} in its resources, which the app's Gradle project has already.`);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('takes app.window.backgroundColor as #rrggbb alone, before it writes the project', () => {
        const android = { platform: 'android', arch: 'x86_64', buildType: 'release' };
        state.config.app = { window: { backgroundColor: 'red' } };
        expect(() => publishApp(android, { to: path.join(os.tmpdir(), 'crossbind-android-color') })).toThrow('app.window.backgroundColor "red" is no color');
        state.config.app = {};
    });

    test('takes the devices of app.permissions alone, before it writes the project', () => {
        const android = { platform: 'android', arch: 'x86_64', buildType: 'release' };
        state.config.app = { permissions: { contacts: 'To invite friends' } };
        expect(() => publishApp(android, { to: path.join(os.tmpdir(), 'crossbind-android-permissions') })).toThrow('contacts is none of them');
        state.config.app = {};
    });
});

describe("a mobile app's build number", () => {
    test('is CROSSBIND_APP_BUILD_NUMBER, a whole number both stores take, else none', () => {
        expect(appBuildNumber({})).toBe(null);
        expect(appBuildNumber({ CROSSBIND_APP_BUILD_NUMBER: '42' })).toBe(42);
        for (const value of ['0', '-1', '1.5', '01', 'x', '2100000001']) {
            expect(() => appBuildNumber({ CROSSBIND_APP_BUILD_NUMBER: value })).toThrow(`CROSSBIND_APP_BUILD_NUMBER ${JSON.stringify(value)} is no build number, which is a whole number from 1 to 2100000000`);
        }
    });

    test("is an Android app's version code, else its version's numbers make one", () => {
        state.config.package = { version: '1.2.3-beta.1' };
        expect(androidVersion({})).toEqual({ name: '1.2.3-beta.1', code: 1002003 });
        expect(androidVersion({ CROSSBIND_APP_BUILD_NUMBER: '7' })).toEqual({ name: '1.2.3-beta.1', code: 7 });
        delete state.config.package;
    });

    test('stops a build it cannot number before its project is written', () => {
        vi.stubEnv('CROSSBIND_APP_BUILD_NUMBER', 'next');
        const android = { platform: 'android', arch: 'x86_64', buildType: 'release' };
        expect(() => publishApp(android, { to: path.join(os.tmpdir(), 'crossbind-android-number') })).toThrow('CROSSBIND_APP_BUILD_NUMBER "next" is no build number');
        vi.unstubAllEnvs();
    });
});

describe("an Android release's native debug symbols", () => {
    test("sit by ABI in the Gradle project's symbols/, as each part kept its libraries as linked", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-gradle-symbols-'));
        const arm = part(root, 'arm64-v8a');
        fs.mkdirSync(path.join(arm.dir, 'symbols'));
        fs.writeFileSync(path.join(arm.dir, 'symbols', 'libcrossbind_app.so'), 'unstripped');
        const to = path.join(root, 'demo-app-android');
        writeGradleProject(to, { parts: [arm, part(root, 'x86_64')], id: 'com.example.demo', label: 'Demo', version: { name: '1.0.0', code: 1 } });
        expect(fs.readFileSync(path.join(to, 'symbols', 'arm64-v8a', 'libcrossbind_app.so'), 'utf8')).toBe('unstripped');
        expect(fs.existsSync(path.join(to, 'symbols', 'x86_64'))).toBe(false);
        expect(fs.existsSync(path.join(to, 'app', 'src', 'main', 'jniLibs', 'arm64-v8a', 'symbols'))).toBe(false);
        fs.rmSync(root, { recursive: true, force: true });
    });
});
