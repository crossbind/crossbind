import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CLOUD = 'http://127.0.0.1:9';

let dir;
let home;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cli-'));
    home = path.join(dir, 'home');
    fs.mkdirSync(home);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const environment = (env) => ({
    ...process.env, HOME: home, USERPROFILE: home, CROSSBIND_CLOUD_URL: CLOUD, ...env,
});
const crossbindWith = (env, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: environment(env) });
const crossbind = (...args) => crossbindWith({}, ...args);

describe('crossbind outside a project', () => {
    test('prints its version', () => {
        expect(crossbind('--version')).toMatchObject({ status: 0, stdout: `${version}\n` });
        expect(crossbind('-V')).toMatchObject({ status: 0, stdout: `${version}\n` });
    });

    test('asks for a sign-in rather than a package.json on usage and logout', () => {
        const usage = crossbind('usage');
        const logout = crossbind('logout');

        expect(usage.status).toBe(1);
        expect(usage.stderr).toContain(`not signed in to ${CLOUD}; run crossbind login.`);
        expect(logout).toMatchObject({ status: 0, stdout: `crossbind: not signed in to ${CLOUD}.\n` });
    });

    test('sets, reads and deletes a key of ~/.crossbind/config.json, on a machine with no ~/.crossbind yet', () => {
        const file = upath.join(home, '.crossbind', 'config.json');

        expect(crossbind('config', 'set', 'RUNNER', 'LOCAL').status).toBe(0);
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).RUNNER).toBe('LOCAL');
        expect(crossbind('config', 'get', 'RUNNER').stdout).toContain("'LOCAL'");
        expect(crossbind('config', 'delete', 'RUNNER').status).toBe(0);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).not.toHaveProperty('RUNNER');
    });

    test("keeps the full path of an App Store Connect API key's file, and neither a key's own text nor a file that is not there", () => {
        const file = upath.join(home, '.crossbind', 'config.json');
        const key = upath.join(home, 'AuthKey_7K2M9P4Q1Z.p8');
        fs.writeFileSync(key, 'key');
        const kept = () => JSON.parse(fs.readFileSync(file, 'utf8')).APPLE_API_KEY;

        expect(crossbind('config', 'set', 'APPLE_API_KEY', 'home/AuthKey_7K2M9P4Q1Z.p8').status).toBe(0);
        expect(upath.isAbsolute(kept())).toBe(true);
        expect(fs.realpathSync(kept())).toBe(fs.realpathSync(key));
        const text = crossbind('config', 'set', 'APPLE_API_KEY', '-----BEGIN PRIVATE KEY-----MIGTAgEAMBMGByqGSM49-----END PRIVATE KEY-----');
        expect(text).toMatchObject({
            status: 1,
            stderr: expect.stringContaining("crossbind: APPLE_API_KEY takes the path of a file, not a key's own text, which crossbind keeps in no file: set the path, or give the text as CROSSBIND_APPLE_API_KEY."),
        });
        expect(text.stderr).not.toContain('MIGTAgEAMBMGByqGSM49');
        expect(crossbind('config', 'set', 'APPLE_API_KEY', 'home/missing.p8')).toMatchObject({ status: 1, stderr: expect.stringContaining('missing.p8, which is no file.') });
        expect(fs.realpathSync(kept())).toBe(fs.realpathSync(key));
    });

    test("lists, reads and deletes an extension's own settings by its name and theirs", () => {
        const file = upath.join(home, '.crossbind', 'config.json');
        fs.mkdirSync(upath.dirname(file));
        fs.writeFileSync(file, JSON.stringify({ RUNNER: 'LOCAL', extensions: { 'demo-store': { ACCOUNT: 'ada', REGION: 'eu' } } }));

        expect(crossbind('config', 'list')).toMatchObject({ status: 0, stdout: expect.stringContaining('demo-store.REGION') });
        expect(crossbind('config', 'get', 'demo-store.account')).toMatchObject({ status: 0, stdout: expect.stringContaining("'ada'") });
        expect(crossbind('config', 'delete', 'demo-store.ACCOUNT').status).toBe(0);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ RUNNER: 'LOCAL', extensions: { 'demo-store': { REGION: 'eu' } } });
        expect(crossbind('config', 'delete', 'demo-store.ACCOUNT')).toMatchObject({ status: 1, stderr: expect.stringContaining('Configuration demo-store.ACCOUNT is not set.') });
        expect(crossbind('config', 'delete', 'demo-store.REGION').status).toBe(0);
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).extensions).toEqual({});
        expect(crossbind('config', 'delete', 'DEMO_STORE_ACCOUNT')).toMatchObject({ status: 1, stderr: expect.stringContaining('Configuration DEMO_STORE_ACCOUNT is not available') });
    });

    test('still needs one to list the project configuration or to build', () => {
        [['config', 'list', '-t', 'project'], ['build']].forEach((args) => {
            const { status, stderr } = crossbind(...args);

            expect(status).toBe(1);
            expect(stderr).toContain('no package.json found');
            expect(stderr).toContain('scaffold a project with `npm create crossbind@beta`');
        });
    });
});

describe('crossbind inside a project', () => {
    beforeEach(() => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sample-app' })));

    test('lists the system and the project configuration', () => {
        const { status, stdout } = crossbind('config', 'list', '-t', 'all');

        expect(status).toBe(0);
        expect(stdout).toContain('System Configuration');
        expect(stdout).toContain('Project Configuration');
        expect(stdout).toContain("'sample-app'");
    });

    test('builds no app of a project that is none', () => {
        const { status, stderr } = crossbind('app', 'build', '-p', 'linux');

        expect(status).toBe(1);
        expect(stderr).toContain('add @crossbind/core-app-host to its devDependencies');
    });

    test('lists the commands that need no project in its help', () => {
        const { status, stdout } = crossbind('--help');

        expect(status).toBe(0);
        ['login', 'logout', 'usage', 'account', 'config'].forEach((name) => expect(stdout).toMatch(new RegExp(`^  ${name} `, 'm')));
    });
});

// An app whose Vite prints what crossbind started it with, then exits with 3, or waits for SIGTERM and marks it. It
// listens before it prints, as the test signals once it has printed.
describe('crossbind app', () => {
    const VITE = `const fs = require('node:fs');
process.on('SIGTERM', () => { fs.writeFileSync(process.env.FAKE_VITE_MARK, 'SIGTERM'); process.exit(143); });
console.log(JSON.stringify({ args: process.argv.slice(2), platform: process.env.CROSSBIND_APP_PLATFORM, device: process.env.CROSSBIND_APP_DEVICE || undefined }));
if (!process.env.FAKE_VITE_MARK) process.exit(3);
setInterval(() => {}, 1000);
`;
    const UNSET = {
        CROSSBIND_APP_PLATFORM: '', CROSSBIND_APP_DEVICE: '', CROSSBIND_ANDROID_KEYSTORE: '', CROSSBIND_ANDROID_KEY_ALIAS: '', CROSSBIND_ANDROID_KEYSTORE_PASSWORD: '', FAKE_VITE_MARK: '',
    };
    const started = (stdout) => JSON.parse(stdout.trim().split('\n').at(-1));

    beforeEach(() => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sample-app' }));
        fs.writeFileSync(path.join(dir, 'crossbind.config.mjs'), "export default { target: { runtimeEnv: 'app' } };\n");
        const vite = path.join(dir, 'node_modules', 'vite');
        fs.mkdirSync(vite, { recursive: true });
        fs.writeFileSync(path.join(vite, 'package.json'), JSON.stringify({ name: 'vite', bin: { vite: 'vite.js' } }));
        fs.writeFileSync(path.join(vite, 'vite.js'), VITE);
    });

    test("runs the project's Vite for the platform named, with Vite's own options, and ends as it does", () => {
        const { status, stdout } = crossbindWith(UNSET, 'app', 'build', '-p', 'linux', '--mode', 'staging');

        expect(started(stdout)).toEqual({ args: ['build', '--mode', 'staging'], platform: 'linux' });
        expect(status).toBe(3);
    });

    // A workspace can map vite to a package of Vite's API alone, as vite-plus maps it to vite-plus-core.
    test("names what the project's vite resolves to when that has no vite command", () => {
        fs.writeFileSync(path.join(dir, 'node_modules', 'vite', 'package.json'), JSON.stringify({ name: '@voidzero-dev/vite-plus-core', version: '0.1.24' }));

        const { status, stderr } = crossbindWith(UNSET, 'app', 'build', '-p', 'linux');

        expect(status).toBe(1);
        expect(stderr).toContain("its vite resolves to @voidzero-dev/vite-plus-core 0.1.24, which has neither a vite command nor Vite's cli.js beside its entry");
    });

    // vite-plus-core keeps Vite's CLI beside its entry, where vite-plus's own vp runs it, and Vite keeps it there too.
    test('runs the Vite CLI beside the entry of a vite that has no vite command', () => {
        const vite = path.join(dir, 'node_modules', 'vite');
        const node = path.join(vite, 'dist', 'vite', 'node');
        fs.mkdirSync(node, { recursive: true });
        fs.writeFileSync(path.join(vite, 'package.json'), JSON.stringify({ name: '@voidzero-dev/vite-plus-core', version: '0.1.24', main: './dist/vite/node/index.js' }));
        fs.writeFileSync(path.join(node, 'index.js'), '');
        fs.writeFileSync(path.join(node, 'cli.js'), VITE);

        const { status, stdout } = crossbindWith(UNSET, 'app', 'build', '-p', 'linux', '--mode', 'staging');

        expect(started(stdout)).toEqual({ args: ['build', '--mode', 'staging'], platform: 'linux' });
        expect(status).toBe(3);
    });

    test('takes the platform from CROSSBIND_APP_PLATFORM without -p', () => {
        const { stdout } = crossbindWith({ ...UNSET, CROSSBIND_APP_PLATFORM: 'ios' }, 'app', 'dev', '--port', '3000');

        expect(started(stdout)).toEqual({ args: ['--port', '3000'], platform: 'ios' });
    });

    test('opens an iOS app on the iPhone --device names, which Vite takes as CROSSBIND_APP_DEVICE', () => {
        const { stdout } = crossbindWith(UNSET, 'app', 'dev', '-p', 'ios', '--device', "Ada's iPhone", '--port', '3000');

        expect(started(stdout)).toEqual({ args: ['--port', '3000'], platform: 'ios', device: "Ada's iPhone" });
    });

    test('opens no app of another platform on an iPhone', () => {
        const { status, stdout, stderr } = crossbindWith(UNSET, 'app', 'dev', '-p', 'android', '--device');

        expect(status).toBe(1);
        expect(stderr).toContain('--device opens an iOS app on an iPhone or iPad: add -p ios');
        expect(stdout).not.toContain('"args"');
    });

    test("checks an Android build's upload key before the build", () => {
        const { status, stdout, stderr } = crossbindWith({ ...UNSET, CROSSBIND_ANDROID_KEY_ALIAS: 'upload' }, 'app', 'build', '-p', 'android');

        expect(status).toBe(1);
        expect(stderr).toContain('CROSSBIND_ANDROID_KEY_ALIAS is set without CROSSBIND_ANDROID_KEYSTORE');
        expect(stdout).not.toContain('"args"');
    });

    test.skipIf(process.platform === 'win32')('passes a signal sent to crossbind alone on to Vite, and ends with it', async () => {
        const mark = path.join(dir, 'signal');
        const cli = spawn(process.execPath, [CLI, 'app', 'dev'], { cwd: dir, env: environment({ ...UNSET, FAKE_VITE_MARK: mark }) });
        await new Promise((resolve) => { cli.stdout.once('data', resolve); });

        cli.kill('SIGTERM');
        const status = await new Promise((resolve) => { cli.once('exit', resolve); });

        expect(fs.readFileSync(mark, 'utf8')).toBe('SIGTERM');
        expect(status).toBe(143);
    });
});

describe('a fatal error', () => {
    // A failed build prints its whole output right before crossbind exits, and a pipe holds about 64 KiB.
    test('exits only once a pipe nobody reads yet has taken everything written before it', async () => {
        const program = new URL('../src/program.js', import.meta.url).href;
        const script = `import { handleFatal } from ${JSON.stringify(program)};
process.stderr.write('x'.repeat(1 << 20));
handleFatal(new Error('boom'));`;
        const cli = spawn(process.execPath, ['--input-type=module', '-e', script], {
            cwd: dir, env: environment({ DEBUG: '' }), stdio: ['ignore', 'ignore', 'pipe'],
        });
        const closed = new Promise((resolve) => { cli.once('close', resolve); });
        cli.stderr.pause();
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        let stderr = '';
        cli.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; }).resume();
        const status = await closed;

        expect(status).toBe(1);
        expect({ length: stderr.length, end: stderr.slice(-6) }).toEqual({ length: (1 << 20) + 5, end: 'xboom\n' });
    });
});

describe("crossbind app's commands of extensions", () => {
    const appWith = (extensions) => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.2.3', type: 'module' }));
        fs.writeFileSync(path.join(dir, 'crossbind.config.mjs'), `export default { target: { runtimeEnv: 'app' }, extensions: [${extensions}] };\n`);
    };
    const root = () => JSON.stringify(fs.realpathSync(dir));
    const hello = (name) => `{ name: 'acme', contract: 1, root: ${root()}, commands: { '${name}': { help: 'says hello', options: { to: { help: 'whom', value: '<name>', default: 'you' }, loud: { help: 'louder' } }, run: (api) => api.log(\`hello \${api.options.to} \${api.options.loud === true} \${api.project.name}\`) } } }`;

    test("gives crossbind's own key updater, which prints a key pair", () => {
        appWith('');
        const { status, stdout } = crossbind('app', 'key', 'updater');
        expect(status).toBe(0);
        expect(stdout).toMatch(/app\.updater\.publicKey in crossbind\.config\.js: \S{44}\n/);
        expect(stdout).toMatch(/CROSSBIND_UPDATER_PRIVATE_KEY, kept secret where the app is built: \S{44}\n/);
    });

    test('says which keys the app has and where each is kept, and names those it makes', () => {
        appWith('');
        const { status, stdout } = crossbind('app', 'key');
        expect(status).toBe(0);
        expect(stdout).toContain('upload: none on this machine; crossbind app key upload makes one, or takes yours with --use');
        expect(stdout).toContain('updater: none, as app.updater.publicKey is not set; crossbind app key updater makes the pair');
        expect(crossbind('app', 'key', 'signing').stderr).toContain('crossbind: crossbind app key makes upload or updater, not signing.');
    });

    test("runs a listed extension's with its options, and lists it in the help", () => {
        appWith(hello('hello'));
        expect(crossbind('app', 'hello', '--to', 'ada', '--loud').stdout).toContain('hello ada true demo');
        expect(crossbind('app', 'hello').stdout).toContain('hello you false demo');
        expect(crossbind('app', '--help').stdout).toMatch(/hello \[options\]\s+says hello/);
    });

    test("stops at a name crossbind or another extension has, naming the extension and the owner, and takes the place of one whose role it replaces", () => {
        const key = (name) => hello(name).replace('commands:', 'keys:');
        appWith(hello('upload'));
        expect(crossbind('app', 'dev').stderr).toContain('crossbind: acme adds the command crossbind app upload, which crossbind has.');
        appWith(key('upload'));
        expect(crossbind('app', 'dev').stderr).toContain('crossbind: acme adds the key crossbind app key upload, which crossbind has.');
        appWith(key('updater'));
        expect(crossbind('app', 'dev').stderr).toContain('crossbind: acme adds the key crossbind app key updater, which updater has.');
        appWith(key('updater').replace("name: 'acme',", "name: 'acme', replaces: 'updater',"));
        expect(crossbind('app', 'key', 'updater').stdout).toContain('hello you false demo');
    });

    test('names the extension where a command fails', () => {
        appWith(`{ name: 'acme', contract: 1, root: ${root()}, commands: { boom: { help: 'fails', run() { throw new Error('no key'); } } } }`);
        const { status, stderr } = crossbind('app', 'boom');
        expect(status).toBe(1);
        expect(stderr).toContain("crossbind: acme's boom failed: no key");
    });

    test('reads the extensions of the host for crossbind app alone, so that one that cannot be read stops no other command', () => {
        appWith('');
        const host = path.join(dir, 'node_modules', '@crossbind', 'core-app-host');
        fs.mkdirSync(host, { recursive: true });
        fs.writeFileSync(path.join(host, 'package.json'), JSON.stringify({ name: '@crossbind/core-app-host', dependencies: { '@crossbind/extension-gone': '1.0.0' } }));
        expect(crossbind('app', 'key').stderr).toContain("crossbind: cannot read @crossbind/extension-gone's crossbind.extension.js");
        expect(crossbind('config', 'keys').status).toBe(0);
        const { status, stderr } = crossbind('licenses');
        expect(stderr).not.toContain('extension-gone');
        expect(status).toBe(0);
    });

    test('has none outside an app project', () => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
        expect(crossbind('app', 'key', 'updater').stderr).toContain('crossbind: crossbind app key makes upload, not updater.');
    });
});

describe('crossbind app upload', () => {
    // An app whose one store, an extension's, names what the command line gave it as all it lacks, so nothing builds. Its
    // root is the folder's real path, which the process's own is too.
    const appWithStore = (options) => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.2.3', type: 'module' }));
        fs.writeFileSync(path.join(dir, 'crossbind.config.mjs'), `export default {
    target: { runtimeEnv: 'app' },
    extensions: [{
        name: 'demo-store',
        contract: 1,
        root: ${JSON.stringify(fs.realpathSync(dir))},
        publisher: {
            platform: 'desktop',
            options: ${options},
            check: (api) => ({ missing: [\`GIVEN \${api.platform} \${JSON.stringify(api.options)}\`] }),
            upload: async () => {},
        },
    }],
};
`);
    };

    test("gives a store's options on the command line to its publisher, with the platform -p names", () => {
        appWithStore("{ channel: { help: 'the channel', value: '<channel>' }, draft: { help: 'a draft' } }");
        const { status, stderr } = crossbind('app', 'upload', 'demo-store', '--channel', 'stable', '--draft', '-p', 'linux', '--mode', 'staging');
        expect(status).toBe(1);
        expect(stderr).toContain('GIVEN linux {"channel":"stable","draft":true}');
    });

    test("refuses another store's option, a store named after the options, and an option named as crossbind's own", () => {
        appWithStore('{}');
        expect(crossbind('app', 'upload', 'demo-store', '--track', 'beta').stderr).toContain("crossbind: --track is google-play's, which demo-store takes none of.");
        expect(crossbind('app', 'upload', '-p', 'linux', '--draft', 'demo-store').stderr).toContain('crossbind: crossbind app upload takes the store first, before the options');
        appWithStore("{ version: { help: 'the version', value: '<version>' } }");
        const named = crossbind('app', 'upload', 'demo-store', '--version', '1');
        expect(named.status).toBe(1);
        expect(named.stderr).toContain('names version, which is no option of its own');
    });
});
