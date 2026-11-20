import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import upath from 'upath';
import { appHeaderBlocker, projectPageApi, viteProblem } from '../src/actions/appPreview.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

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

    test("names what is the crossbind app's in a preview, and goes on to Vite with the key, the address and the session", () => {
        projectWith("export default { app: { urlSchemes: ['acme'] } };\n");
        const { status, stdout } = preview('--mode', 'staging');
        expect(status).toBe(0);
        expect(stdout).toContain('crossbind app preview: demo, protocol 1, Vite 8.3.8');
        expect(stdout).toContain("in a preview these are the crossbind app's: app.urlSchemes (links of acme open nothing of this project)");
        const key = stdout.match(/open: http:\/\/\S+:(\d+)\/#k=([A-Za-z0-9_-]{43})\n/);
        expect(key).not.toBeNull();
        const handed = JSON.parse(stdout.match(/^VITE --mode staging (.*)$/m)[1]);
        expect(handed).toMatchObject({ key: key[2], port: Number(key[1]), session: { protocol: 1, project: { name: 'demo' } } });
        // crossbind prints the key once, in the line's fragment; the rest is the stand-in's.
        expect(stdout.slice(0, stdout.indexOf('VITE --mode')).split(key[2])).toHaveLength(2);
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
