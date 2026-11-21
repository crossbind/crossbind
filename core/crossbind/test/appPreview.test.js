import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import upath from 'upath';
import {
    appHeaderBlocker, projectIdOf, projectPageApi, qrLines, viteProblem,
} from '../src/actions/appPreview.js';
import { halfBlocks, qrMatrix } from '../src/utils/qrMatrix.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const TOKEN = `cbt_${'a'.repeat(43)}`;
const ACCOUNT = { id: '1099511627777', name: 'made-up-dev' };
const NOT_SIGNED_IN = 'crossbind: crossbind app preview opens on your devices through your crossbind account: run crossbind login first.';
const SNAPSHOT = 'IRVUB8Fpwuh0lT_7NkiJ8Q';
// A Vite that builds: it prints what crossbind app preview hands it, and writes a web build of two files into --outDir.
const BUILDING_VITE = `const fs = require('node:fs');
const args = process.argv.slice(2);
console.log(\`VITE \${args.join(' ')} \${process.env.CROSSBIND_APP_PREVIEW}\`);
const out = args[args.indexOf('--outDir') + 1];
fs.mkdirSync(out + '/assets', { recursive: true });
fs.writeFileSync(out + '/index.html', '<!doctype html><title>demo</title>');
fs.writeFileSync(out + '/assets/app.js', 'console.log(1);');
`;

let dir;
beforeEach(() => {
    dir = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-preview-'))));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// An app project of the config given, whose vite is a stand-in of this version: it prints what crossbind app preview
// hands it, and ends.
function projectWith(config, viteVersion = '8.3.8') {
    fs.writeFileSync(upath.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', type: 'module', devDependencies: { '@crossbind/core-app-host': '*' } }));
    fs.writeFileSync(upath.join(dir, 'crossbind.config.mjs'), config);
    const vite = upath.join(dir, 'node_modules', 'vite');
    fs.mkdirSync(upath.join(vite, 'bin'), { recursive: true });
    fs.writeFileSync(upath.join(vite, 'package.json'), JSON.stringify({ name: 'vite', version: viteVersion, bin: { vite: 'bin/vite.js' } }));
    fs.writeFileSync(upath.join(vite, 'bin', 'vite.js'), "console.log(`VITE ${process.argv.slice(2).join(' ')} ${process.env.CROSSBIND_APP_PREVIEW}`);\n");
}
const preview = (...args) => spawnSync(process.execPath, [CLI, 'app', 'preview', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir, USERPROFILE: dir } });

// crossbind cloud as a preview asks it, on this machine: the account TOKEN signs in to, and the session's registration,
// which `refuse` answers with its [status, body], and its removal; a snapshot made, its upload, which `refuseUpload`
// answers, and its removal, which `refuseRemoval` answers; each call recorded with its body, JSON or the bytes sent, and
// the length it said.
function standInCloud({ refuse, refuseUpload, refuseRemoval } = {}) {
    const calls = [];
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', (chunk) => { chunks.push(chunk); });
        request.on('end', () => {
            const sent = Buffer.concat(chunks);
            calls.push({
                call: `${request.method} ${request.url}`,
                authorization: request.headers.authorization,
                body: request.headers['content-type'] === 'application/json' ? JSON.parse(sent) : (sent.length > 0 && sent) || undefined,
                length: request.headers['content-length'],
            });
            const answer = (status, body) => response.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? undefined : JSON.stringify(body));
            const isSession = request.url.startsWith('/v1/sessions/');
            if (request.url === '/v1/account') answer(...(request.headers.authorization === `Bearer ${TOKEN}` ? [200, ACCOUNT] : [401, { error: 'Sign in with crossbind login.' }]));
            else if (request.url === '/v1/snapshots' && request.method === 'POST') answer(200, { id: SNAPSHOT });
            else if (request.url === `/v1/snapshots/${SNAPSHOT}` && request.method === 'PUT') {
                answer(...(refuseUpload ?? [200, {
                    id: SNAPSHOT, version: 3, files: 2, bytes: 49, expiresAt: '2026-12-21T10:00:00.000Z',
                }]));
            } else if (request.url === `/v1/snapshots/${SNAPSHOT}` && request.method === 'DELETE') {
                answer(...(refuseRemoval ?? [204]));
            } else if (isSession && request.method === 'PUT') answer(...(refuse ?? [200, { id: request.url.slice('/v1/sessions/'.length), expiresAt: '2026-11-21T10:10:00.000Z' }]));
            else if (isSession && request.method === 'DELETE') answer(204);
            else answer(404, { error: 'Not found.' });
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ calls, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
    });
}

// This machine signed in to the stand-in with crossbind login, as its credentials file keeps it.
function signIn(cloud, token = TOKEN) {
    const file = upath.join(dir, '.crossbind', 'credentials.json');
    fs.mkdirSync(upath.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ [cloud.url]: { token, login: ACCOUNT.name } }));
}

// crossbind app preview pointed at the stand-in, which answers while it runs, the QR code in its colours.
const previewWith = (cloud, ...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, 'app', 'preview', ...args], {
        cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir, CROSSBIND_CLOUD_URL: cloud.url, NO_COLOR: '' },
    });
    const said = { stdout: '', stderr: '' };
    child.stdout.on('data', (chunk) => { said.stdout += chunk; });
    child.stderr.on('data', (chunk) => { said.stderr += chunk; });
    child.on('close', (status) => resolve({ status, ...said }));
});

describe('crossbind app preview', () => {
    test("is no command crossbind app's help lists", () => {
        projectWith('export default {};\n');
        const help = spawnSync(process.execPath, [CLI, 'app', '--help'], { cwd: dir, encoding: 'utf8' });
        expect(help.stdout).toContain('dev [options]');
        expect(help.stdout).not.toContain('preview');
    });

    test('stops at a Vite older than 8.1, naming its version', () => {
        projectWith('export default {};\n', '8.0.3');
        expect(preview()).toMatchObject({ status: 1, stderr: expect.stringContaining('crossbind app preview needs Vite 8.1 or later, and this project has 8.0.3: update vite.') });
    });

    test.each([
        ['a project of no web build', "export default { target: { runtimeEnv: 'app' } };\n", "runs the project's web build, which target.runtimeEnv 'app' in crossbind.config.js leaves out"],
        ['threads', "export default { target: { runtime: 'mt' } };\n", "a preview runs single-threaded WebAssembly, and target.runtime is 'mt'"],
    ])('stops at %s by its name, before Vite starts', (_, config, message) => {
        projectWith(config);
        const { status, stdout, stderr } = preview();
        expect(status).toBe(1);
        expect(stderr).toContain(message);
        expect(stdout).not.toContain('VITE');
    });

    test('stops at an extension with native code the crossbind app does not carry', () => {
        fs.writeFileSync(upath.join(dir, 'camera.cpp'), '');
        projectWith(`export default { extensions: [{ name: 'acme-camera', contract: 3, root: ${JSON.stringify(dir)}, app: { sources: ['camera.cpp'] } }] };\n`);
        const { status, stdout, stderr } = preview();
        expect(status).toBe(1);
        expect(stderr).toContain('crossbind: the extension acme-camera has native code, which the crossbind app does not carry: crossbind app dev runs it.');
        expect(stdout).not.toContain('VITE');
    });

    test("stops at a dependency none of whose packages serves the web build's target", () => {
        const dependency = upath.join(dir, 'dep');
        fs.mkdirSync(dependency);
        fs.writeFileSync(upath.join(dependency, 'package.json'), JSON.stringify({ name: '@acme/port-x-android', version: '1.0.0', type: 'module' }));
        fs.writeFileSync(upath.join(dependency, 'crossbind.config.mjs'), "export default { general: { name: 'acme-x' }, export: { type: 'cmake' }, paths: { config: import.meta.url, output: 'dist' } };\n");
        projectWith("import dependency from './dep/crossbind.config.mjs';\nexport default { dependencies: [dependency] };\n");
        const { status, stdout, stderr } = preview();
        expect(status).toBe(1);
        expect(stderr).toContain("crossbind: crossbind app preview runs the project's web build, and @acme/port-x-android has no WebAssembly build: list its wasm package beside the native ones, or run crossbind app dev.");
        expect(stdout).not.toContain('VITE');
    });

    test("lists its session on the account's list, names what is the crossbind app's in a preview, goes on to Vite with the key, the address and the session, and takes the session off as Vite ends", async () => {
        projectWith("export default { app: { urlSchemes: ['acme'] } };\n");
        const cloud = await standInCloud();
        signIn(cloud);
        try {
            const { status, stdout } = await previewWith(cloud, '--mode', 'staging');
            expect(status).toBe(0);
            expect(stdout).toContain('crossbind app preview: demo, protocol 1, Vite 8.3.8\n  signed in to crossbind cloud as made-up-dev\n');
            expect(stdout).toContain("in a preview these are the crossbind app's: app.urlSchemes (links of acme open nothing of this project)");
            const [, address, port, key] = stdout.match(/open: http:\/\/(\S+):(\d+)\/#k=([A-Za-z0-9_-]{43})\n/);
            const [, link, id] = stdout.match(/ {2}scan this with a phone's camera, or open (https:\/\/crossbind\.dev\/open\/\?s=([A-Za-z0-9_-]{22}))\n/);
            expect(stdout).toContain(`${qrLines(link, {}).map((line) => `  ${line}`).join('\n')}\n  Projects lists it in the crossbind app on every device signed in as made-up-dev\n`);
            const handed = JSON.parse(stdout.match(/^VITE --mode staging (.*)$/m)[1]);
            expect(handed).toMatchObject({
                key, port: Number(port), session: { protocol: 1, project: { name: 'demo' }, account: ACCOUNT, session: id },
            });
            expect(cloud.calls.map(({ call }) => call)).toEqual(['GET /v1/account', `PUT /v1/sessions/${id}`, `DELETE /v1/sessions/${id}`]);
            expect(cloud.calls.map(({ authorization }) => authorization)).toEqual(Array(3).fill(`Bearer ${TOKEN}`));
            expect(cloud.calls[1].body).toEqual({
                source: 'dev', project: { id: projectIdOf('demo', dir), name: 'demo' }, addresses: [`${address}:${port}`], protocol: 1, key,
            });
            // crossbind prints the key once, in the line's fragment; the rest is the stand-in's.
            expect(stdout.slice(0, stdout.indexOf('VITE --mode')).split(key)).toHaveLength(2);
        } finally {
            cloud.close();
        }
    });

    test.skipIf(process.platform === 'win32')('takes its session off the list as a Ctrl-C ends Vite, before crossbind ends', async () => {
        projectWith('export default {};\n');
        // A Vite that runs until a signal ends it.
        fs.writeFileSync(upath.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), "console.log('VITE running');\nsetInterval(() => {}, 1000);\n");
        const cloud = await standInCloud();
        signIn(cloud);
        try {
            const child = spawn(process.execPath, [CLI, 'app', 'preview'], {
                cwd: dir, env: { ...process.env, HOME: dir, USERPROFILE: dir, CROSSBIND_CLOUD_URL: cloud.url },
            });
            const ended = new Promise((resolve) => { child.on('close', resolve); });
            await new Promise((resolve) => { child.stdout.on('data', (chunk) => { if (String(chunk).includes('VITE running')) resolve(); }); });
            child.kill('SIGINT');
            expect(await ended).toBe(130);
            expect(cloud.calls.map(({ call }) => call.split(' ')[0])).toEqual(['GET', 'PUT', 'DELETE']);
        } finally {
            cloud.close();
        }
    });

    test('stops before it asks crossbind cloud anything where the project\'s name is one the cloud lists no project by, saying what to set', async () => {
        const cloud = await standInCloud();
        signIn(cloud);
        try {
            for (const name of ['a'.repeat(65), 'made-up#app']) {
                projectWith(`export default { general: { name: ${JSON.stringify(name)} } };\n`);
                const { status, stdout, stderr } = await previewWith(cloud);
                expect(status).toBe(1);
                expect(stderr).toContain(`crossbind: crossbind app preview lists this project on your account by its name, ${JSON.stringify(name)}, which crossbind cloud takes as 1 to 64 letters, digits, spaces and ._@/- alone: set general.name in crossbind.config.js to such a name.`);
                expect(stdout).not.toContain('VITE');
            }
            expect(cloud.calls).toEqual([]);
        } finally {
            cloud.close();
        }
    });

    test('with --cloud builds the web build in preview mode, which takes no key, uploads it as a snapshot in one archive, prints the QR code of its link, and ends', async () => {
        projectWith('export default {};\n');
        fs.writeFileSync(upath.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), BUILDING_VITE);
        const cloud = await standInCloud();
        signIn(cloud);
        try {
            const { status, stdout } = await previewWith(cloud, '--cloud', '--mode', 'staging');
            const link = `https://crossbind.dev/open/?s=${SNAPSHOT}`;
            const [, handed, preview] = stdout.match(/^VITE (.*) (\{.*\})$/m);
            const put = cloud.calls[2];
            fs.writeFileSync(upath.join(dir, 'snapshot.tar'), put.body);
            fs.mkdirSync(upath.join(dir, 'unpacked'));
            const tar = spawnSync('tar', ['-xf', 'snapshot.tar', '-C', 'unpacked'], { cwd: dir, encoding: 'utf8' });

            expect(status).toBe(0);
            // Under the project's own .crossbind, whose drive letter Windows may write in another case.
            expect(handed).toMatch(/^build --outDir .+\/\.crossbind\/build\/snapshot --emptyOutDir --mode staging$/);
            expect(JSON.parse(preview)).toEqual({ build: true });
            expect(stdout).toContain(`crossbind app preview: demo, protocol 1, Vite 8.3.8\n  signed in to crossbind cloud as made-up-dev\n  uploaded as a snapshot, version 3, kept until 21 December 2026\n  scan this with a phone's camera, or open ${link}\n${qrLines(link, {}).map((line) => `  ${line}`).join('\n')}\n  Projects lists it in the crossbind app on every device signed in as made-up-dev\n`);
            expect(stdout).not.toContain('open: http');
            expect(cloud.calls.map(({ call }) => call)).toEqual(['GET /v1/account', 'POST /v1/snapshots', `PUT /v1/snapshots/${SNAPSHOT}`]);
            expect(cloud.calls.map(({ authorization }) => authorization)).toEqual(Array(3).fill(`Bearer ${TOKEN}`));
            expect(cloud.calls[1].body).toEqual({ project: { id: projectIdOf('demo', dir), name: 'demo' }, protocol: 1 });
            expect([put.length, tar.status]).toEqual([String(put.body.length), 0]);
            expect(['index.html', 'assets/app.js'].map((name) => fs.readFileSync(upath.join(dir, 'unpacked', name), 'utf8'))).toEqual(['<!doctype html><title>demo</title>', 'console.log(1);']);
        } finally {
            cloud.close();
        }
    });

    test("with --cloud stops with crossbind cloud's words where it refuses the upload, and prints no QR code", async () => {
        projectWith('export default {};\n');
        fs.writeFileSync(upath.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), BUILDING_VITE);
        const cloud = await standInCloud({ refuseUpload: [413, { error: 'A snapshot holds 50 MB at most.' }] });
        signIn(cloud);
        try {
            const { status, stdout, stderr } = await previewWith(cloud, '--cloud');
            expect(status).toBe(1);
            expect(stderr).toContain('crossbind: A snapshot holds 50 MB at most.');
            expect(stdout).not.toContain('scan this');
        } finally {
            cloud.close();
        }
    });

    test('with --cloud --remove finds the project\'s snapshot as an upload finds it and removes it, with no Vite and no build, and says so', async () => {
        // A Vite too old for a preview, which a removal never asks.
        projectWith('export default {};\n', '7.3.1');
        const cloud = await standInCloud();
        signIn(cloud);
        try {
            const { status, stdout } = await previewWith(cloud, '--cloud', '--remove');

            expect(status).toBe(0);
            expect(stdout).toBe('crossbind app preview: demo\n  signed in to crossbind cloud as made-up-dev\n  removed its snapshot from crossbind cloud: no device signed in as made-up-dev lists it now\n');
            expect(cloud.calls.map(({ call }) => call)).toEqual(['GET /v1/account', 'POST /v1/snapshots', `DELETE /v1/snapshots/${SNAPSHOT}`]);
            expect(cloud.calls.map(({ authorization }) => authorization)).toEqual(Array(3).fill(`Bearer ${TOKEN}`));
            expect(cloud.calls[1].body).toEqual({ project: { id: projectIdOf('demo', dir), name: 'demo' }, protocol: 1 });
            expect(fs.existsSync(upath.join(dir, '.crossbind', 'build', 'snapshot'))).toBe(false);
        } finally {
            cloud.close();
        }
    });

    test("with --cloud --remove stops with crossbind cloud's words where it refuses the removal, and with --remove alone asks for --cloud before anything", async () => {
        projectWith('export default {};\n');
        const cloud = await standInCloud({ refuseRemoval: [404, { error: 'No snapshot of this account has this id.' }] });
        signIn(cloud);
        try {
            const refused = await previewWith(cloud, '--cloud', '--remove');
            const calls = cloud.calls.length;
            const alone = await previewWith(cloud, '--remove');

            expect([refused.status, alone.status]).toEqual([1, 1]);
            expect(refused.stderr).toContain('crossbind: No snapshot of this account has this id.');
            expect(refused.stdout).not.toContain('removed');
            expect(alone.stderr).toContain('crossbind: --remove removes this project\'s snapshot from crossbind cloud, with --cloud: crossbind app preview --cloud --remove.');
            expect(cloud.calls.length).toBe(calls);
        } finally {
            cloud.close();
        }
    });

    test('with --cloud ends with what the build ended with where Vite fails, and asks the cloud nothing past the account', async () => {
        projectWith('export default {};\n');
        fs.writeFileSync(upath.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), "console.error('VITE failed');\nprocess.exit(3);\n");
        const cloud = await standInCloud();
        signIn(cloud);
        try {
            const { status, stdout } = await previewWith(cloud, '--cloud');
            expect(status).toBe(3);
            expect(stdout).not.toContain('uploaded');
            expect(cloud.calls.map(({ call }) => call)).toEqual(['GET /v1/account']);
        } finally {
            cloud.close();
        }
    });

    test('stops before Vite, asking for crossbind login, where this machine is not signed in, or its sign-in no longer holds', async () => {
        projectWith('export default {};\n');
        const cloud = await standInCloud();
        try {
            const unsigned = await previewWith(cloud);
            signIn(cloud, `cbt_${'b'.repeat(43)}`);
            const lapsed = await previewWith(cloud);
            for (const { status, stdout, stderr } of [unsigned, lapsed]) {
                expect(status).toBe(1);
                expect(stderr).toContain(NOT_SIGNED_IN);
                expect(stdout).not.toContain('VITE');
            }
            // The machine not signed in asked nothing.
            expect(cloud.calls.map(({ call }) => call)).toEqual(['GET /v1/account']);
        } finally {
            cloud.close();
        }
    });

    test("stops before Vite with crossbind cloud's words where it refuses the session, and prints no address", async () => {
        projectWith('export default {};\n');
        const cloud = await standInCloud({ refuse: [429, { error: 'This account has 10 previews running, as many as it may: stop one first.' }] });
        signIn(cloud);
        try {
            const { status, stdout, stderr } = await previewWith(cloud);
            expect(status).toBe(1);
            expect(stderr).toContain('crossbind: This account has 10 previews running, as many as it may: stop one first.');
            expect(stdout).not.toContain('VITE');
            expect(stdout).not.toContain('open:');
        } finally {
            cloud.close();
        }
    });
});

describe("a preview's session on the account's list", () => {
    test('names a project alike at each run, from its name and its root, and another root or name otherwise, in 16 bytes', () => {
        const other = upath.join(dir, 'other');
        fs.mkdirSync(other);
        expect(projectIdOf('demo', dir)).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(projectIdOf('demo', dir)).toBe(projectIdOf('demo', dir));
        expect(new Set([projectIdOf('demo', dir), projectIdOf('demo', other), projectIdOf('demo-2', dir)]).size).toBe(3);
    });

    test.skipIf(process.platform === 'win32')("names a project by its root's real path, whatever link leads to it", () => {
        const link = upath.join(os.tmpdir(), `crossbind-preview-link-${process.pid}`);
        fs.symlinkSync(dir, link);
        try {
            expect(projectIdOf('demo', link)).toBe(projectIdOf('demo', dir));
        } finally {
            fs.rmSync(link);
        }
    });

    test("draws a session's QR code black on bright white, and in the terminal's own colours under NO_COLOR", () => {
        const link = 'https://crossbind.dev/open/?s=IRVUB8Fpwuh0lT_7NkiJ8Q';
        const plain = halfBlocks(qrMatrix(link).modules);
        expect(qrLines(link, { NO_COLOR: '1' })).toEqual(plain);
        expect(qrLines(link, {})).toEqual(plain.map((line) => `\x1b[30;107m${line}\x1b[0m`));
        expect(qrLines(link, { NO_COLOR: '' })).toEqual(qrLines(link, {}));
    });
});

describe("what crossbind app preview reads of the project's code", () => {
    test('stops at a page API Node cannot import, saying so', async () => {
        // A page module that reads the browser's window as it loads, which Node has not.
        const file = upath.join(dir, 'app.mjs');
        fs.writeFileSync(file, 'export const app = window.crossbind;\n');
        await expect(projectPageApi(file)).rejects.toThrow(`crossbind: crossbind app preview reads the names of this project's crossbind/app from ${file}, which Node cannot import: window is not defined. Update @crossbind/core-app-host to match crossbind.`);
    });

    test('names the native sources that include <crossbind/app.h> where the compile stopped at it', () => {
        const including = upath.join(dir, 'src', 'native', 'app.cpp');
        const other = upath.join(dir, 'src', 'native', 'other.cpp');
        fs.mkdirSync(upath.dirname(including), { recursive: true });
        fs.writeFileSync(including, '#include <crossbind/app.h>\n');
        fs.writeFileSync(other, '#include "other.h"\n');
        const failed = new Error('crossbind: command failed (make) with exit code 2', { cause: { stderr: Buffer.from("src/native/app.cpp:1:10: fatal error: 'crossbind/app.h' file not found") } });
        expect(appHeaderBlocker(failed, [including, other], dir).message).toBe("crossbind: src/native/app.cpp includes <crossbind/app.h>, the app's native API, which a preview's WebAssembly does not have: keep it under #ifdef CROSSBIND_APP, or run crossbind app dev.");
        expect(appHeaderBlocker(new Error('crossbind: command failed', { cause: { stderr: Buffer.from('other.cpp: error') } }), [including], dir)).toBeNull();
    });

    test('takes Vite 8.1 and later', () => {
        expect(viteProblem('vite', '8.1.0')).toBeNull();
        expect(viteProblem('vite', '9.0.0-beta.1')).toBeNull();
        expect(viteProblem('vite', '7.3.1')).toBe('crossbind: crossbind app preview needs Vite 8.1 or later, and this project has 7.3.1: update vite.');
        expect(viteProblem('vite-plus-core', '0.1.0')).toContain('this project has vite-plus-core 0.1.0');
    });
});
