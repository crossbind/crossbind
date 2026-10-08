import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildLibraryExamples, declaredClasses, directSnippet, headerExports, usageSnippet } from '../build-library-examples.mjs';

const owners = new Map([
    ['Zstd', 'zstd_codec.h'],
    ['ZstdDictionary', 'zstd_dictionary.h'],
]);

const example = (signature, body = ['    console.log(1);']) => ['export const title = "t";', '', signature, ...body, '}'].join('\n');

test('named classes become imports from the header that declares each one', () => {
    const source = example('export default async function example({ ZstdDictionary, Zstd }, console) {', [
        '    const a = 1;',
        '',
        '    if (a) {',
        '        console.log(a);',
        '    }',
    ]);
    const { usage, webOnly } = usageSnippet(source, 'zstd_dictionary.h', owners);
    assert.equal(webOnly, false);
    assert.equal(
        usage,
        [
            "import { initNative, ZstdDictionary } from './native/zstd_dictionary.h';",
            "import { Zstd } from './native/zstd_codec.h';",
            '',
            'await initNative();',
            'const a = 1;',
            '',
            'if (a) {',
            '    console.log(a);',
            '}',
        ].join('\n'),
    );
});

test('an example that takes the module gets it from initNative and is marked web-only', () => {
    const { usage, webOnly } = usageSnippet(example('export default async function example(m, console) {'), 'zstd_stream.h', owners);
    assert.equal(webOnly, true);
    assert.equal(usage, ["import { initNative } from './native/zstd_stream.h';", '', 'const m = await initNative();', 'console.log(1);'].join('\n'));
});

test('an example the page cannot show verbatim is refused', () => {
    assert.throws(() => usageSnippet(example('export default function example(m) {'), 'x.h', owners), /write the example as/);
    assert.throws(
        () => usageSnippet(example('export default async function example({ Missing }, console) {'), 'x.h', owners),
        /declares class Missing/,
    );
    assert.throws(
        () => usageSnippet(example('export default async function example(m, console) {', ['  console.log(1);']), 'x.h', owners),
        /four spaces/,
    );
});

test('classes are found where the headers declare them', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'library-examples-'));
    try {
        fs.writeFileSync(path.join(directory, 'a.h'), 'class Alpha {\npublic:\n};\n// class NotThis\n');
        fs.writeFileSync(path.join(directory, 'b.hpp'), 'namespace detail {}\nclass Beta final {};\n');
        assert.deepEqual(
            [...declaredClasses(directory)],
            [
                ['Alpha', 'a.h'],
                ['Beta', 'b.hpp'],
            ],
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('an example without its expected output never reaches the site', async () => {
    const demos = fs.mkdtempSync(path.join(os.tmpdir(), 'library-examples-'));
    try {
        fs.mkdirSync(path.join(demos, 'lib-demo', 'src', 'native'), { recursive: true });
        fs.mkdirSync(path.join(demos, 'lib-demo', 'examples'));
        fs.writeFileSync(path.join(demos, 'lib-demo', 'src', 'native', 'demo.h'), 'class Demo {};\n');
        fs.writeFileSync(
            path.join(demos, 'lib-demo', 'examples', '01-demo.js'),
            [
                "export const title = 'Demo';",
                "export const summary = 'A demo.';",
                "export const native = 'demo.h';",
                'export const expected = null;',
                '',
                'export default async function example({ Demo }, console) {',
                '    console.log(await Demo.version());',
                '}',
            ].join('\n'),
        );
        await assert.rejects(buildLibraryExamples({ demosDir: demos }), /only checked examples reach the site/);
    } finally {
        fs.rmSync(demos, { recursive: true, force: true });
    }
});

test('the zstd module publishes its checked examples and its WASI program', async () => {
    const { zstd } = await buildLibraryExamples();
    assert.equal(zstd.demo, 'lib-zstd');
    assert.deepEqual(
        zstd.examples.map((item) => [item.id, item.webOnly]),
        [
            ['01-compress', false],
            ['02-stream', true],
            ['03-parameters', false],
            ['04-dictionary', false],
        ],
    );
    for (const item of zstd.examples) {
        assert.match(item.nativeSource, /^#pragma once/);
        assert.ok(item.expected.length > 0);
    }
    assert.equal(zstd.wasi.sourceFile, 'src/native/main.cpp');
    assert.match(zstd.wasi.source, /int main\(int argc, char\*\* argv\)/);
});

const directExample = (signature, body = ['    console.log(1);']) => [signature, ...body, '}'].join('\n');

test('a JavaScript-only example imports each name from the port header it is listed under', () => {
    const imports = {
        '@crossbind/port-zstd/zstd.h': ['ZSTD_compress', 'allocBuffer'],
        '@crossbind/port-zstd/zdict.h': ['ZDICT_isError'],
    };
    const { usage, webOnly } = directSnippet(
        directExample('export default async function example({ ZSTD_compress, ZDICT_isError, allocBuffer }, console) {'),
        imports,
    );
    assert.equal(webOnly, false);
    assert.equal(
        usage,
        [
            "import { initNative, ZSTD_compress, allocBuffer } from '@crossbind/port-zstd/zstd.h';",
            "import { ZDICT_isError } from '@crossbind/port-zstd/zdict.h';",
            '',
            'await initNative();',
            'console.log(1);',
        ].join('\n'),
    );
});

test('a long import list is packed into indented lines', () => {
    const names = Array.from({ length: 12 }, (_, i) => `ZSTD_function_number_${i}`);
    const { usage } = directSnippet(directExample(`export default async function example({ ${names.join(', ')} }, console) {`), {
        '@crossbind/port-zstd/zstd.h': names,
    });
    const lines = usage.split('\n');
    assert.equal(lines[0], 'import {');
    assert.ok(lines.slice(1, lines.indexOf("} from '@crossbind/port-zstd/zstd.h';")).every((line) => line.startsWith('    ') && line.length <= 100));
    assert.match(usage, /^ {4}initNative, ZSTD_function_number_0,/m);
});

test('a JavaScript-only example that takes the module imports the other headers for their bindings', () => {
    const { usage, webOnly } = directSnippet(directExample('export default async function example(m, console) {'), {
        '@crossbind/port-tiff/tiffio.h': ['TIFFOpen'],
        '@crossbind/port-tiff/tiff.h': [],
    });
    assert.equal(webOnly, true);
    assert.equal(
        usage,
        [
            "import { initNative } from '@crossbind/port-tiff/tiffio.h';",
            "import '@crossbind/port-tiff/tiff.h';",
            '',
            'const m = await initNative();',
            'console.log(1);',
        ].join('\n'),
    );
});

test('a JavaScript-only example that needs the page thread shows the init option', () => {
    const { usage } = directSnippet(
        directExample('export default async function example({ XML_ParserCreate }, console) {'),
        { '@crossbind/port-expat/expat.h': ['XML_ParserCreate'] },
        { init: { useWorker: false } },
    );
    assert.match(usage, /^await initNative\(\{ useWorker: false \}\);$/m);
});

test('the imports have to name exactly what the example destructures', () => {
    const imports = { '@crossbind/port-zstd/zstd.h': ['ZSTD_compress'] };
    assert.throws(
        () => directSnippet(directExample('export default async function example({ ZSTD_compress, ZSTD_decompress }, console) {'), imports),
        /ZSTD_decompress is not in `imports`/,
    );
    assert.throws(
        () =>
            directSnippet(directExample('export default async function example({ ZSTD_decompress }, console) {'), {
                ...imports,
                '@crossbind/port-zstd/zdict.h': ['ZSTD_decompress'],
            }),
        /ZSTD_compress is imported but never used/,
    );
    assert.throws(
        () => directSnippet(directExample('export default async function example({ A }, console) {'), { 'zstd.h': ['A'] }),
        /@crossbind\/port-/,
    );
});

test('the re-exports of src/headers.js are read per header', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'library-examples-'));
    try {
        const file = path.join(directory, 'headers.js');
        fs.writeFileSync(
            file,
            "// comment\nexport {\n    ZSTD_compress,\n    allocBuffer,\n} from '@crossbind/port-zstd/zstd.h';\nexport { ZDICT_isError } from '@crossbind/port-zstd/zdict.h';\n",
        );
        assert.deepEqual(
            [...headerExports(file)].map(([header, names]) => [header, [...names]]),
            [
                ['@crossbind/port-zstd/zstd.h', ['ZSTD_compress', 'allocBuffer']],
                ['@crossbind/port-zstd/zdict.h', ['ZDICT_isError']],
            ],
        );
        // A helper every header exports is proven per header under an alias, since one module
        // cannot export the same name twice; what counts is the name taken from the header.
        fs.writeFileSync(
            file,
            "export { allocBuffer } from '@crossbind/port-proj/proj.h';\nexport { allocBuffer as geodesicAllocBuffer, geod_init } from '@crossbind/port-proj/geodesic.h';\n",
        );
        assert.deepEqual(
            [...headerExports(file)].map(([header, names]) => [header, [...names]]),
            [
                ['@crossbind/port-proj/proj.h', ['allocBuffer']],
                ['@crossbind/port-proj/geodesic.h', ['allocBuffer', 'geod_init']],
            ],
        );
        fs.writeFileSync(file, "export { default as zstd } from '@crossbind/port-zstd/zstd.h';\n");
        assert.throws(() => headerExports(file), /no default export/);
        fs.writeFileSync(file, "export { ZSTD_compress as } from '@crossbind/port-zstd/zstd.h';\n");
        assert.throws(() => headerExports(file), /cannot read "ZSTD_compress as"/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

// A library with one C++ example and its JavaScript-only counterpart, for the pairing rules.
function writeLibrary(
    demos,
    {
        direct = {},
        headers = "export { Demo_version } from '@crossbind/port-demo/demo.h';\n",
        indexHtml = "initNative({ path: './dist' })",
        config = null,
        overrides = null,
    } = {},
) {
    const library = path.join(demos, 'lib-demo');
    fs.mkdirSync(path.join(library, 'src', 'native'), { recursive: true });
    fs.mkdirSync(path.join(library, 'examples'));
    fs.mkdirSync(path.join(library, 'direct', 'examples'), { recursive: true });
    fs.mkdirSync(path.join(library, 'direct', 'src'));
    fs.writeFileSync(path.join(library, 'src', 'native', 'demo.h'), 'class Demo {};\n');
    for (const id of ['01-version', '02-stream']) {
        fs.writeFileSync(
            path.join(library, 'examples', `${id}.js`),
            [
                `export const title = '${id}';`,
                "export const summary = 'A demo.';",
                "export const native = 'demo.h';",
                "export const expected = ['1'];",
                '',
                'export default async function example({ Demo }, console) {',
                '    console.log(await Demo.version());',
                '}',
            ].join('\n'),
        );
    }
    const files = {
        '01-version': [
            "export const imports = { '@crossbind/port-demo/demo.h': ['Demo_version'] };",
            "export const note = 'Calls the C function.';",
            "export const expected = ['1'];",
            '',
            'export default async function example({ Demo_version }, console) {',
            '    console.log(await Demo_version());',
            '}',
        ].join('\n'),
        '02-stream': "export const impossible = 'The stream struct has no fields in JavaScript.';\n",
        ...direct,
    };
    for (const [id, text] of Object.entries(files)) {
        if (text !== null) fs.writeFileSync(path.join(library, 'direct', 'examples', `${id}.js`), text);
    }
    if (headers !== null) fs.writeFileSync(path.join(library, 'direct', 'src', 'headers.js'), headers);
    if (indexHtml !== null) fs.writeFileSync(path.join(library, 'direct', 'index.html'), `<script type="module">${indexHtml}</script>\n`);
    if (config !== null) fs.writeFileSync(path.join(library, 'direct', 'crossbind.config.js'), config);
    if (overrides !== null) fs.writeFileSync(path.join(library, 'direct', 'crossbind.overrides.js'), overrides);
}

async function withLibrary(options, run) {
    const demos = fs.mkdtempSync(path.join(os.tmpdir(), 'library-examples-'));
    try {
        writeLibrary(demos, options);
        return await run(demos);
    } finally {
        fs.rmSync(demos, { recursive: true, force: true });
    }
}

test('each C++ example carries its JavaScript-only version or the reason there is none', async () => {
    await withLibrary({}, async (demos) => {
        const { demo } = await buildLibraryExamples({ demosDir: demos });
        assert.deepEqual(demo.direct, { demo: 'lib-demo-direct', init: null, config: [] });
        const [version, stream] = demo.examples;
        assert.equal(version.direct.note, 'Calls the C function.');
        assert.deepEqual(version.direct.expected, ['1']);
        assert.match(version.direct.usage, /^import \{ initNative, Demo_version \} from '@crossbind\/port-demo\/demo\.h';$/m);
        assert.deepEqual(stream.direct, { impossible: 'The stream struct has no fields in JavaScript.' });
    });
});

test('JavaScript-only examples pair one to one with the C++ ones', async () => {
    await withLibrary({ direct: { '02-stream': null } }, (demos) =>
        assert.rejects(buildLibraryExamples({ demosDir: demos }), /no JavaScript-only version of 02-stream/),
    );
    await withLibrary({ direct: { '03-extra': "export const impossible = 'x';\n" } }, (demos) =>
        assert.rejects(buildLibraryExamples({ demosDir: demos }), /03-extra has no C\+\+ example/),
    );
});

test('a JavaScript-only example is either runnable with a note or impossible with a reason', async () => {
    const noNote =
        "export const imports = { '@crossbind/port-demo/demo.h': ['Demo_version'] };\nexport const expected = ['1'];\n\nexport default async function example({ Demo_version }, console) {\n    console.log(await Demo_version());\n}\n";
    await withLibrary({ direct: { '01-version': noNote } }, (demos) =>
        assert.rejects(buildLibraryExamples({ demosDir: demos }), /export a non-empty `note`/),
    );
    const both = "export const impossible = 'x';\n\nexport default async function example(m, console) {\n    console.log(1);\n}\n";
    await withLibrary({ direct: { '02-stream': both } }, (demos) => assert.rejects(buildLibraryExamples({ demosDir: demos }), /nothing to run/));
});

test('src/headers.js must re-export exactly what the examples import', async () => {
    await withLibrary({ headers: "export { Demo_version, Demo_extra } from '@crossbind/port-demo/demo.h';\n" }, (demos) =>
        assert.rejects(buildLibraryExamples({ demosDir: demos }), /Demo_extra.*no example imports/),
    );
    await withLibrary({ headers: '' }, (demos) => assert.rejects(buildLibraryExamples({ demosDir: demos }), /Demo_version.*not re-exported/));
});

// A dependency's header binds only the functions the app imports, so the page's own calls are imported here too.
test('src/headers.js re-exports what the page calls through the module as well', async () => {
    const page = "const m = await initNative({ path: './dist' });\nshow(`demo ${await m.Demo_release()}`);";
    const both = "export { Demo_version, Demo_release } from '@crossbind/port-demo/demo.h';\n";
    await withLibrary({ indexHtml: page, headers: both }, (demos) => buildLibraryExamples({ demosDir: demos }));
    await withLibrary({ indexHtml: page }, (demos) => assert.rejects(buildLibraryExamples({ demosDir: demos }), /index\.html calls m\.Demo_release/));
});

test('an init option is shared by the module and booted the same way by its self-check', async () => {
    const needsPageThread =
        "export const imports = { '@crossbind/port-demo/demo.h': ['Demo_version'] };\nexport const note = 'n';\nexport const expected = ['1'];\nexport const init = { useWorker: false };\n\nexport default async function example({ Demo_version }, console) {\n    console.log(await Demo_version());\n}\n";
    await withLibrary({ direct: { '01-version': needsPageThread }, indexHtml: "initNative({ path: './dist', useWorker: false })" }, async (demos) => {
        const { demo } = await buildLibraryExamples({ demosDir: demos });
        assert.deepEqual(demo.direct, { demo: 'lib-demo-direct', init: { useWorker: false }, config: [] });
    });
    await withLibrary({ direct: { '01-version': needsPageThread } }, (demos) =>
        assert.rejects(buildLibraryExamples({ demosDir: demos }), /index\.html has to boot with useWorker: false/),
    );
});

test('a JavaScript-only build that needs more than its dependency publishes its config for the page', async () => {
    const plain =
        "import demoWasm from '@crossbind/port-demo-wasm/crossbind.config.js';\n\nexport default { general: { name: 'demodirect' }, dependencies: [demoWasm], paths: { config: import.meta.url } };\n";
    await withLibrary({ config: plain }, async (demos) => {
        const { demo } = await buildLibraryExamples({ demosDir: demos });
        assert.deepEqual(demo.direct.config, []);
    });
    const workaround =
        "import demoWasm from '@crossbind/port-demo-wasm/crossbind.config.js';\n\n// demo.h declares a function this build leaves out.\nexport default {\n    dependencies: [{ ...demoWasm, export: { ...demoWasm.export, ignoredDeclarations: ['demo_missing'] } }],\n};\n";
    await withLibrary({ config: workaround }, async (demos) => {
        const { demo } = await buildLibraryExamples({ demosDir: demos });
        assert.deepEqual(demo.direct.config, [{ file: 'crossbind.config.js', code: workaround.trimEnd() }]);
    });
});

test('an overrides file the JavaScript-only build needs is published beside its config', async () => {
    const plain = 'export default { dependencies: [demoWasm] };\n';
    const overrides = "// demo.h declares a function the prebuilt library leaves out.\nexport default [{ replace: 'demo' }];\n";
    await withLibrary({ config: plain, overrides }, async (demos) => {
        const { demo } = await buildLibraryExamples({ demosDir: demos });
        assert.deepEqual(demo.direct.config, [{ file: 'crossbind.overrides.js', code: overrides.trimEnd() }]);
    });
});

test('a library where nothing runs from JavaScript alone has reasons and no module to build', async () => {
    const impossible = "export const impossible = 'Every call needs a struct field.';\n";
    await withLibrary({ direct: { '01-version': impossible }, headers: null, indexHtml: null }, async (demos) => {
        const { demo } = await buildLibraryExamples({ demosDir: demos });
        assert.deepEqual(demo.direct, { demo: null, init: null, config: [] });
        assert.deepEqual(
            demo.examples.map((item) => item.direct),
            [{ impossible: 'Every call needs a struct field.' }, { impossible: 'The stream struct has no fields in JavaScript.' }],
        );
    });
});

test('zstd shows three examples from JavaScript only and says why streaming needs C++', async () => {
    const { zstd } = await buildLibraryExamples();
    assert.deepEqual(zstd.direct, { demo: 'lib-zstd-direct', init: null, config: [] });
    assert.deepEqual(
        zstd.examples.map((item) => [item.id, item.direct.impossible ? 'impossible' : 'runs']),
        [
            ['01-compress', 'runs'],
            ['02-stream', 'impossible'],
            ['03-parameters', 'runs'],
            ['04-dictionary', 'runs'],
        ],
    );
    assert.match(zstd.examples[0].direct.usage, /from '@crossbind\/port-zstd\/zstd\.h';/);
});
