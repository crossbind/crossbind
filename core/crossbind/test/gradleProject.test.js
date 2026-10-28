import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const state = { config: { general: { name: 'demo-app' }, target: {}, app: {}, paths: {} }, targets: [] };
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
