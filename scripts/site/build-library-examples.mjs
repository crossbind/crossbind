import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The usage examples on /ports/<family>/ pages. Each one is a file under
// landing/demos/lib-<family>/examples/ that the library module's self-check runs in a browser, so
// the site shows exactly the code that was checked: the function body becomes the usage snippet and
// its parameters become the imports. A WASI example, when a library has one, lives in
// landing/demos/lib-<family>/wasi/ and is checked by scripts/site/check-wasi-examples.mjs.

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMOS_DIR = path.join(REPOSITORY_ROOT, 'landing', 'demos');

// `({ Zstd }, console)` names the classes the example imports; `(m, console)` takes the whole module,
// which the filesystem helpers (m.FS, m.getFileBytes) need.
const SIGNATURE = /^export default async function example\((\{ [A-Za-z_][\w, ]* \}|m), console\) \{$/;

// class name -> the header in src/native that declares it.
export function declaredClasses(nativeDir) {
    const owners = new Map();
    for (const file of fs
        .readdirSync(nativeDir)
        .filter((name) => /\.(h|hpp)$/.test(name))
        .sort()) {
        for (const match of fs.readFileSync(path.join(nativeDir, file), 'utf8').matchAll(/^class\s+([A-Za-z_]\w*)\b/gm)) owners.set(match[1], file);
    }
    return owners;
}

// The example function's parameters and its body as the page shows it, one indentation level out.
function parseExample(source, file) {
    const lines = source.replace(/\r\n/g, '\n').trimEnd().split('\n');
    const start = lines.findIndex((line) => SIGNATURE.test(line));
    if (start === -1)
        throw new Error(`${file}: write the example as \`export default async function example({ Class }, console) {\` or \`(m, console)\`.`);
    if (lines.at(-1) !== '}') throw new Error(`${file}: the example function must close on the last line.`);
    const body = lines.slice(start + 1, -1).map((line) => {
        if (line.trim() === '') return '';
        if (!line.startsWith('    ')) throw new Error(`${file}: the example body must be indented by four spaces.`);
        return line.slice(4);
    });
    return { params: lines[start].match(SIGNATURE)[1], body };
}

const destructured = (params) =>
    params
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

export function usageSnippet(source, native, owners, file = 'example') {
    const { params, body } = parseExample(source, file);
    if (params === 'm')
        return {
            usage: [`import { initNative } from './native/${native}';`, '', 'const m = await initNative();', ...body].join('\n'),
            webOnly: true,
        };
    const byHeader = new Map([[native, []]]);
    for (const name of destructured(params)) {
        const header = owners.get(name);
        if (!header) throw new Error(`${file}: no header in src/native declares class ${name}.`);
        if (!byHeader.has(header)) byHeader.set(header, []);
        byHeader.get(header).push(name);
    }
    const imports = [...byHeader].map(
        ([header, names], index) => `import { ${[...(index === 0 ? ['initNative'] : []), ...names].join(', ')} } from './native/${header}';`,
    );
    return { usage: [...imports, '', 'await initNative();', ...body].join('\n'), webOnly: false };
}

// A "JavaScript only" example calls the library through its own headers, imported from the port's
// meta package the way an app would: `imports` maps each header to the names taken from it.
const PORT_HEADER = /^@crossbind\/port-[a-z0-9-]+\/[\w./-]+\.(h|hpp)$/;
const IDENTIFIER = /^[A-Za-z_]\w*$/;
const IMPORT_WIDTH = 100;

// One line while it fits, else the names packed into indented rows.
function importStatement(names, specifier) {
    const single = `import { ${names.join(', ')} } from '${specifier}';`;
    if (single.length <= IMPORT_WIDTH) return single;
    const rows = names.reduce((packed, name) => {
        const last = packed.at(-1);
        return last && `    ${last}, ${name},`.length <= IMPORT_WIDTH ? [...packed.slice(0, -1), `${last}, ${name}`] : [...packed, name];
    }, []);
    return ['import {', ...rows.map((row) => `    ${row},`), `} from '${specifier}';`].join('\n');
}

const formatValue = (value) => (typeof value === 'string' ? `'${value}'` : String(value));
const formatInit = (init) =>
    init
        ? `{ ${Object.entries(init)
              .map(([key, value]) => `${key}: ${formatValue(value)}`)
              .join(', ')} }`
        : '';

function checkImports(imports, file) {
    const headers = Object.entries(imports ?? {});
    if (!headers.length) throw new Error(`${file}: \`imports\` must name at least one port header.`);
    for (const [specifier, names] of headers) {
        if (!PORT_HEADER.test(specifier))
            throw new Error(`${file}: import from a port header such as '@crossbind/port-zstd/zstd.h', not '${specifier}'.`);
        if (!Array.isArray(names) || names.some((name) => !IDENTIFIER.test(name)))
            throw new Error(`${file}: \`imports['${specifier}']\` must list identifiers.`);
    }
    return headers;
}

export function directSnippet(source, imports, { init = null, file = 'example' } = {}) {
    const headers = checkImports(imports, file);
    const { params, body } = parseExample(source, file);
    const boot = `initNative(${formatInit(init)})`;
    if (params === 'm') {
        const [[first], ...rest] = headers;
        const lines = [`import { initNative } from '${first}';`, ...rest.map(([specifier]) => `import '${specifier}';`)];
        return { usage: [...lines, '', `const m = await ${boot};`, ...body].join('\n'), webOnly: true };
    }
    const used = destructured(params);
    const listed = headers.flatMap(([, names]) => names);
    const unlisted = used.filter((name) => !listed.includes(name));
    if (unlisted.length) throw new Error(`${file}: ${unlisted.join(', ')} is not in \`imports\`.`);
    const unused = listed.filter((name) => !used.includes(name));
    if (unused.length) throw new Error(`${file}: ${unused.join(', ')} is imported but never used.`);
    const first = headers.find(([, names]) => names.length)[0];
    const lines = headers.map(([specifier, names]) =>
        names.length ? importStatement(specifier === first ? ['initNative', ...names] : names, specifier) : `import '${specifier}';`,
    );
    return { usage: [...lines, '', `await ${boot};`, ...body].join('\n'), webOnly: false };
}

// The name an entry takes from the header: `name`, or `name as alias` for a helper that more than
// one header exports (a module cannot export one name twice, and the alias still proves the name).
function reexportedName(entry, file) {
    const [name, as, alias, ...rest] = entry.split(/\s+/);
    const aliased = as === 'as' && IDENTIFIER.test(alias ?? '') && !rest.length;
    if (!IDENTIFIER.test(name) || (as !== undefined && !aliased))
        throw new Error(`${file}: cannot read "${entry}"; write a name or \`name as alias\`.`);
    if (name === 'default') throw new Error(`${file}: a port header has no default export; re-export its names.`);
    return name;
}

// header specifier -> the names src/headers.js re-exports from it. Its build fails on a name the
// header does not export, which is what proves the import lines the page shows.
export function headerExports(file) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    const name = path.relative(REPOSITORY_ROOT, file);
    const exported = new Map();
    for (const [, list, specifier] of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;/g)) {
        const names = list
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((entry) => reexportedName(entry, name));
        exported.set(specifier, new Set([...(exported.get(specifier) ?? []), ...names]));
    }
    return exported;
}

function requireText(module, field, name) {
    if (typeof module[field] !== 'string' || !module[field]) throw new Error(`${name}: export a non-empty \`${field}\`.`);
}

function requireLines(module, field, name, why) {
    if (!Array.isArray(module[field]) || !module[field].length || module[field].some((line) => typeof line !== 'string')) {
        throw new Error(`${name}: \`${field}\` must list ${why}.`);
    }
}

async function readExample(directory, owners, file) {
    const module = await import(pathToFileURL(file).href);
    const name = path.relative(REPOSITORY_ROOT, file);
    for (const field of ['title', 'summary', 'native']) requireText(module, field, name);
    requireLines(module, 'expected', name, 'the lines the example prints; only checked examples reach the site');
    const header = path.join(directory, 'src', 'native', module.native);
    if (!fs.existsSync(header)) throw new Error(`${name}: native header ${module.native} does not exist.`);
    return {
        id: path.basename(file, '.js'),
        title: module.title,
        summary: module.summary,
        native: module.native,
        nativeSource: fs.readFileSync(header, 'utf8').trimEnd(),
        ...usageSnippet(fs.readFileSync(file, 'utf8'), module.native, owners, name),
        expected: module.expected,
    };
}

async function readWasiExample(directory) {
    const file = path.join(directory, 'wasi', 'example.js');
    if (!fs.existsSync(file)) return null;
    const module = await import(pathToFileURL(file).href);
    const name = path.relative(REPOSITORY_ROOT, file);
    for (const field of ['title', 'summary', 'source']) requireText(module, field, name);
    requireLines(module, 'commands', name, 'the commands a reader types after installing');
    requireLines(module, 'expected', name, 'the lines the commands print');
    const read = (relative) => fs.readFileSync(path.join(directory, 'wasi', relative), 'utf8').trimEnd();
    return {
        title: module.title,
        summary: module.summary,
        sourceFile: module.source,
        source: read(module.source),
        config: read('crossbind.config.js'),
        commands: module.commands,
        expected: module.expected,
    };
}

// A JavaScript-only example either runs, with a note on what changes against the C++ version, or
// says why it cannot and has nothing to run.
async function readDirectExample(file) {
    const module = await import(pathToFileURL(file).href);
    const name = path.relative(REPOSITORY_ROOT, file);
    if (module.impossible !== undefined) {
        requireText(module, 'impossible', name);
        if (module.default) throw new Error(`${name}: an impossible example has nothing to run; export either \`impossible\` or the example.`);
        return { impossible: module.impossible };
    }
    requireText(module, 'note', name);
    requireLines(module, 'expected', name, 'the lines the example prints; only checked examples reach the site');
    const init = module.init ?? null;
    if (init !== null && (typeof init !== 'object' || Array.isArray(init)))
        throw new Error(`${name}: \`init\` must be the options object initNative takes.`);
    const { usage, webOnly } = directSnippet(fs.readFileSync(file, 'utf8'), module.imports, { init, file: name });
    return { imports: module.imports, init, note: module.note, expected: module.expected, usage, webOnly };
}

// The page boots the module once, so every example that asks for an init option asks for the same one.
function sharedInit(demo, runnable) {
    const asked = [...new Set(runnable.filter((entry) => entry.init).map((entry) => JSON.stringify(entry.init)))];
    if (asked.length > 1)
        throw new Error(`${demo}: the examples ask for different init options (${asked.join(', ')}); the page boots the module once.`);
    return asked.length ? JSON.parse(asked[0]) : null;
}

// The names the page calls through the module itself, such as the library's version: a dependency's header binds only the
// functions an import names, so src/headers.js imports these too.
function pageCalls(directory) {
    const page = path.join(directory, 'direct', 'index.html');
    if (!fs.existsSync(page)) return [];
    return [...new Set([...fs.readFileSync(page, 'utf8').matchAll(/\bm\.([A-Za-z_]\w*)\(/g)].map(([, name]) => name))];
}

function checkHeaders(directory, demo, runnable) {
    const exported = headerExports(path.join(directory, 'direct', 'src', 'headers.js'));
    const imported = runnable.flatMap((entry) =>
        Object.entries(entry.imports).flatMap(([specifier, names]) => names.map((name) => [specifier, name])),
    );
    const missing = imported.filter(([specifier, name]) => !exported.get(specifier)?.has(name));
    if (missing.length) {
        const [specifier, name] = missing[0];
        throw new Error(`${demo}: ${name} from '${specifier}' is not re-exported by direct/src/headers.js, so the build never proves it.`);
    }
    const called = pageCalls(directory);
    const reexported = new Set([...exported.values()].flatMap((names) => [...names]));
    const unbound = called.filter((name) => !reexported.has(name));
    if (unbound.length)
        throw new Error(
            `${demo}: index.html calls m.${unbound[0]}, which direct/src/headers.js does not re-export, so the build binds no such function.`,
        );
    const unused = [...exported].flatMap(([specifier, names]) =>
        [...names]
            .filter((name) => !called.includes(name) && !imported.some(([s, n]) => s === specifier && n === name))
            .map((name) => [specifier, name]),
    );
    if (unused.length) throw new Error(`${demo}: direct/src/headers.js re-exports ${unused[0][1]} from '${unused[0][0]}' but no example imports it.`);
}

// The self-check proves what the page runs only when it boots the module the same way.
function checkSelfCheckBoot(directory, demo, init) {
    const page = fs.readFileSync(path.join(directory, 'direct', 'index.html'), 'utf8');
    for (const [key, value] of Object.entries(init ?? {})) {
        if (!page.includes(`${key}: ${formatValue(value)}`))
            throw new Error(`${demo}: index.html has to boot with ${key}: ${formatValue(value)}, the way the page loads the module.`);
    }
    if (!init && page.includes('useWorker')) throw new Error(`${demo}: index.html sets useWorker, but no example asks the page to.`);
}

// A JavaScript-only build that needs more than its dependency (a declaration the port cannot
// link, say) shows that configuration on the page, since a visitor copying the examples needs it
// too: crossbind.config.js when it sets more than the usual keys, and any crossbind.overrides.js.
const EXTRA_CONFIG = /\b(export|targetSpecs|extensions|build|functions)\s*:/;
const CONFIG_FILES = [
    { file: 'crossbind.config.js', shown: (code) => EXTRA_CONFIG.test(code) },
    { file: 'crossbind.overrides.js', shown: () => true },
];

const directConfig = (directory) =>
    CONFIG_FILES.map(({ file, shown }) => ({ file, full: path.join(directory, 'direct', file), shown }))
        .filter(({ full }) => fs.existsSync(full))
        .map(({ file, full, shown }) => ({ file, code: fs.readFileSync(full, 'utf8').trimEnd(), shown }))
        .filter(({ code, shown }) => shown(code))
        .map(({ file, code }) => ({ file, code }));

// direct/examples/<id>.js beside every examples/<id>.js, and nothing else.
async function readDirect(directory, examples) {
    const examplesDir = path.join(directory, 'direct', 'examples');
    if (!fs.existsSync(examplesDir)) return null;
    const demo = `${path.basename(directory)}-direct`;
    const ids = examples.map((example) => example.id);
    const files = fs
        .readdirSync(examplesDir)
        .filter((name) => name.endsWith('.js'))
        .map((name) => path.basename(name, '.js'));
    const extra = files.filter((id) => !ids.includes(id));
    if (extra.length) throw new Error(`${demo}: ${extra.join(', ')} has no C++ example to stand beside.`);
    const missing = ids.filter((id) => !files.includes(id));
    if (missing.length)
        throw new Error(`${demo}: no JavaScript-only version of ${missing.join(', ')}; add one, or one that says why it is impossible.`);
    const entries = [];
    for (const id of ids) entries.push([id, await readDirectExample(path.join(examplesDir, `${id}.js`))]);
    const published = ({ impossible, note, expected, usage, webOnly }) => (impossible ? { impossible } : { usage, webOnly, note, expected });
    const byId = new Map(entries.map(([id, entry]) => [id, published(entry)]));
    const runnable = entries.map(([, entry]) => entry).filter((entry) => !entry.impossible);
    // Nothing to run, so no module to build: the page shows the reasons only.
    if (!runnable.length) return { demo: null, init: null, config: [], byId };
    const init = sharedInit(demo, runnable);
    checkHeaders(directory, demo, runnable);
    checkSelfCheckBoot(directory, demo, init);
    return { demo, init, config: directConfig(directory), byId };
}

export async function buildLibraryExamples({ demosDir = DEMOS_DIR } = {}) {
    const libraries = {};
    const modules = fs.existsSync(demosDir)
        ? fs
              .readdirSync(demosDir)
              .filter((name) => name.startsWith('lib-'))
              .sort()
        : [];
    for (const demo of modules) {
        const directory = path.join(demosDir, demo);
        const examplesDir = path.join(directory, 'examples');
        if (!fs.existsSync(examplesDir)) continue;
        const owners = declaredClasses(path.join(directory, 'src', 'native'));
        const files = fs
            .readdirSync(examplesDir)
            .filter((name) => name.endsWith('.js'))
            .sort();
        const examples = [];
        for (const file of files) examples.push(await readExample(directory, owners, path.join(examplesDir, file)));
        const direct = await readDirect(directory, examples);
        libraries[demo.slice('lib-'.length)] = {
            demo,
            examples: examples.map((example) => ({ ...example, direct: direct?.byId.get(example.id) ?? null })),
            wasi: await readWasiExample(directory),
            direct: direct ? { demo: direct.demo, init: direct.init, config: direct.config } : null,
        };
    }
    return libraries;
}

export function renderLibraryExamplesModule(libraries) {
    return `// Generated by scripts/site/prepare-site.mjs before every site build. Do not edit.\nexport default ${JSON.stringify(libraries, null, 4)};\n`;
}
