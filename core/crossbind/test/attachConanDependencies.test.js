import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { getFilledConfig } from '../src/state/loadConfig.js';
import attachConanDependencies from '../src/state/attachConanDependencies.js';
import { conanDependenciesKey, normalizeConanDependencies } from '../src/utils/conanDependencies.js';
import { writeConanManifest } from '../src/utils/conanStage.js';
import { filterTargetSpecs } from '../src/utils/targets.js';

const TARGET = { platform: 'wasm', path: 'wasm-wasm32-st-release', releasePath: 'wasm-wasm32-st-release' };
const PACKAGES = [
    {
        name: 'libpng', version: '1.6.58', ref: 'libpng/1.6.58#19cb72905ae54f54948401f753faa2c1', license: 'libpng-2.0', libs: ['png'], requires: ['zlib'],
    },
    {
        name: 'zlib', version: '1.3.2', ref: 'zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb', license: 'Zlib', libs: ['z'], requires: [],
    },
];

let project;
const stageDir = () => upath.join(project, '.crossbind', 'conan');

function stage(conanDependencies, packages = PACKAGES) {
    writeConanManifest(stageDir(), TARGET.path, { key: conanDependenciesKey(normalizeConanDependencies(conanDependencies)), packages });
    packages.forEach((pkg) => {
        const dir = upath.join(stageDir(), 'packages', pkg.name);
        fs.mkdirSync(upath.join(dir, 'dist', 'prebuilt', TARGET.path, 'lib'), { recursive: true });
        fs.writeFileSync(upath.join(dir, 'dist', 'prebuilt', 'CMakeLists.txt'), '');
        fs.writeFileSync(upath.join(dir, 'package.json'), JSON.stringify({ name: `conan:${pkg.name}`, version: pkg.version }));
    });
}

const appConfig = (conanDependencies) => getFilledConfig({ paths: { project }, conanDependencies });
const conanNames = (dependencies) => dependencies.filter((d) => d.general.conan).map((d) => d.general.name);

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-attach-')));
    fs.writeFileSync(upath.join(project, 'package.json'), JSON.stringify({ name: 'conan-attach-app', version: '0.0.0' }));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe('attaching the staged Conan packages', () => {
    test('every staged package joins the config as a dependency the link and the cmake graph see', () => {
        stage({ libpng: '1.6.58' });
        const config = appConfig({ libpng: '1.6.58' });

        attachConanDependencies(config);

        expect(conanNames(config.dependencies)).toEqual(['conan_libpng', 'conan_zlib']);
        expect(conanNames(config.allDependencies)).toEqual(['conan_libpng', 'conan_zlib']);
        const libpng = config.dependencies.find((d) => d.general.name === 'conan_libpng');
        expect(libpng.general.conan).toMatchObject({ name: 'libpng', license: 'libpng-2.0' });
        expect(libpng.export.libName).toEqual(['png']);
        expect(libpng.paths.output).toBe(upath.join(stageDir(), 'packages', 'libpng', 'dist'));
        expect(libpng.functions.isEnabled(TARGET)).toBe(true);
        expect(config.dependencyParameters.getCmakeDepends(TARGET).map((d) => d.general.name)).toEqual(['conan_libpng', 'conan_zlib']);
    });

    test('attaching again keeps one copy of each package', () => {
        stage({ libpng: '1.6.58' });
        const config = appConfig({ libpng: '1.6.58' });

        attachConanDependencies(config);
        attachConanDependencies(config);

        expect(conanNames(config.allDependencies)).toEqual(['conan_libpng', 'conan_zlib']);
    });

    test('a package links the system libraries and frameworks its recipe declares for each target', () => {
        const key = conanDependenciesKey(normalizeConanDependencies({ libcurl: '8.22.0' }));
        const curl = (link) => ({
            name: 'libcurl', version: '8.22.0', ref: 'libcurl/8.22.0#0123456789abcdef0123456789abcdef', license: 'curl', libs: ['curl'], requires: [], ...link,
        });
        writeConanManifest(stageDir(), 'darwin-arm64-mt-release', { key, packages: [curl({ systemLibs: [], frameworks: ['CoreFoundation', 'SystemConfiguration'] })] });
        writeConanManifest(stageDir(), 'linux-x64-mt-release', { key, packages: [curl({ systemLibs: ['rt', 'pthread'], frameworks: [] })] });
        const dir = upath.join(stageDir(), 'packages', 'libcurl');
        fs.mkdirSync(upath.join(dir, 'dist', 'prebuilt'), { recursive: true });
        fs.writeFileSync(upath.join(dir, 'dist', 'prebuilt', 'CMakeLists.txt'), '');
        fs.writeFileSync(upath.join(dir, 'package.json'), JSON.stringify({ name: 'conan:libcurl', version: '8.22.0' }));
        const config = appConfig({ libcurl: '8.22.0' });

        attachConanDependencies(config);

        const { targetSpecs } = config.dependencies.find((d) => d.general.name === 'conan_libcurl');
        const flagsFor = (target) => filterTargetSpecs(targetSpecs, target).flatMap((specs) => specs.binary?.addonFlags ?? []);
        // A framework goes as one linker argument: CMake collapses a repeated -framework.
        expect(flagsFor({ platform: 'darwin', arch: 'arm64', runtime: 'mt', buildType: 'debug' })).toEqual(['-Wl,-framework,CoreFoundation', '-Wl,-framework,SystemConfiguration']);
        expect(flagsFor({ platform: 'linux', arch: 'x64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node' })).toEqual(['-lrt', '-lpthread']);
        expect(flagsFor({ platform: 'darwin', arch: 'x64', runtime: 'mt', buildType: 'release' })).toEqual([]);
    });

    test('packages staged for other conanDependencies are left out', () => {
        stage({ libpng: '1.6.57' });
        const config = appConfig({ libpng: '1.6.58' });

        attachConanDependencies(config);

        expect(conanNames(config.allDependencies)).toEqual([]);
    });
});
