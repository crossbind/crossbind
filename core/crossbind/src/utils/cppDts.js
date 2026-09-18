import fs from 'node:fs';
import path from 'node:path';
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
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of trimmed) {
        if (ch === '<' || ch === '(') depth += 1;
        if (ch === '>' || ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
    }
    parts.push(current);
    return parts.map((part, i) => {
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

export function parseCppSurface(source, log = console.log) {
    const clean = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/^[ \t]*#[^\n]*$/gm, ' ');

    const classes = [];
    const classNames = new Set();
    const classRe = /\b(class|struct)\s+([A-Za-z_]\w*)\s*(?::[^{]*)?\{/g;
    const found = [];
    let m = classRe.exec(clean);
    while (m) {
        let depth = 1;
        let i = classRe.lastIndex;
        while (i < clean.length && depth > 0) {
            if (clean[i] === '{') depth += 1;
            if (clean[i] === '}') depth -= 1;
            i += 1;
        }
        found.push({ kind: m[1], name: m[2], body: clean.slice(classRe.lastIndex, i - 1) });
        classNames.add(m[2]);
        m = classRe.exec(clean);
    }

    // Value-semantics fields only: these are the types embind's .property can expose
    // without ownership questions (and the worker clone can carry).
    const FIELD_TYPES = new Set(['number', 'boolean', 'string']);

    for (const cls of found) {
        let access = cls.kind === 'struct' ? 'public' : 'private';
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
                const decl = statement.split('=')[0].trim();
                const field = !statement.includes('(') && !/^(static|using|typedef|friend|enum)\b/.test(decl)
                    ? decl.match(/^(.*?)\b([A-Za-z_]\w*)$/s)
                    : null;
                if (field) {
                    const type = tsType(field[1], classNames);
                    // A reference member has no address a pointer to member could name, and a pointer member is memory.
                    if (type !== null && FIELD_TYPES.has(type) && !/[&*]/.test(field[1])) fields.push({ name: field[2], type });
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
        classes.push({ name: cls.name, ctor, methods, fields });
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
