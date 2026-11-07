import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PNG } from 'pngjs';

const state = { config: {}, targets: [] };
vi.mock('../src/utils/appExtensions.js', async (importOriginal) => (await import('./ownTools.js')).default(importOriginal));
vi.mock('../src/state/index.js', () => ({ default: state }));
// What the tools that package an app make, as they would: the last argument of dpkg-deb and hdiutil, the zip in the
// folder zip runs in, makensis's OUTFILE and tar's archive.
function writeMade(command, cwd) {
    const outfile = command.find((arg) => arg.startsWith('-DOUTFILE='))?.slice('-DOUTFILE='.length);
    const made = {
        'dpkg-deb': command.at(-1), hdiutil: command.at(-1), zip: cwd && path.join(cwd, command[4]), makensis: outfile, tar: command[2],
    }[command[0]];
    if (made) fs.writeFileSync(made, command[0]);
}
// tar, which archives a Linux app here; every other command runs as it is.
const tar = vi.fn((args) => {
    writeMade(['tar', ...args]);
    return { status: 0, stdout: '', stderr: '' };
});
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, spawnSync: (command, args, options) => (command === 'tar' ? tar(args, options) : actual.spawnSync(command, args, options)) };
});
// hdiutil and dpkg-deb, which see what they package as it is when they run, and the windows image, which runs makensis
// and zip.
const run = vi.fn();
vi.mock('../src/actions/run.js', () => ({ default: run }));
const inWindowsImage = vi.fn();
vi.mock('../src/actions/windowsSigning.js', async (importOriginal) => ({ ...await importOriginal(), inWindowsImage }));

const { checkInstaller, installersFor, writeInstallers } = await import('../src/actions/appInstaller.js');
const {
    debianControl, debianName, debianVersion, desktopEntry, linuxFileTypes, maintainer, mimePackage,
} = await import('../../../extensions/deb/crossbind.extension.js');
const { fileTypesMacro, publisherOf } = await import('../../../extensions/nsis/crossbind.extension.js');
const { checkedExtension } = await import('../src/utils/appExtensions.js');
const { newUpdaterKey } = await import('../../../extensions/updater/src/update.js');

const roots = [];
afterAll(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// A project with a built app in dist, as publishApp leaves it.
function project(app, {
    name = 'demo', appOptions = {}, pkg = { version: '1.2.0-beta.3' }, extensions = [],
} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-installer-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'build'));
    fs.mkdirSync(path.join(root, 'dist'));
    Object.assign(state.config, {
        general: { name },
        app: appOptions,
        package: pkg,
        extensions,
        paths: { base: root, project: root, build: path.join(root, 'build') },
        system: {},
    });
    Object.entries(app).forEach(([file, content]) => {
        fs.mkdirSync(path.dirname(path.join(root, 'dist', file)), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist', file), content);
    });
    return root;
}

// An installer an extension of the app's gives.
const installer = (name, platform, steps = {}) => checkedExtension({ name, installer: { platform, make: () => [], ...steps } }, '/extensions', 'extensions[0]');

beforeEach(() => {
    run.mockReset();
    run.mockImplementation((program, command, prefix, target, options) => writeMade(command, options?.workdir));
    inWindowsImage.mockReset();
    inWindowsImage.mockImplementation((command, cwd) => writeMade(command, cwd));
    tar.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("a Linux app's Debian package", () => {
    test('is named after the project in lower case, with a hyphen for each underscore and from its first letter or digit', () => {
        expect(debianName('My_App')).toBe('my-app');
        expect(debianName('_My_App')).toBe('my-app');
        expect(debianName('crossbind-e2e-desktop-app')).toBe('crossbind-e2e-desktop-app');
        expect(() => debianName('x')).toThrow('general.name "x" makes no Debian package name');
        expect(() => debianName('Şarkı')).toThrow('Change general.name in crossbind.config.js.');
    });

    test('sorts pre-releases before their release, as semver does', () => {
        expect(debianVersion('1.0.0')).toBe('1.0.0');
        expect(debianVersion('1.0.0-beta.1')).toBe('1.0.0~beta.1');
        expect(debianVersion('2.0.0-rc.1+build.5')).toBe('2.0.0~rc.1+build.5');
    });

    test("names package.json's author as its maintainer, by name and email address", () => {
        expect(maintainer('Ada Lovelace <ada@example.com> (https://example.com)')).toBe('Ada Lovelace <ada@example.com>');
        expect(maintainer({ name: 'Ada Lovelace', email: 'ada@example.com', url: 'https://example.com' })).toBe('Ada Lovelace <ada@example.com>');
        expect(maintainer({ name: 'Ada Lovelace' })).toBe('Ada Lovelace');
        expect(maintainer(undefined)).toBeNull();
    });

    test('reads an author of many unclosed parentheses at once, as a backtracking regular expression would not', () => {
        const author = `Ada ${'('.repeat(100_000)}`;
        const started = performance.now();
        expect(maintainer(author)).toBe(author);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    test("has a control file that depends on WebKitGTK and describes the app by package.json's description", () => {
        const control = {
            name: 'demo', version: '1.0.0-beta.1', arch: 'x64', label: 'Demo', description: 'A demo\nof crossbind',
        };
        expect(debianControl({ ...control, author: 'Ada <ada@example.com>' })).toBe([
            'Package: demo', 'Version: 1.0.0~beta.1', 'Architecture: amd64', 'Maintainer: Ada <ada@example.com>',
            'Depends: libwebkit2gtk-4.1-0 (>= 2.40), libgtk-3-0', 'Description: A demo of crossbind', '',
        ].join('\n'));
        // Without an author or a description, the app's name stands for both.
        expect(debianControl({ ...control, arch: 'arm64', description: undefined })).toBe([
            'Package: demo', 'Version: 1.0.0~beta.1', 'Architecture: arm64', 'Maintainer: Demo', 'Depends: libwebkit2gtk-4.1-0 (>= 2.40), libgtk-3-0',
            'Description: Demo', '',
        ].join('\n'));
        // The packages its extensions' libraries come in, beside WebKitGTK and GTK.
        expect(debianControl({ ...control, depends: ['libzstd1', 'libsecret-1-0 (>= 0.20.5)'] }))
            .toContain('Depends: libwebkit2gtk-4.1-0 (>= 2.40), libgtk-3-0, libzstd1, libsecret-1-0 (>= 0.20.5)\n');
    });

    test('has a desktop entry that starts its command, with its icon when it has one', () => {
        expect(desktopEntry({ label: 'My Demo', command: 'demo', hasIcon: true })).toBe(
            '[Desktop Entry]\nType=Application\nName=My Demo\nExec=demo\nIcon=demo\nTerminal=false\n',
        );
        expect(desktopEntry({ label: 'My Demo', command: 'demo', hasIcon: false })).not.toContain('Icon=');
        // A link of one of its schemes opens it, with the link as its argument.
        expect(desktopEntry({ label: 'My Demo', command: 'demo', hasIcon: false, urlSchemes: ['myapp', 'other'] })).toBe(
            '[Desktop Entry]\nType=Application\nName=My Demo\nExec=demo %u\nMimeType=x-scheme-handler/myapp;x-scheme-handler/other;\nTerminal=false\n',
        );
        // Files of its MIME types open it with their paths or file: URLs, as a link of its schemes does.
        expect(desktopEntry({ label: 'My Demo', command: 'demo', hasIcon: false, urlSchemes: ['myapp'], mimeTypes: ['application/geo+json', 'application/geo+json'] })).toBe(
            '[Desktop Entry]\nType=Application\nName=My Demo\nExec=demo %U\nMimeType=x-scheme-handler/myapp;application/geo+json;\nTerminal=false\n',
        );
        // A menu shows it under the categories app.category gives.
        expect(desktopEntry({ label: 'My Demo', command: 'demo', hasIcon: false, categories: 'Audio;AudioVideo' })).toBe(
            '[Desktop Entry]\nType=Application\nName=My Demo\nExec=demo\nCategories=Audio;AudioVideo;\nTerminal=false\n',
        );
    });

    // Windows writes a link's target with backslashes, and a drive for /Applications.
    test.skipIf(process.platform === 'win32')('holds the app in /usr/lib, its command in /usr/bin, and the desktop entry, which opens its links, and icon of a menu', async () => {
        const root = project({ 'demo-linux-x64/demo': 'elf', 'demo-linux-x64/resources/icon.png': 'png' }, {
            name: 'Demo_App', appOptions: { name: 'My Demo', urlSchemes: ['myapp'], category: 'music', installers: ['deb'] },
        });
        fs.renameSync(path.join(root, 'dist/demo-linux-x64/demo'), path.join(root, 'dist/demo-linux-x64/Demo_App'));
        const target = { platform: 'linux', arch: 'x64' };
        let tree;
        run.mockImplementationOnce((program, params, prefix, runFor, options) => {
            const stage = params[3];
            const read = (file) => fs.readFileSync(path.join(stage, file), 'utf8');
            tree = {
                command: fs.readlinkSync(path.join(stage, 'usr/bin/demo-app')),
                app: fs.readdirSync(path.join(stage, 'usr/lib/demo-app')).sort(),
                icon: read('usr/share/icons/hicolor/512x512/apps/demo-app.png'),
                entry: read('usr/share/applications/demo-app.desktop'),
                control: read('DEBIAN/control'),
            };
            writeMade(params, options.workdir);
        });

        const made = await writeInstallers(path.join(root, 'dist/demo-linux-x64'), target);

        expect(made).toEqual([{ name: 'deb', files: [path.join(root, 'dist/demo-linux-x64.deb')] }]);
        expect(run).toHaveBeenCalledWith(null, ['dpkg-deb', '--build', '--root-owner-group', path.join(root, 'build', 'deb', 'demo-linux-x64'),
            path.join(root, 'dist/demo-linux-x64.deb')], null, target, { workdir: path.join(root, 'dist') });
        expect(tree).toEqual({
            command: '../lib/demo-app/Demo_App',
            app: ['Demo_App', 'resources'],
            icon: 'png',
            entry: desktopEntry({
                label: 'My Demo', command: 'demo-app', hasIcon: true, urlSchemes: ['myapp'], categories: 'Audio;AudioVideo',
            }),
            control: debianControl({ name: 'demo-app', version: '1.2.0-beta.3', arch: 'x64', label: 'My Demo' }),
        });
        // What it packaged is gone once the package is made.
        expect(fs.existsSync(path.join(root, 'build/deb/demo-linux-x64'))).toBe(false);
    });

    test.skipIf(process.platform === 'win32')("is refused for an app outside the project's base, which is all the linux image sees", async () => {
        const root = project({}, { appOptions: { installers: ['deb'] } });
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-elsewhere-'));
        roots.push(elsewhere);
        fs.mkdirSync(path.join(elsewhere, 'demo-linux-x64'));
        await expect(writeInstallers(path.join(elsewhere, 'demo-linux-x64'), { platform: 'linux', arch: 'x64' }))
            .rejects.toThrow(`crossbind: deb runs dpkg-deb in ${elsewhere}, outside ${root}, the project's base and all the linux container sees.`);
        expect(run).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(root, 'build', 'deb', 'demo-linux-x64'))).toBe(false);
    });
});

describe("the file types an installer registers", () => {
    const types = [
        { name: 'Geo "JSON" & <maps> $HOME', extensions: ['geojson', 'geo'], mimeTypes: ['application/geo+json'], role: 'editor', contentTypes: [] },
        { name: 'Track', extensions: ['trk'], mimeTypes: [], role: 'viewer', contentTypes: [] },
    ];

    test("tell a Linux system of each type's extensions, under one of the app's MIME types where the type gives none", () => {
        const linux = linuxFileTypes('demo-app', types);
        expect(linux.map(({ mimeTypes }) => mimeTypes)).toEqual([['application/geo+json'], ['application/x-demo-app-trk']]);
        expect(mimePackage(linux)).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">',
            '  <mime-type type="application/geo+json">',
            '    <comment>Geo "JSON" &amp; &lt;maps&gt; $HOME</comment>',
            '    <glob pattern="*.geojson"/>',
            '    <glob pattern="*.geo"/>',
            '  </mime-type>',
            '  <mime-type type="application/x-demo-app-trk">',
            '    <comment>Track</comment>',
            '    <glob pattern="*.trk"/>',
            '  </mime-type>',
            '</mime-info>', '',
        ].join('\n'));
    });

    test("give a Windows setup program each extension with its type's name, quoted as its script takes it", () => {
        expect(fileTypesMacro(types)).toBe([
            '!macro CROSSBIND_FILE_TYPES DO',
            '  !insertmacro ${DO} "geojson" "Geo $\\"JSON$\\" & <maps> $$HOME"',
            '  !insertmacro ${DO} "geo" "Geo $\\"JSON$\\" & <maps> $$HOME"',
            '  !insertmacro ${DO} "trk" "Track"',
            '!macroend', '',
        ].join('\n'));
    });
});

describe("a Linux app's archive", () => {
    test('is the app as one tar.gz beside its folder, which macOS writes without AppleDouble files', async () => {
        const root = project({ 'demo-linux-x64/demo': 'elf' }, { appOptions: { installers: ['tar-gz'] } });
        const app = path.join(root, 'dist/demo-linux-x64');

        expect(await writeInstallers(app, { platform: 'linux', arch: 'x64' })).toEqual([{ name: 'tar-gz', files: [`${app}.tar.gz`] }]);
        const [[args, options]] = tar.mock.calls;
        expect(args).toEqual(['-czf', `${app}.tar.gz`, '-C', path.join(root, 'dist'), 'demo-linux-x64']);
        expect(options.env.COPYFILE_DISABLE).toBe('1');
    });
});

describe("a macOS app's disk image", () => {
    test.skipIf(process.platform === 'win32')('holds the app beside a link to /Applications, and is named after it', async () => {
        const root = project({ 'demo.app/Contents/Info.plist': 'plist' }, { appOptions: { name: 'My Demo' } });
        const target = { platform: 'darwin', arch: 'arm64' };
        let folder;
        run.mockImplementationOnce((program, params, prefix, runFor, options) => {
            const source = params[params.indexOf('-srcfolder') + 1];
            folder = {
                entries: fs.readdirSync(source).sort(),
                link: fs.readlinkSync(path.join(source, 'Applications')),
                plist: fs.readFileSync(path.join(source, 'demo.app/Contents/Info.plist'), 'utf8'),
            };
            writeMade(params, options.workdir);
        });

        const made = await writeInstallers(path.join(root, 'dist/demo.app'), target);

        expect(made).toEqual([{ name: 'dmg', files: [path.join(root, 'dist/demo.dmg')] }]);
        expect(run).toHaveBeenCalledWith(null, ['hdiutil', 'create', '-quiet', '-volname', 'My Demo', '-srcfolder', expect.any(String), '-fs', 'HFS+',
            '-format', 'UDZO', path.join(root, 'dist/demo.dmg')], null, target, { workdir: path.join(root, 'dist') });
        expect(folder).toEqual({ entries: ['Applications', 'demo.app'], link: '/Applications', plist: 'plist' });
    });
});

describe("a Windows app's setup program", () => {
    const setup = () => inWindowsImage.mock.calls.find(([command]) => command[0] === 'makensis');

    test("is built by makensis from the nsis installer's script, which it gives the app, its names and its icon", async () => {
        const icon = PNG.sync.write({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) });
        const root = project({ 'demo-win32-x64/demo.exe': 'MZ', 'icon.png': icon }, { appOptions: { name: 'My $Demo', icon: 'dist/icon.png' } });
        const target = { platform: 'win32', arch: 'x64' };
        const app = path.join(root, 'dist/demo-win32-x64');

        const made = await writeInstallers(app, target);

        expect(made).toEqual([{ name: 'nsis', files: [`${app}-setup.exe`] }, { name: 'zip', files: [`${app}.zip`] }]);
        const [command, workdir, signing] = setup();
        expect(command.slice(0, 4)).toEqual(['makensis', '-V2', '-INPUTCHARSET', 'UTF8']);
        // NSIS reads $ as the start of a variable, so the app's name doubles it.
        expect(command).toEqual(expect.arrayContaining([
            '-DNAME=My $$Demo', '-DEXE=demo.exe', '-DID=dev.crossbind.demo', '-DVERSION=1.2.0-beta.3', `-DAPP=${app}`, `-DOUTFILE=${app}-setup.exe`,
            `-DICON=${path.join(root, 'build', 'nsis', 'demo-win32-x64.ico')}`,
        ]));
        expect(command.at(-1)).toMatch(/[/\\]extensions[/\\]nsis[/\\]installer\.nsi$/);
        expect(fs.existsSync(command.at(-1))).toBe(true);
        expect([workdir, signing]).toEqual([path.join(root, 'dist'), null]);
        expect(command.some((param) => param.startsWith('-DSIGNER='))).toBe(false);
        expect(fs.readFileSync(path.join(root, 'build/nsis/demo-win32-x64.ico')).readUInt16LE(2)).toBe(1);
        // The zip is the app as signed, made in the windows image too.
        expect(inWindowsImage).toHaveBeenCalledWith(['zip', '-q', '-r', '-X', 'demo-win32-x64.zip', 'demo-win32-x64'], path.join(root, 'dist'), null);
    });

    test("names package.json's author as the publisher the apps Settings lists show, by name alone", async () => {
        expect(publisherOf('Ada Lovelace <ada@example.com> (https://example.com)')).toBe('Ada Lovelace');
        expect(publisherOf('Ada Lovelace (https://example.com)')).toBe('Ada Lovelace');
        expect(publisherOf({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe('Ada Lovelace');
        expect(publisherOf('<ada@example.com>')).toBeNull();
        expect(publisherOf(undefined)).toBeNull();
        const root = project({ 'demo-win32-x64/demo.exe': 'MZ' }, { pkg: { version: '1.0.0', author: 'Ada "A" $Lovelace <ada@example.com>' } });
        await writeInstallers(path.join(root, 'dist/demo-win32-x64'), { platform: 'win32', arch: 'x64' });
        // The script writes it in a string, which takes a quote as $\" and a dollar sign as $$.
        expect(setup()[0]).toContain('-DPUBLISHER=Ada $\\"A$\\" $$Lovelace');
    });

    test("has no icon of its own without app.icon, registers no scheme without app.urlSchemes and names no publisher without package.json's author", async () => {
        const root = project({ 'demo-win32-x64/demo.exe': 'MZ' });
        await writeInstallers(path.join(root, 'dist/demo-win32-x64'), { platform: 'win32', arch: 'x64' });
        expect(setup()[0].some((param) => param.startsWith('-DICON='))).toBe(false);
        expect(setup()[0].some((param) => param.startsWith('-DSCHEMES='))).toBe(false);
        expect(setup()[0].some((param) => param.startsWith('-DPUBLISHER='))).toBe(false);
    });

    test('registers the schemes of app.urlSchemes, which a file of macros names for its script', async () => {
        const root = project({ 'demo-win32-x64/demo.exe': 'MZ' }, { appOptions: { urlSchemes: ['myapp', 'other'] } });
        await writeInstallers(path.join(root, 'dist/demo-win32-x64'), { platform: 'win32', arch: 'x64' });
        const schemes = setup()[0].find((param) => param.startsWith('-DSCHEMES=')).slice('-DSCHEMES='.length);
        expect(fs.readFileSync(schemes, 'utf8')).toBe('!macro CROSSBIND_URL_SCHEMES DO\n  !insertmacro ${DO} "myapp"\n  !insertmacro ${DO} "other"\n!macroend\n');
    });

    test('is signed with its uninstaller as NSIS writes them, by the script that signs the app, with a key in the environment', async () => {
        const root = project({ 'demo-win32-x64/demo.exe': 'MZ', 'key.p12': 'key' });
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'PKCS12');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_KEYSTORE', path.join(root, 'dist/key.p12'));
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STOREPASS', 'secret');

        await writeInstallers(path.join(root, 'dist/demo-win32-x64'), { platform: 'win32', arch: 'x64' });

        const [command, , signing] = setup();
        const signer = command.find((param) => param.startsWith('-DSIGNER=')).slice('-DSIGNER='.length);
        expect(signer).toMatch(/[/\\]windows[/\\]jsign\.sh$/);
        expect(fs.existsSync(signer)).toBe(true);
        expect(signing).toEqual({
            names: ['CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'CROSSBIND_WINDOWS_SIGNING_KEYSTORE', 'CROSSBIND_WINDOWS_SIGNING_STOREPASS'],
            files: { keystore: path.join(root, 'dist/key.p12') },
        });
        expect(command.join(' ')).not.toContain('secret');
        // The zip, which signs nothing, takes no key.
        expect(inWindowsImage.mock.calls.find(([zipped]) => zipped[0] === 'zip')[2]).toBeNull();
    });

    test('is refused for a name Windows takes for no shortcut or folder', async () => {
        const root = project({}, { appOptions: { name: 'Notes: Pro' } });
        await expect(writeInstallers(path.join(root, 'dist/demo-win32-x64'), { platform: 'win32', arch: 'x64' }))
            .rejects.toThrow('"Notes: Pro", the name of a Windows app\'s Start menu shortcut and folder, is no file name Windows takes');
        expect(inWindowsImage).not.toHaveBeenCalled();
    });
});

describe('the installers an app has', () => {
    const names = (target) => installersFor(target).map(({ name }) => name);

    test("are crossbind's and the app's of its platform, crossbind's first, or those alone app.installers names", () => {
        project({}, { extensions: [installer('appimage', 'linux'), installer('notes', 'desktop')] });
        expect(names({ platform: 'linux' })).toEqual(['deb', 'tar-gz', 'appimage', 'notes', 'updater']);
        expect(names({ platform: 'darwin' })).toEqual(['dmg', 'notes', 'updater']);
        expect(names({ platform: 'win32' })).toEqual(['nsis', 'zip', 'notes', 'updater']);
        state.config.app = { installers: ['notes', 'deb'] };
        expect(names({ platform: 'linux' })).toEqual(['deb', 'notes', 'updater']);
        expect(names({ platform: 'win32' })).toEqual(['notes', 'updater']);
        state.config.app = { installers: [] };
        expect(names({ platform: 'darwin' })).toEqual(['updater']);
    });

    test('run those that run last after every other, of the app\'s too, whatever app.installers names', () => {
        project({}, { appOptions: { installers: ['deb'] }, extensions: [installer('checksums', 'linux', { isLast: true }), installer('notes', 'linux')] });
        expect(names({ platform: 'linux' })).toEqual(['deb', 'updater', 'checksums']);
    });

    test('tell a check those that run and a make what those before it made, which it cannot change', async () => {
        const checked = [];
        const makes = [];
        const first = installer('first', 'linux', { make: () => ['first.bin'] });
        const nothing = installer('nothing', 'linux');
        const last = installer('last', 'linux', {
            isLast: true,
            check: (api, facts) => checked.push(facts.installers),
            make: (api, { made }) => {
                makes.push(structuredClone(made));
                made.pop();
                return ['last.bin'];
            },
        });
        const root = project({ 'demo-linux-x64/demo': 'elf', 'first.bin': '', 'last.bin': '' }, { appOptions: { installers: ['first', 'nothing'] }, extensions: [last, first, nothing] });
        const app = path.join(root, 'dist/demo-linux-x64');

        await checkInstaller({ platform: 'linux', arch: 'x64' });
        const made = await writeInstallers(app, { platform: 'linux', arch: 'x64' });

        expect(checked).toEqual([['first', 'nothing', 'updater', 'last']]);
        expect(makes).toEqual([[{ name: 'first', files: [path.join(root, 'dist/first.bin')] }]]);
        expect(made.map(({ name }) => name)).toEqual(['first', 'last']);
    });

    test('refuse an app.installers that names one that is no installer, or is no list of names', () => {
        project({}, { appOptions: { installers: ['deb', 'rpm'] }, extensions: [installer('appimage', 'linux')] });
        expect(() => installersFor({ platform: 'linux' })).toThrow('crossbind: app.installers names rpm, which is no installer: deb, dmg, nsis, tar-gz, zip and appimage are.');
        state.config.app = { installers: 'deb' };
        expect(() => installersFor({ platform: 'linux' })).toThrow('crossbind: app.installers "deb" is no list of installers\' names, each once.');
        state.config.app = { installers: ['deb', 'deb'] };
        expect(() => installersFor({ platform: 'linux' })).toThrow('is no list of installers\' names, each once');
    });

    test('leave out crossbind\'s whose role an extension the app lists takes, which needs no installer of its own', () => {
        project({}, { extensions: [{ ...installer('acme-updater', 'linux'), replaces: ['updater'] }] });
        expect(names({ platform: 'linux' })).toEqual(['deb', 'tar-gz', 'acme-updater']);
        state.config.extensions = [{ ...checkedExtension({ name: 'acme-updater', app: {} }, '/extensions', 'extensions[0]'), replaces: ['updater'] }];
        expect(names({ platform: 'linux' })).toEqual(['deb', 'tar-gz']);
    });

    test("put one the app lists under the name of crossbind's in its place", () => {
        const deb = installer('deb', 'linux');
        project({}, { extensions: [deb] });
        const installers = installersFor({ platform: 'linux' });
        expect(installers.map(({ name }) => name)).toEqual(['deb', 'tar-gz', 'updater']);
        expect(installers[0]).toBe(deb);
    });

    test('make what installs the app with the api of its platform, which give the files they made, a relative one beside the app', async () => {
        const seen = [];
        const appimage = installer('appimage', 'linux', {
            make(api, { app, arch }) {
                seen.push({
                    name: api.name, platform: api.platform, arch, app, workDir: api.workDir, isFrozen: Object.isFrozen(api),
                });
                fs.writeFileSync(`${app}.AppImage`, 'elf');
                return [`${path.basename(app)}.AppImage`];
            },
        });
        const root = project({ 'demo-linux-x64/demo': 'elf' }, { appOptions: { installers: ['appimage'] }, extensions: [appimage] });
        const app = path.join(root, 'dist/demo-linux-x64');

        expect(await writeInstallers(app, { platform: 'linux', arch: 'x64' })).toEqual([{ name: 'appimage', files: [`${app}.AppImage`] }]);
        expect(seen).toEqual([{
            name: 'appimage', platform: 'linux', arch: 'x64', app, workDir: path.join(root, 'build', 'appimage'), isFrozen: true,
        }]);
    });

    test('refuse what an installer says it made but did not, and what is no list of files', async () => {
        const root = project({ 'demo-linux-x64/demo': 'elf' }, {
            appOptions: { installers: ['appimage'] },
            extensions: [installer('appimage', 'linux', { make: () => ['missing.AppImage'] }), installer('snap', 'linux', { make: () => 'demo.snap' })],
        });
        const app = path.join(root, 'dist/demo-linux-x64');
        await expect(writeInstallers(app, { platform: 'linux', arch: 'x64' }))
            .rejects.toThrow(`crossbind: the installer appimage made ${path.join(root, 'dist', 'missing.AppImage')}, which is no file.`);
        state.config.app = { installers: ['snap'] };
        await expect(writeInstallers(app, { platform: 'linux', arch: 'x64' })).rejects.toThrow('crossbind: the installer snap made no list of files, which its make returns.');
    });
});

describe('what a desktop app ships with', () => {
    test('stops a build whose installers could not make it, before anything compiles', async () => {
        project({}, { name: 'x', appOptions: { name: 'Notes: Pro' } });
        await expect(checkInstaller({ platform: 'linux', arch: 'x64' })).rejects.toThrow('general.name "x" makes no Debian package name');
        await expect(checkInstaller({ platform: 'win32', arch: 'x64' })).rejects.toThrow('"Notes: Pro", the name of a Windows app\'s Start menu shortcut');
        await expect(checkInstaller({ platform: 'darwin', arch: 'arm64' })).resolves.toBeUndefined();
    });

    test("runs each installer's own check, with the api of its platform", async () => {
        const checked = [];
        const appimage = installer('appimage', 'linux', {
            check(api) {
                checked.push(api.platform);
                throw new Error('crossbind: appimage takes appimagetool, which this machine has not.');
            },
        });
        project({}, { extensions: [appimage] });
        await expect(checkInstaller({ platform: 'linux', arch: 'x64' })).rejects.toThrow('crossbind: appimage takes appimagetool, which this machine has not.');
        expect(checked).toEqual(['linux']);
        await expect(checkInstaller({ platform: 'darwin', arch: 'arm64' })).resolves.toBeUndefined();
    });

    test('keeps the installer a Linux or Windows app with app.updater updates itself from', async () => {
        const updater = { url: 'https://example.com/updates/demo-{platform}-{arch}.update.json', publicKey: newUpdaterKey().publicKey };
        project({}, { appOptions: { updater, installers: ['deb'] } });
        await expect(checkInstaller({ platform: 'linux', arch: 'x64' })).rejects.toThrow('crossbind: a Linux app with app.updater updates itself from what its tar-gz installer makes, which app.installers leaves out: list tar-gz in it, or remove app.updater.');
        state.config.app = { updater, installers: ['zip'] };
        await expect(checkInstaller({ platform: 'win32', arch: 'x64' })).rejects.toThrow('crossbind: a Windows app with app.updater updates itself from what its nsis installer makes, which app.installers leaves out: list nsis in it, or remove app.updater.');
        // A macOS app's update is a zip of its own.
        state.config.app = { updater, installers: [] };
        await expect(checkInstaller({ platform: 'darwin', arch: 'arm64' })).resolves.toBeUndefined();
        state.config.app = { updater, installers: ['deb', 'tar-gz'] };
        await expect(checkInstaller({ platform: 'linux', arch: 'x64' })).resolves.toBeUndefined();
        // A publisher's build that narrows the installers its store takes keeps the one the update is too.
        vi.stubEnv('CROSSBIND_CONFIG_CHANGES', JSON.stringify({ app: { installers: ['deb'] } }));
        state.config.app = { updater, installers: ['deb'] };
        await expect(checkInstaller({ platform: 'linux', arch: 'x64' })).rejects.toThrow("crossbind: a Linux app with app.updater updates itself from what its tar-gz installer makes, which the publisher's build leaves out of app.installers: its build lists tar-gz too, or removes app.updater with { app: { updater: null } }.");
    });

    test('stops a Windows build whose key could not sign it, before anything compiles', async () => {
        project({});
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'YUBIKEY');
        await expect(checkInstaller({ platform: 'win32', arch: 'x64' })).rejects.toThrow("is a hardware token, which crossbind's windows container does not reach");
    });

    test("stops a desktop build whose update key could not sign the app's updates, before anything compiles", async () => {
        project({});
        vi.stubEnv('CROSSBIND_UPDATER_PRIVATE_KEY', Buffer.alloc(32).toString('base64'));
        for (const platform of ['darwin', 'linux', 'win32']) {
            await expect(checkInstaller({ platform, arch: 'x64' })).rejects.toThrow('crossbind.config.js has no app.updater');
        }
        await expect(checkInstaller({ platform: 'android', arch: 'arm64-v8a' })).resolves.toBeUndefined();
    });

    test('stops a macOS build whose notarization could not be, before anything compiles', async () => {
        project({});
        vi.stubEnv('CROSSBIND_APPLE_SIGNING_IDENTITY', 'Developer ID Application: Ada Lovelace');
        vi.stubEnv('CROSSBIND_APPLE_API_KEY', '');
        vi.stubEnv('CROSSBIND_APPLE_API_KEY_ID', 'ABC123');
        vi.stubEnv('CROSSBIND_APPLE_API_ISSUER', '');
        await expect(checkInstaller({ platform: 'darwin', arch: 'arm64' }))
            .rejects.toThrow('CROSSBIND_APPLE_API_KEY_ID is set, but CROSSBIND_APPLE_API_KEY and CROSSBIND_APPLE_API_ISSUER are not');
    });
});
