import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { withAppOption, writeAppOption } from '../src/utils/configWriter.js';

describe("a key written into crossbind.config.js's app section", () => {
    test('goes first in the app object, at the indentation of its keys', () => {
        const source = "export default {\n    general: { name: 'demo' },\n    app: {\n        name: 'Demo',\n    },\n};\n";
        expect(withAppOption(source, 'id', 'com.example.demo'))
            .toBe("export default {\n    general: { name: 'demo' },\n    app: {\n        id: 'com.example.demo',\n        name: 'Demo',\n    },\n};\n");
        expect(withAppOption("export default {\n    app: { name: 'Demo' },\n};\n", 'id', 'com.example.demo'))
            .toBe("export default {\n    app: { id: 'com.example.demo', name: 'Demo' },\n};\n");
    });

    test('fills an empty app object, and makes the app section where there is none', () => {
        expect(withAppOption("export default {\n    app: {},\n};\n", 'encryption', false))
            .toBe("export default {\n    app: {\n        encryption: false,\n    },\n};\n");
        expect(withAppOption("import a from 'a';\n\nexport default {\n  general: { name: 'demo' },\n};\n", 'id', "it's"))
            .toBe("import a from 'a';\n\nexport default {\n  app: {\n    id: 'it\\'s',\n  },\n  general: { name: 'demo' },\n};\n");
    });

    test('is not written where it cannot be placed safely, or is set already', () => {
        expect(withAppOption('export default makeConfig({ app: {} });\n', 'id', 'x')).toBeNull();
        expect(withAppOption('const app = {};\nexport default { app };\n', 'id', 'x')).toBeNull();
        expect(withAppOption("export default { app: { id: 'old' } };\n", 'id', 'x')).toBeNull();
    });

    test("lands in the project's config file, which is changed only when it can be", () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-config-writer-'));
        expect(writeAppOption(project, 'id', 'com.example.demo')).toBe(false);
        fs.writeFileSync(path.join(project, 'crossbind.config.mjs'), "export default {\n    app: { name: 'Demo' },\n};\n");
        expect(writeAppOption(project, 'id', 'com.example.demo')).toBe(true);
        expect(fs.readFileSync(path.join(project, 'crossbind.config.mjs'), 'utf8')).toBe("export default {\n    app: { id: 'com.example.demo', name: 'Demo' },\n};\n");
        fs.rmSync(project, { recursive: true, force: true });
    });
});
