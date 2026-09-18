import upath from 'upath';

// Libraries whose headers are not self-contained (spatialite expects sqlite3.h first) list the
// prerequisites in export.headerPrelude of the package that ships the header: its output or project
// tree, or a directory it lists under paths.header (the conformance kit's headers sit in a sibling
// package); the deepest root wins. An object keys the lists by include path, '*' applying to every
// header.
export function findHeaderPrelude(headerFile, configs, headerPath) {
    return findHeaderOption('headerPrelude', headerFile, configs, headerPath);
}

// A library that declares what it never defines (GDAL's VRTAverageFilteredSource) lists those names in
// export.ignoredDeclarations, in the forms headerPrelude takes, so the bindings of the header still link.
export function findIgnoredDeclarations(headerFile, configs, headerPath) {
    return findHeaderOption('ignoredDeclarations', headerFile, configs, headerPath);
}

function findHeaderOption(option, headerFile, configs, headerPath) {
    const file = upath.normalize(headerFile);
    let owner = null;
    let ownerRoot = '';
    for (const config of configs) {
        for (const root of [config?.paths?.output, config?.paths?.project, ...(config?.paths?.header ?? [])]) {
            if (!root) continue;
            const normalized = upath.normalize(root);
            if (file.startsWith(`${normalized}/`) && normalized.length > ownerRoot.length) {
                owner = config;
                ownerRoot = normalized;
            }
        }
    }
    const lists = owner?.export?.[option] ?? [];
    return Array.isArray(lists) ? lists : [...(lists['*'] ?? []), ...(lists[headerPath] ?? [])];
}

export function interfaceIncludes(headerPath, prelude = []) {
    return [...prelude.filter((header) => header !== headerPath), headerPath];
}

// The prelude and the completing includes reach only the compiled wrapper and swigMacros only SWIG's parse: SWIG still
// wraps just the imported header. The ignored declarations follow the macros, so the retry without macros keeps them.
export function buildInterfaceContent({ moduleName, headerPath, prelude = [], completing = [], swigMacros = [], ignored = [] }) {
    const includes = [...new Set([...interfaceIncludes(headerPath, prelude), ...completing])]
        .map((header) => `#include "${header}"`)
        .join('\n');
    const macros = swigMacros.length ? `${swigMacros.join('\n')}\n\n` : '';
    const ignores = ignored.length ? `${ignored.map((name) => `%ignore ${name};`).join('\n')}\n\n` : '';
    const module = moduleName.replace(/\W/g, '_');
    return `#ifndef _${module}_I
#define _${module}_I

%module ${module}

%{
${includes}
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");

${macros}${ignores}%include "${headerPath}"

#endif
`;
}

export function withoutSwigMacros(content) {
    return content.replace(/(%feature\("polymorphic_shared_ptr"\);\n\n)(?:#define [^\n]*\n)+\n/, '$1');
}

// SWIG exits with 1 when it rejects the interface; docker failures and killed processes exit with other codes.
const SWIG_REJECTED_EXIT_CODE = 1;

export function interfaceToRetryWithoutMacros(content, error) {
    const plain = withoutSwigMacros(content);
    return plain !== content && error?.cause?.status === SWIG_REJECTED_EXIT_CODE ? plain : null;
}

const TOKEN = /[A-Za-z_]\w*|\d[\w.]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[\[|\]\]|##|\S/g;
const IDENTIFIER = /^[A-Za-z_]/;
const CONDITIONAL_DIRECTIVES = new Set(['if', 'elif', 'ifdef', 'ifndef', 'elifdef', 'elifndef']);
const NEUTRALIZERS = new Map([
    ['__attribute__', '#define __attribute__(x)'],
    ['__attribute', '#define __attribute(x)'],
    ['__declspec', '#define __declspec(x)'],
    ['__asm__', '#define __asm__(x)'],
    ['__asm', '#define __asm(x)'],
    ['_Pragma', '#define _Pragma(x)'],
    ['__extension__', '#define __extension__'],
    ['__restrict', '#define __restrict'],
    ['__restrict__', '#define __restrict__'],
    ['restrict', '#define restrict'],
    ['__inline', '#define __inline inline'],
    ['__inline__', '#define __inline__ inline'],
    ['_Noreturn', '#define _Noreturn'],
    ['__cdecl', '#define __cdecl'],
    ['__stdcall', '#define __stdcall'],
    ['__fastcall', '#define __fastcall'],
    ['_Nullable', '#define _Nullable'],
    ['_Nonnull', '#define _Nonnull'],
    ['_Null_unspecified', '#define _Null_unspecified'],
    ['_Thread_local', '#define _Thread_local'],
]);
const SYNTAX_TOKENS = new Set([
    'extern', 'static', 'inline', 'const', 'volatile', 'register', 'typedef', 'virtual', 'explicit', 'friend',
    'mutable', 'constexpr', 'noexcept', 'throw', 'override', 'final', 'public', 'protected', 'private', '{', '}', ';', '[[',
    ...NEUTRALIZERS.keys(),
]);

const tokenize = (text) => text.match(TOKEN) ?? [];
const identifiers = (text) => tokenize(text).filter((token) => IDENTIFIER.test(token));
// Lines are spliced before comments go, as in the compiler, and a comment marker inside a literal is text.
const LITERAL_OR_COMMENT = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const stripComments = (text) => text
    .replace(/\\\r?\n/g, ' ')
    .replace(LITERAL_OR_COMMENT, (match) => (match.startsWith('/') ? ' ' : match));

export function parseMacroDump(text) {
    const macros = new Map();
    for (const line of text.split('\n')) {
        const match = line.match(/^#define ([A-Za-z_]\w*)(?:\(([^)]*)\))?(.*)$/);
        if (!match) continue;
        const [, name, paramText, rest] = match;
        const body = rest.trim();
        macros.set(name, {
            params: paramText === undefined ? null : paramText.split(',').map((param) => param.trim()).filter(Boolean),
            body,
            line: `#define ${paramText === undefined ? name : `${name}(${paramText})`}${body ? ` ${body}` : ''}`,
        });
    }
    return macros;
}

function headerReferences(headerText) {
    const declarations = new Set();
    const conditions = new Set();
    const defined = new Set();
    for (const line of stripComments(headerText).split('\n')) {
        const directive = line.match(/^\s*#\s*(\w+)(.*)$/);
        if (!directive) {
            identifiers(line).forEach((name) => declarations.add(name));
        } else if (CONDITIONAL_DIRECTIVES.has(directive[1])) {
            identifiers(directive[2]).forEach((name) => conditions.add(name));
        } else if (directive[1] === 'define') {
            const [, name, body] = directive[2].match(/^\s*([A-Za-z_]\w*)(?:\([^)]*\))?(.*)$/) ?? [];
            if (!name) continue;
            defined.add(name);
            identifiers(body).forEach((token) => declarations.add(token));
        }
    }
    return { declarations, conditions, defined };
}

// SWIG parses only the imported header, so export, linkage and attribute macros from its #includes read as syntax
// errors. Those come from the compiler's macro table, with the flags and versions its #if lines test; type and value
// macros stay undefined so every platform's compiler resolves them.
export function selectSwigMacros({ headerText, macros, predefined }) {
    const memoize = (classify) => {
        const results = new Map();
        const check = (name) => {
            if (!results.has(name)) {
                results.set(name, false);
                results.set(name, classify(macros.get(name), check));
            }
            return results.get(name);
        };
        return check;
    };
    const isSyntax = memoize((macro, check) => {
        if (macro.params) return true;
        const body = tokenize(macro.body);
        return body.length === 0 || body.some((token, index) => SYNTAX_TOKENS.has(token)
            || (macros.has(token) && (macros.get(token).params ? body[index + 1] === '(' : check(token))));
    });
    const isConstant = memoize((macro, check) => {
        const params = new Set(macro.params ?? []);
        return tokenize(macro.body).every((token) => !IDENTIFIER.test(token) || params.has(token) || token === 'defined'
            || (macros.has(token) && check(token)));
    });

    // A macro the header defines itself stays the header's: predefining its include guard would hide the header, and
    // SWIG rejects a redefinition with a different body.
    const { declarations, conditions, defined } = headerReferences(headerText);
    const selected = new Set();
    const forward = (name, accepts) => {
        if (selected.has(name) || defined.has(name) || predefined.has(name) || !macros.has(name) || !accepts(name)) return;
        selected.add(name);
        const params = new Set(macros.get(name).params ?? []);
        identifiers(macros.get(name).body).filter((token) => !params.has(token)).forEach((token) => forward(token, accepts));
    };
    declarations.forEach((name) => forward(name, isSyntax));
    conditions.forEach((name) => forward(name, isConstant));

    const visible = new Set([
        ...tokenize(stripComments(headerText)),
        ...[...selected].flatMap((name) => tokenize(macros.get(name).body)),
    ]);
    const neutralizers = [...NEUTRALIZERS]
        .filter(([token]) => visible.has(token) && !selected.has(token) && !defined.has(token))
        .map(([, line]) => line);
    return [...neutralizers, ...[...selected].sort().map((name) => macros.get(name).line)];
}

const SCOPE_TOKEN = /[A-Za-z_]\w*|::|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S/g;
const CLASS_KEYWORDS = new Set(['class', 'struct', 'union']);
const ATTRIBUTE_CALLS = new Set(['__attribute__', '__attribute', '__declspec', 'alignas']);
const TYPE_QUALIFIERS = new Set(['const', 'volatile', 'class', 'struct', 'union', 'enum', 'typename']);
const BLOCK = { kind: 'block', names: [] };
// An export or finality macro can follow the class name, as in GDAL's `class CPL_DLL MEMDataset CPL_NON_FINAL : ...`.
const isTrailingMacro = (group) => group.length === 1 && (group[0] === 'final' || /^[A-Z][A-Z\d]*_[A-Z\d_]*$/.test(group[0]));

const BRANCH_MARKERS = new Map([
    ['if', '#if'], ['ifdef', '#if'], ['ifndef', '#if'],
    ['elif', '#else'], ['elifdef', '#else'], ['elifndef', '#else'], ['else', '#else'],
    ['endif', '#endif'],
]);

const codeTokens = (text) => stripComments(text).split('\n').flatMap((line) => {
    const directive = line.match(/^\s*#\s*(\w*)/);
    if (!directive) return line.match(SCOPE_TOKEN) ?? [];
    return BRANCH_MARKERS.has(directive[1]) ? [BRANCH_MARKERS.get(directive[1])] : [];
});

function closingIndex(tokens, index) {
    const [open, close] = { '[': ['[', ']'], '{': ['{', '}'] }[tokens[index]] ?? ['(', ')'];
    let depth = 0;
    for (let at = index; at < tokens.length; at += 1) {
        if (tokens[at] === open) depth += 1;
        else if (tokens[at] === close && (depth -= 1) === 0) return at;
    }
    return tokens.length;
}

// The name segments a class head defines, or null for a specialization, an enum or a function returning an elaborated type.
function classHeadName(head) {
    let depth = 0;
    let keyword = -1;
    for (let index = 0; index < head.length && keyword < 0; index += 1) {
        if (head[index] === '<') depth += 1;
        else if (head[index] === '>') depth -= 1;
        else if (depth === 0 && CLASS_KEYWORDS.has(head[index]) && head[index - 1] !== 'enum') keyword = index;
    }
    if (keyword < 0) return null;
    const groups = [];
    for (let index = keyword + 1; index < head.length && head[index] !== ':'; index += 1) {
        const token = head[index];
        if (token === '[' || ATTRIBUTE_CALLS.has(token)) {
            index = closingIndex(head, token === '[' ? index : index + 1);
        } else if (token !== '::') {
            if (!IDENTIFIER.test(token)) return null;
            if (head[index - 1] === '::' && groups.length) groups.at(-1).push(token);
            else groups.push([token]);
        }
    }
    while (groups.length > 1 && isTrailingMacro(groups.at(-1))) groups.pop();
    return groups.at(-1) ?? null;
}

// The name segments an enum head defines (`enum class Location : char`), or null for an anonymous enum.
function enumHeadName(head) {
    const keyword = head.indexOf('enum');
    if (keyword < 0) return null;
    const segments = [];
    for (let index = keyword + 1; index < head.length && head[index] !== ':'; index += 1) {
        const token = head[index];
        if (token === 'class' || token === 'struct' || token === '::') continue;
        if (!IDENTIFIER.test(token) || (segments.length && head[index - 1] !== '::')) return null;
        segments.push(token);
    }
    return segments.length ? segments : null;
}

// The names a typedef gives the type whose body opens at openIndex: `} GDALRPCInfoV2, *GDALRPCInfoPtr;` names only
// GDALRPCInfoV2, since a pointer typedef names no type.
function typedefNames(tokens, openIndex) {
    const names = [];
    for (let index = closingIndex(tokens, openIndex) + 1; index < tokens.length && tokens[index] !== ';'; index += 1) {
        if (IDENTIFIER.test(tokens[index]) && tokens[index - 1] !== '*' && tokens[index - 1] !== '&') names.push(tokens[index]);
    }
    return names;
}

// The tokens since the previous ;, { or } tell what a { opens: namespaces and classes qualify the names inside, extern "C"
// is transparent, and anything else (a function body, an enum, an initializer) is a block.
function openedScope(head) {
    if (head.at(-2) === 'extern' && head.at(-1).startsWith('"')) return { kind: 'extern', names: [] };
    const namespace = head.lastIndexOf('namespace');
    if (namespace >= 0) {
        const names = head.slice(namespace + 1).filter((token) => token !== '::' && token !== 'inline');
        return names.every((name) => IDENTIFIER.test(name)) ? { kind: 'namespace', names } : BLOCK;
    }
    const names = classHeadName(head);
    return names ? { kind: 'class', names } : BLOCK;
}

// Each #else or #elif branch restarts from the scopes open at its #if: branches that each open a scope closed after
// #endif (GEOS's LineIntersector.h) would otherwise leave one open for the rest of the file.
function walkScopes(text, visit) {
    const tokens = codeTokens(text);
    const branches = [];
    let scopes = [];
    let head = [];
    tokens.forEach((token, index) => {
        if (token === '#if') {
            branches.push({ scopes: [...scopes], head: [...head] });
        } else if (token === '#else') {
            if (branches.length) [scopes, head] = [[...branches.at(-1).scopes], [...branches.at(-1).head]];
        } else if (token === '#endif') {
            branches.pop();
        } else {
            const opening = token === '{' ? head : null;
            if (token === '{') scopes.push(openedScope(head));
            if (token === '}') scopes.pop();
            if (token === '{' || token === '}' || token === ';') head = [];
            else head.push(token);
            visit(token, index, tokens, scopes, opening);
        }
    });
}

// Classes, structs and enums by qualified name, including the names C typedefs give them, each mapped to the first header
// defining it. Preprocessor branches are all read.
export function indexTypeDefinitions(files) {
    const definitions = new Map();
    for (const { path, text } of files) {
        const record = (segments) => {
            const name = segments.join('::');
            if (!definitions.has(name)) definitions.set(name, path);
        };
        walkScopes(text, (token, index, tokens, scopes, opening) => {
            const outer = scopes.slice(0, -1);
            if (token !== '{' || outer.some((scope) => scope.kind === 'block')) return;
            const enclosing = outer.flatMap((scope) => scope.names);
            const opened = scopes.at(-1);
            if (opened.kind === 'class') record([...enclosing, ...opened.names]);
            const enumName = enumHeadName(opening);
            if (enumName) record([...enclosing, ...enumName]);
            const isTypeBody = opened.kind === 'class' || opening.some((head) => head === 'enum' || CLASS_KEYWORDS.has(head));
            if (opening.includes('typedef') && isTypeBody) typedefNames(tokens, index).forEach((name) => record([...enclosing, name]));
        });
    }
    return definitions;
}

function heldClassName(tokens, start) {
    const parts = [];
    let isGlobal = false;
    for (let index = start; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '::') {
            isGlobal ||= parts.length === 0;
        } else if (!TYPE_QUALIFIERS.has(token)) {
            if (!IDENTIFIER.test(token) || (parts.length && tokens[index - 1] !== '::')) break;
            parts.push(token);
        }
    }
    return parts.length ? { name: parts.join('::'), isGlobal } : null;
}

// As in C++ lookup, the innermost declaration of a name wins, and an alias names another type.
function resolveType({ name, isGlobal }, enclosing, definitions, aliases, visited = new Set()) {
    const candidates = isGlobal ? [name]
        : [...enclosing.map((_, depth) => [...enclosing.slice(0, enclosing.length - depth), name].join('::')), name];
    for (const candidate of candidates) {
        if (definitions.has(candidate)) return candidate;
        const alias = aliases.get(candidate);
        if (alias) {
            return visited.has(candidate) ? null
                : resolveType(alias.target, alias.enclosing, definitions, aliases, new Set([...visited, candidate]));
        }
    }
    return null;
}

// The other headers defining the types `pick` names in a header, looked up through its enclosing namespaces and classes
// and its alias and using declarations.
function definingHeaders({ headerText, headerPath, definitions }, pick) {
    const headers = new Set();
    const aliases = new Map();
    walkScopes(headerText, (token, index, tokens, scopes) => {
        const enclosing = () => scopes.flatMap((scope) => scope.names);
        if (token === 'using' && tokens[index + 1] !== 'namespace') {
            const isAlias = tokens[index + 2] === '=';
            const target = heldClassName(tokens, index + (isAlias ? 3 : 1));
            const name = isAlias ? tokens[index + 1] : target?.name.split('::').at(-1);
            if (target) aliases.set([...enclosing(), name].join('::'), { target, enclosing: enclosing() });
            return;
        }
        const picked = pick(token, index, tokens, scopes);
        const found = picked && resolveType(picked, enclosing(), definitions, aliases);
        if (found && definitions.get(found) !== headerPath) headers.add(definitions.get(found));
    });
    return [...headers];
}

// The bridge destroys what a std::unique_ptr holds, so that class must be complete there even when the header only
// declares it (GEOS's GeometryNoder holds a Noder).
export function completingIncludes(context) {
    return definingHeaders(context, (token, index, tokens) => {
        const isStd = tokens[index - 1] !== '::' || tokens[index - 2] === 'std';
        return token === 'unique_ptr' && tokens[index + 1] === '<' && isStd ? heldClassName(tokens, index + 2) : null;
    });
}

// The headers defining the classes and enums a header's declarations use outside function bodies: embind registers each
// type once, in the bridge of the header defining it (GDAL's CPLErr lives in cpl_error.h).
export function referencedTypeHeaders(context) {
    return definingHeaders(context, (token, index, tokens, scopes) => {
        if (!IDENTIFIER.test(token) || tokens[index - 1] === '::' || scopes.some((scope) => scope.kind === 'block')) return null;
        return heldClassName(tokens, index);
    });
}
