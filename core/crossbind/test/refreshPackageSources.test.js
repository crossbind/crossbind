import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { getFilledConfig } from '../src/state/loadConfig.js';
import refreshPackageSources from '../src/state/refreshPackageSources.js';
import { dependenciesKey } from '../src/utils/packageSources.js';
import { writeSourceManifest } from '../src/utils/packageSourceStage.js';

const TARGET = 'android-arm64-v8a-mt-release';
const DEPENDENCIES = { zlib: '1.3.2' };

let project;
const stageDir = () => upath.join(project, '.crossbind', 'conan');
const loadConfig = (conan = DEPENDENCIES) => getFilledConfig({ paths: { project }, packages: { conan } });
const packageNames = (config) => config.allDependencies.filter((d) => d.general.packageSource).map((d) => d.general.packageSource.package.name);

function stageZlib() {
    const prebuilt = upath.join(stageDir(), 'packages', 'zlib', 'dist', 'prebuilt');
    fs.mkdirSync(upath.join(prebuilt, TARGET, 'include'), { recursive: true });
    fs.writeFileSync(upath.join(prebuilt, 'CMakeLists.txt'), '');
    writeSourceManifest(stageDir(), TARGET, {
        key: dependenciesKey(loadConfig().packages.conan),
        packages: [{
            name: 'zlib', version: '1.3.2', ref: 'zlib/1.3.2', license: 'Zlib', libs: ['z'], requires: [],
        }],
    });
}

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-source-refresh-')));
    fs.writeFileSync(upath.join(project, 'package.json'), JSON.stringify({ name: 'source-refresh-app', version: '0.0.0' }));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe('refreshing the attached packages of package sources', () => {
    test('picks up packages a build staged after the config loaded, as a Metro server needs', () => {
        const config = loadConfig();
        refreshPackageSources(config);
        expect(packageNames(config)).toEqual([]);

        stageZlib();

        expect(refreshPackageSources(config)).toBe(true);
        expect(packageNames(config)).toEqual(['zlib']);
    });

    test('attaches nothing again while the manifests stay as they were', () => {
        stageZlib();
        const config = loadConfig();
        refreshPackageSources(config);

        expect(refreshPackageSources(config)).toBe(false);
        expect(packageNames(config)).toEqual(['zlib']);
    });

    test('leaves a project that declares no package of any source alone', () => {
        const config = getFilledConfig({ paths: { project } });

        expect(refreshPackageSources(config)).toBe(false);
    });
});
