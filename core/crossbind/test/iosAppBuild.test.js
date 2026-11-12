import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const holder = { config: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() {
            return holder.config;
        },
        targets: [],
    },
}));

const { default: getDependLibs } = await import('../src/actions/getDependLibs.js');

const simulator = {
    platform: 'ios', arch: 'iphonesimulator', runtime: 'mt', buildType: 'release', path: 'ios-iphonesimulator-mt-release', releasePath: 'ios-iphonesimulator-mt-release', runtimeEnv: 'app',
};

let work;
let slice;

// crossbind holds paths with forward slashes, Windows' among them.
const file = (at) => {
    fs.mkdirSync(upath.dirname(at), { recursive: true });
    fs.writeFileSync(at, '');
    return at;
};

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-ios-app-')));
    const dependency = { export: { libName: ['dep'] }, paths: { output: upath.join(work, 'dep', 'dist'), project: upath.join(work, 'dep') }, targetSpecs: [] };
    slice = upath.join(work, 'dep', 'dep.xcframework', 'ios-arm64-simulator');
    holder.config = {
        paths: { build: upath.join(work, 'build'), project: work },
        dependencyParameters: { getCmakeDepends: () => [dependency] },
        allDependencyPaths: { [simulator.path]: { dep: { lib: upath.join(slice, 'libdep.a') } } },
    };
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

// A published port can leave its iOS archives to its xcframework, as GDAL's does.
describe('an iOS app build', () => {
    test("links a package's archive from its xcframework where the package has no lib directory", () => {
        const archive = file(upath.join(slice, 'libdep.a'));

        expect(getDependLibs(simulator)).toEqual([archive]);
    });

    test("links the archive of the package's lib directory where it has one", () => {
        file(upath.join(slice, 'libdep.a'));
        const archive = file(upath.join(work, 'dep', 'dist', 'prebuilt', simulator.path, 'lib', 'libdep.a'));

        expect(getDependLibs(simulator)).toEqual([archive]);
    });

    // A project can list a port's packages for several platforms, which share the library's name.
    test('links the xcframework of the package that serves iOS where another platform\'s package shares its name', () => {
        const archive = file(upath.join(slice, 'libdep.a'));
        holder.config.allDependencyPaths = {
            [simulator.path]: { dep: { lib: upath.join(work, 'dep-win32', 'dep.xcframework', 'ios-arm64-simulator', 'libdep.a') } },
        };

        expect(getDependLibs(simulator)).toEqual([archive]);
    });
});
