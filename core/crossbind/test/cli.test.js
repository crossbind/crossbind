import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

    test('sets, reads and deletes a key of ~/.crossbind.json', () => {
        const file = path.join(home, '.crossbind.json');

        expect(crossbind('config', 'set', 'RUNNER', 'LOCAL').status).toBe(0);
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).RUNNER).toBe('LOCAL');
        expect(crossbind('config', 'get', 'RUNNER').stdout).toContain("'LOCAL'");
        expect(crossbind('config', 'delete', 'RUNNER').status).toBe(0);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).not.toHaveProperty('RUNNER');
    });

    test('still needs one to list the project configuration or to build', () => {
        [['config', 'list', '-t', 'project'], ['build']].forEach((args) => {
            const { status, stderr } = crossbind(...args);

            expect(status).toBe(1);
            expect(stderr).toContain('no package.json found');
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
        expect(stderr).toContain("set target: { runtimeEnv: 'app' } in crossbind.config.js");
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
console.log(JSON.stringify({ args: process.argv.slice(2), platform: process.env.CROSSBIND_APP_PLATFORM }));
if (!process.env.FAKE_VITE_MARK) process.exit(3);
setInterval(() => {}, 1000);
`;
    const UNSET = {
        CROSSBIND_APP_PLATFORM: '', CROSSBIND_ANDROID_KEYSTORE: '', CROSSBIND_ANDROID_KEY_ALIAS: '', CROSSBIND_ANDROID_KEYSTORE_PASSWORD: '', FAKE_VITE_MARK: '',
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

    test('takes the platform from CROSSBIND_APP_PLATFORM without -p', () => {
        const { stdout } = crossbindWith({ ...UNSET, CROSSBIND_APP_PLATFORM: 'ios' }, 'app', 'dev', '--port', '3000');

        expect(started(stdout)).toEqual({ args: ['--port', '3000'], platform: 'ios' });
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
