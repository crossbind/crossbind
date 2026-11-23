import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import { describe, test, expect } from 'vitest';
import { configFileOf } from '../src/utils/configFile.js';

describe('configFileOf', () => {
    test("finds an app's crossbind.config.mjs, and a port's crossbind.config.js first", () => {
        const dir = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-config-file-')));
        try {
            expect(configFileOf(dir)).toBeUndefined();
            fs.writeFileSync(upath.join(dir, 'crossbind.config.mjs'), 'export default {};\n');
            expect(upath.basename(configFileOf(dir))).toBe('crossbind.config.mjs');
            fs.writeFileSync(upath.join(dir, 'crossbind.config.js'), 'export default {};\n');
            expect(upath.basename(configFileOf(dir))).toBe('crossbind.config.js');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
