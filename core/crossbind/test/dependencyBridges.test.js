import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withDependencyBridges } from '../src/utils/dependencyBridges.js';

let work;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-dependency-bridges-'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

function bridge(name, dependencies) {
    const file = path.join(work, `${name}.i.cpp`);
    fs.writeFileSync(file, `// ${name}\n`);
    if (dependencies) {
        fs.writeFileSync(`${file}.deps`, dependencies.map((dependency) => `${path.join(work, `${dependency}.i.cpp`)}\n`).join(''));
    }
    return file;
}

describe('withDependencyBridges', () => {
    test('adds the bridges each listed bridge depends on, once, after the listed files', () => {
        const common = path.join(work, 'commonBridges.cpp');
        fs.writeFileSync(common, '');
        const cplError = bridge('cpl_error');
        const ogrCore = bridge('ogr_core');
        const gdal = bridge('gdal', ['cpl_error', 'ogr_core']);
        const vsi = bridge('cpl_vsi', ['cpl_error']);
        expect(withDependencyBridges([common, gdal, vsi])).toEqual([common, gdal, vsi, cplError, ogrCore]);
    });

    test('leaves out dependency bridges that no longer exist', () => {
        const gdal = bridge('gdal', ['cpl_error']);
        expect(withDependencyBridges([gdal])).toEqual([gdal]);
    });
});
