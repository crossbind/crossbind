import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import runPackageSource, { runProbe } from '../src/utils/runPackageSource.js';
import logger from '../src/utils/logger.js';
import packageSourceApi from '../src/utils/packageSourceApi.js';

vi.mock('../src/utils/runPackageSource.js', () => ({ default: vi.fn(), runProbe: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn() } }));

const SOURCE = { name: 'conan', packageSource: { storeUnits: ['p/*/p', 'b/*/p'] } };
const CONFIG = { paths: { base: '/repo' }, system: {} };
const TARGET = {
    platform: 'wasm', arch: 'wasm32', runtime: 'st', path: 'wasm-wasm32-st-release',
};
// A run's directories as runPackageSource gives them: where they are, and where the tool sees them.
const workOf = (runner) => ({
    name: 'conan',
    runner,
    root: '/home/.crossbind/conan',
    store: '/home/.crossbind/conan/store',
    dir: '/home/.crossbind/conan/work/run-1',
    toolDir: '/tool/work/run-1',
    toolPath: (...segments) => ['/tool/work/run-1', ...segments].join('/'),
    storePath: (...segments) => ['/tool/store', ...segments].join('/'),
});
const ran = (overrides = {}) => ({
    status: 0, stdout: '', stderr: '', ...overrides,
});
const failureOf = (run) => {
    try {
        run();
    } catch (error) {
        return error;
    }
    return null;
};

describe("what a package source's steps get of crossbind", () => {
    let scratch;
    let logFile;
    const apiOf = (work, log = logFile) => packageSourceApi({
        source: SOURCE, config: CONFIG, target: TARGET, work, logFile: log,
    });
    const installApi = (runner = 'DOCKER_RUN') => apiOf(workOf(runner));
    const inputsApi = (runner = 'LOCAL') => packageSourceApi({
        source: SOURCE, config: CONFIG, target: TARGET, work: workOf(runner),
    });

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-sourceapi-'));
        logFile = path.join(scratch, 'logs', 'wasm-wasm32-st-release.log');
        runPackageSource.mockReset().mockReturnValue(ran());
        runProbe.mockReset().mockReturnValue(ran());
        logger.info.mockReset();
    });

    afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

    describe('the api', () => {
        test("names the source, whether its tool is the host's and the log of the install, and holds nothing else", () => {
            const api = installApi();

            expect(Object.keys(api).sort()).toEqual(['isLocal', 'log', 'logFile', 'name', 'run', 'store', 'work']);
            expect(api).toMatchObject({ name: 'conan', isLocal: false, logFile });
        });

        test("says the tool is the host's under RUNNER=LOCAL alone, which iOS and macOS packages always run under", () => {
            expect(installApi('LOCAL').isLocal).toBe(true);
            expect(['DOCKER_RUN', 'DOCKER_EXEC', 'REMOTE'].map((runner) => installApi(runner).isLocal)).toEqual([false, false, false]);
        });

        test("gives the run's directories as this machine has them and as the tool sees them", () => {
            const work = workOf('DOCKER_RUN');

            const api = apiOf(work);

            expect(Object.keys(api.work).sort()).toEqual(['dir', 'path', 'read']);
            expect(api.work.dir).toBe(work.dir);
            expect(api.work.path()).toBe('/tool/work/run-1');
            expect(api.work.path('home', 'global.conf')).toBe('/tool/work/run-1/home/global.conf');
            expect(Object.keys(api.store).sort()).toEqual(['dir', 'path']);
            expect(api.store.dir).toBe(work.store);
            expect(api.store.path()).toBe('/tool/store');
            expect(api.store.path('p', 'zlib1')).toBe('/tool/store/p/zlib1');
        });

        test('is frozen, its directories and what a run gives back too', () => {
            const api = installApi();

            const result = api.run(['conan', 'install']);

            expect([api, api.work, api.store, result].map(Object.isFrozen)).toEqual([true, true, true, true]);
            expect(() => { api.run = () => {}; }).toThrow(TypeError);
        });

        test("log prints a notice the way the build's own are printed", () => {
            installApi().log('conan: zlib builds from source');

            expect(logger.info.mock.calls).toEqual([['conan: zlib builds from source']]);
        });
    });

    // Recipes write to the work directory too, and a link there could name any file the machine's user reads.
    describe('reading what the tool left in the work directory', () => {
        let dir;
        const read = (...segments) => apiOf({ ...workOf('DOCKER_RUN'), dir }).work.read(...segments);
        const REFUSAL = /no file of its own there: a link, a folder, or a path that leaves the directory\.$/;

        beforeEach(() => {
            dir = path.join(scratch, 'work');
            fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'out', 'graph.json'), '{"graph":{}}');
            fs.writeFileSync(path.join(scratch, 'secret.json'), '{"version":"1","token":"hidden"}');
        });

        test('gives a file of the directory as text, and null where there is none', () => {
            expect(read('out', 'graph.json')).toBe('{"graph":{}}');
            expect(read('out/graph.json')).toBe('{"graph":{}}');
            expect(read('missing.json')).toBeNull();
        });

        test('follows no link, to a file outside the directory or in it, nor through a linked folder', () => {
            fs.symlinkSync(path.join(scratch, 'secret.json'), path.join(dir, 'resolution.lock'));
            fs.symlinkSync(path.join(dir, 'out', 'graph.json'), path.join(dir, 'graph.json'));
            fs.symlinkSync(scratch, path.join(dir, 'up'));

            expect(() => read('resolution.lock')).toThrow('crossbind: conan reads resolution.lock from its work directory, which is no file of its own there: a link, a folder, or a path that leaves the directory.');
            expect(() => read('graph.json')).toThrow(REFUSAL);
            expect(() => read('up', 'secret.json')).toThrow(REFUSAL);
        });

        test('reads nothing above the directory, no folder, and nothing without a name', () => {
            expect(() => read('..', 'secret.json')).toThrow(REFUSAL);
            expect(() => read('out', '..', '..', 'secret.json')).toThrow(REFUSAL);
            expect(() => read('out')).toThrow(REFUSAL);
            expect(() => read()).toThrow(REFUSAL);
            expect(() => read(7)).toThrow(REFUSAL);
        });
    });

    describe('run', () => {
        test('takes a program and its arguments as a list of strings', () => {
            const api = installApi();

            ['conan install', [], ['conan', 1], ['conan', ['install']], ['conan', 'a\0b'], undefined, null].forEach((command) => {
                expect(() => api.run(command), JSON.stringify(command)).toThrow("crossbind: conan's run takes a program and its arguments as a list of strings.");
            });
            expect(runPackageSource).not.toHaveBeenCalled();
        });

        test('takes env as variable names with their text', () => {
            const api = installApi();

            [{ 'CONAN-HOME': '/x' }, { '1ST': 'x' }, { CONAN_HOME: 1 }, { CONAN_HOME: 'a\0b' }, ['CONAN_HOME=/x'], null, 'CONAN_HOME=/x'].forEach((env) => {
                expect(() => api.run(['conan', 'install'], { env }), JSON.stringify(env)).toThrow("crossbind: conan's run takes env as variable names with their text.");
            });
            expect(runPackageSource).not.toHaveBeenCalled();
        });

        test('needs no env', () => {
            const api = installApi();

            api.run(['conan', 'install']);
            api.run(['conan', 'install'], {});

            expect(runPackageSource.mock.calls.map(([, { env }]) => env)).toEqual([{}, {}]);
        });
    });

    describe('in install', () => {
        test("runs the tool where the target's packages build, and gives back what it printed", () => {
            runPackageSource.mockReturnValue(ran({ stdout: 'out\n', stderr: 'err\n' }));
            const work = workOf('DOCKER_RUN');
            const env = { CONAN_HOME: '/tool/work/run-1/home' };

            const result = apiOf(work).run(['conan', 'install', '--build=missing'], { env });

            expect(result).toEqual({ stdout: 'out\n', stderr: 'err\n' });
            expect(runPackageSource.mock.calls).toEqual([[['conan', 'install', '--build=missing'], {
                source: SOURCE, config: CONFIG, target: TARGET, work, env,
            }]]);
            expect(runProbe).not.toHaveBeenCalled();
        });

        test('runs it as a run of the target under RUNNER=LOCAL too, not as an ask of the host', () => {
            const work = workOf('LOCAL');

            apiOf(work).run(['conan', 'install']);

            expect(runPackageSource).toHaveBeenCalledTimes(1);
            expect(runProbe).not.toHaveBeenCalled();
        });

        test("what each run writes to stderr is the install's log, one run after another", () => {
            runPackageSource.mockReturnValueOnce(ran({ stderr: 'first\n' })).mockReturnValueOnce(ran({ stderr: 'second\n' }));
            const api = installApi();

            api.run(['conan', '--version']);
            const afterTheFirst = fs.readFileSync(logFile, 'utf8');
            api.run(['conan', 'install']);

            expect(afterTheFirst).toBe('first\n');
            expect(fs.readFileSync(logFile, 'utf8')).toBe('first\nsecond\n');
        });

        test('another install starts the log again', () => {
            runPackageSource.mockReturnValueOnce(ran({ stderr: 'the last install\n' })).mockReturnValueOnce(ran({ stderr: 'this install\n' }));

            installApi().run(['conan', 'install']);
            installApi().run(['conan', 'install']);

            expect(fs.readFileSync(logFile, 'utf8')).toBe('this install\n');
        });

        test('a failed run names the whole log and ends with the last of it, without what a terminal would obey', () => {
            const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
            const stderr = `${[...lines.slice(0, 98), '\u001b[31mERROR\u001b[0m: boom\tat conanfile.py\u0007', 'line 100'].join('\n')}\n`;
            runPackageSource.mockReturnValue({ status: 1, stdout: '', stderr });

            const failure = failureOf(() => installApi().run(['conan', 'install']));

            const tail = [...lines.slice(40, 98), '[31mERROR[0m: boom\tat conanfile.py', 'line 100'].join('\n');
            expect(failure.message).toBe(`crossbind: conan install for wasm-wasm32-st-release failed (exit code 1). Its whole log is in ${logFile}.\n${tail}`);
            expect(fs.readFileSync(logFile, 'utf8')).toBe(stderr);
        });

        test('a tool that says why on stdout alone ends the message with that', () => {
            runPackageSource.mockReturnValue({ status: 2, stdout: 'resolving\nerror: no such package\n', stderr: '  \n' });

            const failure = failureOf(() => installApi().run(['conan', 'install']));

            expect(failure.message).toBe(`crossbind: conan install for wasm-wasm32-st-release failed (exit code 2). Its whole log is in ${logFile}.\nresolving\nerror: no such package`);
        });

        test('a tool that could not be started is named, with why', () => {
            runPackageSource.mockReturnValue({ status: null, error: Object.assign(new Error('spawnSync conan ENOENT'), { code: 'ENOENT' }) });

            const failure = failureOf(() => installApi().run(['conan', 'install']));

            expect(failure.message).toBe('crossbind: could not run conan for wasm-wasm32-st-release (spawnSync conan ENOENT).');
            expect(fs.readFileSync(logFile, 'utf8')).toBe('');
        });

        test('a tool that printed more than crossbind reads is said to have been stopped for it', () => {
            runPackageSource.mockReturnValue({
                status: null, error: Object.assign(new Error('spawnSync conan ENOBUFS'), { code: 'ENOBUFS' }), stdout: '', stderr: 'so far\n',
            });

            const failure = failureOf(() => installApi().run(['conan', 'install']));

            expect(failure.message).toBe(`crossbind: conan install for wasm-wasm32-st-release was stopped: it printed more than crossbind reads. Its whole log is in ${logFile}.\nso far`);
        });

        test('a tool a signal stopped names the signal', () => {
            runPackageSource.mockReturnValue({
                status: null, signal: 'SIGKILL', stdout: '', stderr: 'Killed\n',
            });

            const failure = failureOf(() => installApi().run(['conan', 'install']));

            expect(failure.message).toBe(`crossbind: conan install for wasm-wasm32-st-release was stopped by SIGKILL. Its whole log is in ${logFile}.\nKilled`);
        });
    });

    describe('in inputs, where nothing is installed', () => {
        test("asks a tool of the host in the source's probe directory, and keeps no log", () => {
            runProbe.mockReturnValue(ran({ stdout: 'Conan version 2.21.0\n', stderr: 'migrating the home\n' }));
            const work = workOf('LOCAL');
            const api = packageSourceApi({
                source: SOURCE, config: CONFIG, target: TARGET, work,
            });

            const result = api.run(['conan', '--version'], { env: { CONAN_HOME: '/probe/home' } });

            expect(api.logFile).toBeNull();
            expect(result).toEqual({ stdout: 'Conan version 2.21.0\n', stderr: 'migrating the home\n' });
            expect(runProbe.mock.calls).toEqual([[['conan', '--version'], { work, env: { CONAN_HOME: '/probe/home' } }]]);
            expect(runPackageSource).not.toHaveBeenCalled();
            expect(fs.readdirSync(scratch)).toEqual([]);
        });

        test('a failed ask names the step, with no log to point at', () => {
            runProbe.mockReturnValue({ status: 2, stdout: '', stderr: 'boom\n' });

            const failure = failureOf(() => inputsApi().run(['conan', '--version']));

            expect(failure.message).toBe('crossbind: conan inputs for wasm-wasm32-st-release failed (exit code 2).\nboom');
        });

        test('a tool the host has none of is named, with why', () => {
            runProbe.mockReturnValue({ status: null, error: Object.assign(new Error('spawnSync conan ENOENT'), { code: 'ENOENT' }) });

            const failure = failureOf(() => inputsApi().run(['conan', '--version']));

            expect(failure.message).toBe('crossbind: could not run conan for wasm-wasm32-st-release (spawnSync conan ENOENT).');
        });

        test('runs nothing where an image says what runs', () => {
            ['DOCKER_RUN', 'DOCKER_EXEC', 'REMOTE'].forEach((runner) => {
                expect(() => inputsApi(runner).run(['conan', '--version']), runner)
                    .toThrow("crossbind: conan's inputs runs conan, which it can where api.isLocal is true alone: elsewhere the image says what runs.");
            });
            expect(runProbe).not.toHaveBeenCalled();
            expect(runPackageSource).not.toHaveBeenCalled();
        });
    });
});
