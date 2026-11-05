import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
    withAppOption, withExtension, writeAppOption, writeExtension,
} from '../src/utils/configWriter.js';

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

    test('is written as JavaScript, as one would write it by hand', () => {
        expect(withAppOption("export default {\n    app: { name: 'Demo' },\n};\n", 'privacy', { fileTimestamp: ['C617.1'], diskSpace: ['E174.1', '85F4.1'] }))
            .toBe("export default {\n    app: { privacy: { fileTimestamp: ['C617.1'], diskSpace: ['E174.1', '85F4.1'] }, name: 'Demo' },\n};\n");
    });

    test('is not written where it cannot be placed safely, or is set already', () => {
        expect(withAppOption('export default makeConfig({ app: {} });\n', 'id', 'x')).toBeNull();
        expect(withAppOption('const app = {};\nexport default { app };\n', 'id', 'x')).toBeNull();
        expect(withAppOption("export default { app: { id: 'old' } };\n", 'id', 'x')).toBeNull();
        // A spread may carry the key, and would win over one written before it.
        expect(withAppOption("export default { app: { ...shared, name: 'Demo' } };\n", 'privacy', {})).toBeNull();
        expect(withAppOption("export default { ...base, general: { name: 'demo' } };\n", 'id', 'x')).toBeNull();
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

const GREETER = 'crossbind-extension-greeter/crossbind.extension.js';

describe("an extension written into crossbind.config.js's extensions", () => {
    test('is imported after the last import and goes first in the list, as its entries are written', () => {
        const source = "import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';\n\nexport default {\n    target: { runtimeEnv: 'app' },\n    extensions: [clipboard()],\n};\n";
        expect(withExtension(source, GREETER, 'greeter')).toEqual({
            source: `import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';\nimport greeter from '${GREETER}';\n\nexport default {\n    target: { runtimeEnv: 'app' },\n    extensions: [greeter(), clipboard()],\n};\n`,
            identifier: 'greeter',
            isListed: false,
        });
        expect(withExtension("import a from 'a';\nexport default {\n    extensions: [\n        a(),\n    ],\n};\n", GREETER, 'greeter').source)
            .toBe(`import a from 'a';\nimport greeter from '${GREETER}';\nexport default {\n    extensions: [\n        greeter(),\n        a(),\n    ],\n};\n`);
        expect(withExtension("import a from 'a';\nexport default { extensions: [] };\n", GREETER, 'greeter').source)
            .toBe(`import a from 'a';\nimport greeter from '${GREETER}';\nexport default { extensions: [greeter()] };\n`);
    });

    test('makes the list where there is none, and the import first in a config that has none', () => {
        expect(withExtension("export default {\n    target: { runtimeEnv: 'app' },\n};\n", GREETER, 'greeter').source)
            .toBe(`import greeter from '${GREETER}';\n\nexport default {\n    extensions: [greeter()],\n    target: { runtimeEnv: 'app' },\n};\n`);
        expect(withExtension("export default { target: { runtimeEnv: 'app' } };\n", GREETER, 'greeter').source)
            .toBe(`import greeter from '${GREETER}';\n\nexport default { extensions: [greeter()], target: { runtimeEnv: 'app' } };\n`);
    });

    test('takes another name where the config has the one it would take', () => {
        const source = "import greeter from './greeter.js';\nexport default { general: { name: greeter.name }, extensions: [] };\n";
        expect(withExtension(source, GREETER, 'greeter')).toMatchObject({ identifier: 'greeterExtension' });
        expect(withExtension("export default { general: { name: process.env.NAME } };\n", GREETER, 'process'))
            .toMatchObject({ identifier: 'processExtension' });
        expect(withExtension("import greeter from './a.js';\nimport greeterExtension from './b.js';\nexport default {};\n", GREETER, 'greeter'))
            .toMatchObject({ identifier: 'greeterExtension2' });
    });

    test('goes after the hashbang and the line comments that open a config, and keeps its line ends', () => {
        expect(withExtension("#!/usr/bin/env node\n// @ts-check\nexport default { target: {} };\n", GREETER, 'greeter').source)
            .toBe(`#!/usr/bin/env node\n// @ts-check\nimport greeter from '${GREETER}';\n\nexport default { extensions: [greeter()], target: {} };\n`);
        expect(withExtension('// @ts-check\n\nexport default { target: {} };\n', GREETER, 'greeter').source)
            .toBe(`// @ts-check\nimport greeter from '${GREETER}';\n\nexport default { extensions: [greeter()], target: {} };\n`);
        expect(withExtension("import a from 'a';\r\nexport default {\r\n    extensions: [\r\n        a(),\r\n    ],\r\n};\r\n", GREETER, 'greeter').source)
            .toBe(`import a from 'a';\r\nimport greeter from '${GREETER}';\r\nexport default {\r\n    extensions: [\r\n        greeter(),\r\n        a(),\r\n    ],\r\n};\r\n`);
    });

    test('lists an extension the config imports under its import, and leaves one it lists as it is', () => {
        const imported = `import greet from '${GREETER}';\nexport default { extensions: [] };\n`;
        expect(withExtension(imported, GREETER, 'greeter')).toEqual({
            source: `import greet from '${GREETER}';\nexport default { extensions: [greet()] };\n`,
            identifier: 'greet',
            isListed: false,
        });
        const listed = `import greet from '${GREETER}';\nexport default { extensions: [greet({ loud: true })] };\n`;
        expect(withExtension(listed, GREETER, 'greeter')).toEqual({ source: listed, identifier: 'greet', isListed: true });
    });

    test('is not written where it cannot be placed safely', () => {
        expect(withExtension('export default makeConfig({ extensions: [] });\n', GREETER, 'greeter')).toBeNull();
        expect(withExtension('const extensions = [];\nexport default { extensions };\n', GREETER, 'greeter')).toBeNull();
        // A spread may carry an extensions list, and would win over one written before it.
        expect(withExtension('export default { ...base };\n', GREETER, 'greeter')).toBeNull();
        expect(withExtension('export default { extensions: [], ...base };\n', GREETER, 'greeter')).toBeNull();
        expect(withExtension('export default { ...base, extensions: [] };\n', GREETER, 'greeter')).toMatchObject({ identifier: 'greeter' });
        expect(withExtension('module.exports = { extensions: [] };\n', GREETER, 'greeter')).toBeNull();
    });

    test("lands in the project's config file, which is changed only when it can be", () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-config-writer-'));
        expect(writeExtension(project, GREETER, 'greeter')).toBeNull();
        const file = path.join(project, 'crossbind.config.js');
        fs.writeFileSync(file, "export default { target: { runtimeEnv: 'app' } };\n");
        expect(writeExtension(project, GREETER, 'greeter')).toEqual({ file, identifier: 'greeter', isListed: false });
        expect(fs.readFileSync(file, 'utf8')).toBe(`import greeter from '${GREETER}';\n\nexport default { extensions: [greeter()], target: { runtimeEnv: 'app' } };\n`);
        expect(writeExtension(project, GREETER, 'greeter')).toEqual({ file, identifier: 'greeter', isListed: true });
        fs.rmSync(project, { recursive: true, force: true });
    });
});
