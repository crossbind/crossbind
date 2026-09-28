import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './swigInterface.js';
import writeIfChanged from './writeIfChanged.js';

// Best-effort .d.ts for `.h` imports, the C++ analog of the Rust emitDts: parse the
// binding-rules surface (classes, public methods, primitives/string/shared_ptr), skip
// anything else WITH a log line, and fall back to `any` for exported symbols the parser
// did not understand - the export list itself always comes from the bridge (exports.json).

const NUMBER_TYPES = new Set([
    'int', 'long', 'short', 'float', 'double', 'size_t', 'unsigned',
    'unsigned char', 'signed char',
    'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'long long', 'unsigned int', 'unsigned long', 'unsigned short', 'unsigned long long',
]);

function tsType(raw, classNames, { isReturn = false } = {}) {
    // A `const char *` crosses as a JS string, null when C++ returns NULL; other pointers stay native memory.
    if (/^\s*(?:const\s+char|char\s+const)\s*\*\s*$/.test(raw)) return isReturn ? 'string | null' : 'string';
    let t = raw.trim().replace(/\bconst\b/g, '').replace(/&/g, '').trim().replace(/\s+/g, ' ');
    if (t.includes('*')) return null;
    const vector = t.match(/^std::vector<([\s\S]+)>$/);
    if (vector) {
        const inner = tsType(vector[1], classNames);
        return inner === null || inner === 'void' ? null : `CppVector<${inner}>`;
    }
    const shared = t.match(/^std::shared_ptr<\s*(\w+)\s*>$/);
    if (shared) {
        if (!classNames.has(shared[1])) return null;
        // Embind shared_ptr returns can resolve to null; parameters take the plain object.
        return isReturn ? `${shared[1]} | null` : shared[1];
    }
    if (t === 'void') return 'void';
    if (t === 'bool') return 'boolean';
    if (NUMBER_TYPES.has(t)) return 'number';
    if (t === 'std::string') return 'string';
    if (classNames.has(t)) return t;
    return null;
}

function parseArgs(rawArgs, classNames) {
    const trimmed = rawArgs.trim();
    if (trimmed === '' || trimmed === 'void') return [];
    return splitTopLevel(trimmed).map((part, i) => {
        const noDefault = part.split('=')[0].trim();
        // Declaration-style unnamed parameter: the whole token is a type.
        const unnamed = tsType(noDefault, classNames);
        if (unnamed !== null && unnamed !== 'void') return { name: `arg${i}`, type: unnamed };
        const m = noDefault.match(/^(.*?)([A-Za-z_]\w*)$/s);
        if (!m) return null;
        const type = tsType(m[1], classNames);
        if (type === null || type === 'void') return null;
        return { name: m[2] || `arg${i}`, type };
    });
}

// Statements are collected at brace depth 0 of the class body; inline bodies and
// member-initialiser lists after the argument list are skipped.
function bodyStatements(body) {
    const statements = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '{') { depth += 1; continue; }
        if (ch === '}') { depth -= 1; if (depth === 0) { statements.push(current); current = ''; } continue; }
        if (depth > 0) continue;
        if (ch === ';') { statements.push(current); current = ''; continue; }
        current += ch;
    }
    statements.push(current);
    return statements.map((s) => s.trim()).filter(Boolean);
}

// Splits at commas outside <>, (), [] and {}.
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if ('<([{'.includes(ch)) depth += 1;
        if ('>)]}'.includes(ch)) depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
    }
    return [...parts, current];
}

// Value-semantics fields only: these are the types embind's .property can expose
// without ownership questions (and the worker clone can carry).
const FIELD_TYPES = new Set(['number', 'boolean', 'string']);

// `int x, *p, y = 2;` declares the int fields x and y and the pointer p. The types cover the value fields: pointers,
// arrays, bit-fields and references are left out.
const FIRST_DECLARATOR = /^([\s\S]*?)([*&\s]*)\b([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*|:\s*\w+)$/;
const NEXT_DECLARATOR = /^([*&\s]*)([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*|:\s*\w+)$/;

function valueField(typeText, classNames) {
    const type = tsType(typeText.replace(/\b(?:const|volatile)\b/g, '').replace(/\s+/g, ' ').trim(), classNames);
    return FIELD_TYPES.has(type) ? { type } : null;
}

function declaredFields(statement, classNames) {
    const [first, ...rest] = splitTopLevel(statement).map((part) => part.split('=')[0].trim());
    const head = first.match(FIRST_DECLARATOR);
    if (!head || !head[1].trim()) return [];
    const value = valueField(head[1], classNames);
    const declarators = [head.slice(2), ...rest.map((part) => part.match(NEXT_DECLARATOR)?.slice(1) ?? null)];
    return declarators.flatMap((declarator) => {
        if (!value || !declarator || declarator[2] || /[*&]/.test(declarator[0])) return [];
        return [{ name: declarator[1], ...value }];
    });
}

// `struct Name {`, `class Name : Base {` and `typedef struct [Tag] { ... } Alias, *Pointer;`, unions too.
// A class takes its tag, or its first typedef name when it has none, and keeps its other typedef names:
// SWIG registers a typedef'd struct under the typedef name.
const CLASS_HEAD = /\b(typedef\s+)?(class|struct|union)\b\s*([A-Za-z_]\w*)?\s*(?::[^{;]*)?\{/g;

function closingBrace(text, from) {
    let depth = 1;
    let i = from;
    while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        if (text[i] === '}') depth -= 1;
        i += 1;
    }
    return i;
}

function typedefNamesAfter(text, from) {
    const tail = text.slice(from).match(/^([^;{}]*);/);
    return tail ? tail[1].split(',').map((part) => part.trim()).filter((part) => /^[A-Za-z_]\w*$/.test(part)) : [];
}

export function parseCppSurface(source, log = console.log) {
    const clean = stripComments(source).replace(/^[ \t]*#[^\n]*$/gm, ' ');

    const classes = [];
    const classNames = new Set();
    const found = [];
    for (const m of clean.matchAll(CLASS_HEAD)) {
        const [head, typedefKeyword, kind, tag] = m;
        const bodyStart = m.index + head.length;
        const end = closingBrace(clean, bodyStart);
        const names = typedefKeyword ? typedefNamesAfter(clean, end) : [];
        const name = tag ?? names[0];
        if (!name) continue;
        found.push({ kind, name, aliases: names.filter((alias) => alias !== name), body: clean.slice(bodyStart, end - 1) });
        classNames.add(name);
        names.forEach((alias) => classNames.add(alias));
    }

    for (const cls of found) {
        let access = cls.kind === 'class' ? 'private' : 'public';
        let ctor = null;
        const methods = [];
        const fields = [];
        for (let statement of bodyStatements(cls.body)) {
            const sections = statement.match(/\b(public|private|protected)\s*:\s*([\s\S]*)$/);
            if (sections) { access = sections[1]; statement = sections[2].trim(); }
            if (!statement || access !== 'public') continue;
            statement = statement.replace(/\)\s*:\s*[\s\S]*$/, ')').replace(/\)\s*const$/, ')').trim();

            const sig = statement.match(/^(static\s+)?(?:explicit\s+)?([\w:<>,\s*&]*?)\s*\b([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/);
            if (!sig) {
                if (!statement.includes('(') && !/^(static|using|typedef|friend|enum)\b/.test(statement)) {
                    fields.push(...declaredFields(statement, classNames));
                }
                continue;
            }
            const [, staticKw, retRaw, name, argsRaw] = sig;
            const args = parseArgs(argsRaw, classNames);
            if (args.includes(null)) { log(`crossbind: dts: skipped ${cls.name}::${name} (unsupported parameter type)`); continue; }
            if (name === cls.name && retRaw.trim() === '') { ctor = { args }; continue; }
            if (name.startsWith('~')) continue;
            const ret = tsType(retRaw, classNames, { isReturn: true });
            if (ret === null) { log(`crossbind: dts: skipped ${cls.name}::${name} (unsupported return type '${retRaw.trim()}')`); continue; }
            methods.push({ name, isStatic: Boolean(staticKw), args, ret });
        }
        classes.push({ name: cls.name, aliases: cls.aliases, ctor, methods, fields });
    }
    return { classes };
}

export function emitCppDts(model, exportNames, mode = 'sync') {
    const wrap = (t) => (mode === 'promise' ? `Promise<${t}>` : t);
    const out = ['// Generated by crossbind - do not edit. Values are usable after init().', ''];
    const usesVector = model.classes.some((cls) => (cls.ctor?.args ?? []).concat(cls.methods.flatMap((m) => [...m.args, { type: m.ret }]))
        .some((a) => a.type?.includes('CppVector<')));
    if (usesVector) {
        out.push('/** An embind std::vector proxy. Convert with Module.toArray / Module.toVector. */');
        out.push('export interface CppVector<T> {');
        out.push(`    size(): ${wrap('number')};`);
        out.push(`    get(index: number): ${wrap('T')};`);
        out.push(`    push_back(value: T): ${wrap('void')};`);
        out.push(`    delete(): ${wrap('void')};`);
        out.push('}');
    }
    const emitted = new Set();
    for (const cls of model.classes) {
        if (!exportNames.includes(cls.name)) continue;
        emitted.add(cls.name);
        out.push(`export declare class ${cls.name} {`);
        if (cls.ctor) out.push(`    constructor(${cls.ctor.args.map((a) => `${a.name}: ${a.type}`).join(', ')});`);
        else out.push('    private constructor();');
        for (const field of cls.fields ?? []) {
            out.push(`    ${field.name}: ${field.type};`);
        }
        for (const method of cls.methods) {
            out.push(`    ${method.isStatic ? 'static ' : ''}${method.name}(${method.args.map((a) => `${a.name}: ${a.type}`).join(', ')}): ${wrap(method.ret)};`);
        }
        out.push('}');
    }
    for (const name of exportNames) {
        if (!emitted.has(name)) out.push(`export declare const ${name}: any;`);
    }
    out.push('export declare let AllSymbols: Record<string, unknown>;');
    out.push('export declare function initNative(config?: Record<string, unknown>): Promise<unknown>;');
    out.push('');
    return out.join('\n');
}

// Mirror the declaration under <cache>/types/<project-relative>.d.ts - never next to the
// user's header. Package headers are skipped: their types ship with the package itself.
export function writeHeaderDts({ headerFile, exportsFile, projectPath, cacheDir, dtsMode = 'sync', log = () => {} }) {
    if (!fs.existsSync(exportsFile)) return;
    const relative = path.relative(projectPath, headerFile);
    if (relative.startsWith('..')) return;
    let exportNames;
    try {
        exportNames = JSON.parse(fs.readFileSync(exportsFile, 'utf8'));
    } catch (e) {
        log(`crossbind: dts: unreadable exports file ${exportsFile} (${e.message})`);
        return;
    }
    if (!Array.isArray(exportNames)) return;
    const model = headerFile.endsWith('.i') ? { classes: [] } : parseCppSurface(fs.readFileSync(headerFile, 'utf8'), log);
    writeIfChanged(`${cacheDir}/types/${relative}.d.ts`, emitCppDts(model, exportNames, dtsMode));
}
