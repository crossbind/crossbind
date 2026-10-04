import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyBundledLicenses, shippedBundledLicense } from '../src/utils/bundledLicenses.js';

let work;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bundled-licenses-'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

const png = { name: 'libpng', license: 'libpng-2.0', files: ['frmts/png/libpng/LICENSE'] };

describe('copyBundledLicenses', () => {
    test('ships the license texts of the vendored copies in dist, which an installed package keeps', () => {
        const source = path.join(work, 'source');
        fs.mkdirSync(path.join(source, 'frmts/png/libpng'), { recursive: true });
        fs.writeFileSync(path.join(source, 'frmts/png/libpng/LICENSE'), 'png license text');

        copyBundledLicenses([png], source, path.join(work, 'dist'));

        expect(fs.readFileSync(path.join(work, 'dist/licenses/libpng/frmts/png/libpng/LICENSE'), 'utf8')).toBe('png license text');
    });

    test('keeps two license files of one copy apart when their names match', () => {
        const source = path.join(work, 'source');
        const both = { name: 'codec', license: 'MIT', files: ['a/COPYING', 'b/COPYING'] };
        ['a', 'b'].forEach((dir) => {
            fs.mkdirSync(path.join(source, dir), { recursive: true });
            fs.writeFileSync(path.join(source, dir, 'COPYING'), `${dir} text`);
        });

        copyBundledLicenses([both], source, path.join(work, 'dist'));

        expect(fs.readFileSync(path.join(work, 'dist/licenses/codec/a/COPYING'), 'utf8')).toBe('a text');
        expect(fs.readFileSync(path.join(work, 'dist/licenses/codec/b/COPYING'), 'utf8')).toBe('b text');
    });

    test('copies nothing for a platform without vendored copies', () => {
        copyBundledLicenses(undefined, path.join(work, 'source'), path.join(work, 'dist'));

        expect(fs.existsSync(path.join(work, 'dist'))).toBe(false);
    });

    test('a declared license file missing from the source stops the build instead of dropping a notice', () => {
        expect(() => copyBundledLicenses([png], path.join(work, 'source'), path.join(work, 'dist'))).toThrow(/frmts\/png\/libpng\/LICENSE[\s\S]*libpng/);
    });
});

describe('shippedBundledLicense', () => {
    test('finds the text in whichever package of the family shipped it', () => {
        const darwin = path.join(work, 'darwin');
        const linux = path.join(work, 'linux');
        fs.mkdirSync(path.join(linux, 'dist/licenses/libpng/frmts/png/libpng'), { recursive: true });
        fs.writeFileSync(path.join(linux, 'dist/licenses/libpng/frmts/png/libpng/LICENSE'), 'png license text');

        expect(shippedBundledLicense([darwin, linux], 'libpng', 'frmts/png/libpng/LICENSE'))
            .toBe(path.join(linux, 'dist/licenses/libpng/frmts/png/libpng/LICENSE'));
        expect(shippedBundledLicense([darwin], 'libpng', 'frmts/png/libpng/LICENSE')).toBeNull();
    });
});
