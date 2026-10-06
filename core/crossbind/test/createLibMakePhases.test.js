import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { run, state } = vi.hoisted(() => ({ run: vi.fn(), state: { config: {} } }));

vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/actions/getCmakeParameters.js', () => ({ default: () => [] }));
vi.mock('../src/actions/getData.js', () => ({ default: () => ({}) }));
vi.mock('../src/actions/extensions.js', () => ({ default: () => {} }));
vi.mock('../src/utils/logger.js', () => ({
    default: { info() {}, error() {}, startStep() {}, doneStep() {}, cachedStep() {} },
}));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: createLib } = await import('../src/actions/createLib.js');

const target = {
    platform: 'linux', arch: 'x64', runtime: 'mt', buildType: 'release', path: 'linux-x64-mt-release',
};
const JOBS = expect.stringMatching(/^-j\d+$/);

describe('createLib make phases', () => {
    let work;

    const makeCalls = () => run.mock.calls.map(([, params]) => params).filter((params) => params[0] === 'make');

    beforeEach(() => {
        run.mockClear();
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-createlib-install-'));
        // A recipe build unpacks its upstream source here; a cmake one reads paths.cmakeDir.
        fs.mkdirSync(`${work}/build/source`, { recursive: true });
        fs.mkdirSync(`${work}/cmake`);
        state.config = {
            paths: { build: `${work}/build`, cmakeDir: `${work}/cmake`, cli: path.resolve(import.meta.dirname, '../src') },
            build: { withBuildConfig: true, buildType: 'configure', makePhases: [['all'], ['install']] },
            export: {},
            allDependencyPaths: { [target.path]: {} },
        };
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('configure builds install through the retrying wrapper, staged inside the build tree', () => {
        createLib(target, 'Source', { buildSource: true });

        const staged = `${work}/build/Source-Release/${target.path}/crossbind-install.sh`;
        expect(makeCalls()).toEqual([
            ['make', JOBS, `INSTALL=${staged}`, 'all'],
            ['make', JOBS, `INSTALL=${staged}`, 'install'],
        ]);
        // Windows keeps no execute bit; the build there runs the wrapper inside the Linux container.
        if (process.platform !== 'win32') expect(fs.statSync(staged).mode & 0o111).not.toBe(0);
    });

    test('cmake builds keep the install rules cmake generated', () => {
        state.config.build = {};

        createLib(target, 'Source', { buildSource: true });

        expect(makeCalls()).toEqual([['make', JOBS, 'install']]);
    });
});
