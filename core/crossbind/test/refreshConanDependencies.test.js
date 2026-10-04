import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { getFilledConfig } from '../src/state/loadConfig.js';
import refreshConanDependencies from '../src/state/refreshConanDependencies.js';
import { conanDependenciesKey, normalizeConanDependencies } from '../src/utils/conanDependencies.js';
import { writeConanManifest } from '../src/utils/conanStage.js';

const TARGET = 'android-arm64-v8a-mt-release';
const DEPENDENCIES = { zlib: '1.3.2' };

let project;
const stageDir = () => upath.join(project, '.crossbind', 'conan');
const conanNames = (config) => config.allDependencies.filter((d) => d.general.conan).map((d) => d.general.conan.name);

function stageZlib() {
    const prebuilt = upath.join(stageDir(), 'packages', 'zlib', 'dist', 'prebuilt');
    fs.mkdirSync(upath.join(prebuilt, TARGET, 'include'), { recursive: true });
    fs.writeFileSync(upath.join(prebuilt, 'CMakeLists.txt'), '');
    writeConanManifest(stageDir(), TARGET, {
        key: conanDependenciesKey(normalizeConanDependencies(DEPENDENCIES)),
        packages: [{
            name: 'zlib', version: '1.3.2', ref: 'zlib/1.3.2', license: 'Zlib', libs: ['z'], requires: [],
        }],
    });
}

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-refresh-')));
    fs.writeFileSync(upath.join(project, 'package.json'), JSON.stringify({ name: 'conan-refresh-app', version: '0.0.0' }));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe('refreshing the attached Conan packages', () => {
    test('picks up packages a build staged after the config loaded, as a Metro server needs', () => {
        const config = getFilledConfig({ paths: { project }, conanDependencies: DEPENDENCIES });
        refreshConanDependencies(config);
        expect(conanNames(config)).toEqual([]);

        stageZlib();

        expect(refreshConanDependencies(config)).toBe(true);
        expect(conanNames(config)).toEqual(['zlib']);
    });

    test('attaches nothing again while the manifests stay as they were', () => {
        stageZlib();
        const config = getFilledConfig({ paths: { project }, conanDependencies: DEPENDENCIES });
        refreshConanDependencies(config);

        expect(refreshConanDependencies(config)).toBe(false);
        expect(conanNames(config)).toEqual(['zlib']);
    });

    test('leaves a project without conanDependencies alone', () => {
        const config = getFilledConfig({ paths: { project } });

        expect(refreshConanDependencies(config)).toBe(false);
    });
});
