import { ALL_NAMES } from './headerImports.js';

// SWIG's own parse of a header (swig -xml), read for the classes a bridge has to register. embind registers each class
// once, in the bridge of the header defining it, and a binding naming a class no bridge registers fails only when it is
// called. So a header binds the classes its imported names reach: through their signatures, the bases of those classes
// and the signatures of their public members, in this header and in the headers defining them.

// SWIG leaves `>` unescaped inside attribute values (std::vector&lt;(T)>), so a tag ends only outside a quoted value.
const TAG = /<(\/?)([A-Za-z_][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;
const NAME = /[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*/g;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
// SWIG's type strings spell pointers, references, qualifiers, functions and arrays as p. r. z. q(...). f(...). a(...).
const NOT_TYPES = new Set([
    'p', 'r', 'z', 'q', 'f', 'a', 'const', 'volatile', 'struct', 'class', 'union', 'enum', 'typename',
    'unsigned', 'signed', 'char', 'short', 'int', 'long', 'float', 'double', 'void', 'bool', 'wchar_t', 'size_t',
]);
const EMPTY_TREE = { types: new Map(), values: new Map(), enumerators: new Map() };

const decode = (text) => text.replace(/&(lt|gt|amp|quot|apos);/g, (entity, name) => ENTITIES[name]);

function parse(xml) {
    const root = { tag: 'root', attributes: {}, children: [] };
    const open = [root];
    for (const [, closing, tag, rest, selfClosing] of xml.matchAll(TAG)) {
        if (closing) {
            open.pop();
            continue;
        }
        const attributes = Object.fromEntries([...rest.matchAll(ATTRIBUTE)].map(([, key, value]) => [key, decode(value)]));
        const node = { tag, attributes, children: [] };
        open.at(-1).children.push(node);
        if (!selfClosing) open.push(node);
    }
    return root;
}

// A node's own attributes are the <attribute> elements of its first <attributelist>.
const listOf = (node) => node.children.find((child) => child.tag === 'attributelist')?.children ?? [];
const attributesOf = (node) => Object.fromEntries(listOf(node).filter((child) => child.tag === 'attribute')
    .map((child) => [child.attributes.name, child.attributes.value]));
const basesOf = (node) => listOf(node).filter((child) => child.tag === 'baselist')
    .flatMap((list) => list.children.filter((child) => child.tag === 'base').map((base) => base.attributes.name));
const parametersOf = (node) => listOf(node).filter((child) => child.tag === 'parmlist')
    .flatMap((list) => list.children.filter((child) => child.tag === 'parm').map((parm) => attributesOf(parm).type ?? ''));

// What a header declares: its classes, enums and typedefs by qualified name, each with the type strings it uses, its free
// functions and variables by name, and the enum of each enumerator. SWIG binds no nested class and no member a class
// keeps private, so neither reaches anything.
export function readSwigTree(xml) {
    const types = new Map();
    const values = new Map();
    const enumerators = new Map();
    // C names a struct and its typedef alike (`typedef struct PJ_INFO PJ_INFO;` ahead of `struct PJ_INFO {...}`), and the
    // name stands for the struct.
    const declare = (name, entry) => {
        if (!types.has(name) || (types.get(name).kind === 'typedef' && entry.kind !== 'typedef')) types.set(name, entry);
    };
    const visit = (node, namespace, owner) => {
        // %$isclass leaves class templates alone, so the selection does too.
        if (node.tag === 'template') return;
        const own = node.tag === 'root' ? {} : attributesOf(node);
        const isPublic = own.access !== 'private' && own.access !== 'protected';
        // SWIG spells a class or enum by its full name; a typedef inside a namespace or class may be spelled without it.
        const qualified = (name) => (name.includes('::') || !namespace.length ? name : [...namespace, name].join('::'));
        if (node.tag === 'namespace') {
            node.children.forEach((child) => visit(child, own.name ? [...namespace, own.name] : namespace, null));
        } else if (node.tag === 'class') {
            if (!own.name || !isPublic || own.nested === '1') return;
            const name = qualified(own.name);
            // The name SWIG binds it under: a C struct's typedef name (X509V3_CONF_METHOD for X509V3_CONF_METHOD_st).
            const bound = own.sym_name ?? own['sym:name'] ?? own.tdname ?? name.split('::').at(-1);
            const entry = { kind: 'class', scope: name.split('::'), bases: basesOf(node), uses: [], bound };
            declare(name, entry);
            node.children.forEach((child) => visit(child, namespace, entry));
        } else if (node.tag === 'enum') {
            if (!own.name || !isPublic) return;
            const name = owner && !own.name.includes('::') ? [...owner.scope, own.name].join('::') : qualified(own.name);
            declare(name, { kind: 'enum', scope: name.split('::'), bases: [], uses: [] });
            node.children.filter((child) => child.tag === 'enumitem').forEach((item) => {
                const enumerator = attributesOf(item).name;
                if (enumerator && !enumerators.has(enumerator)) enumerators.set(enumerator, name);
            });
        } else if (node.tag === 'cdecl') {
            if (!own.name || !isPublic || own.storage === 'friend') return;
            const uses = [own.type ?? '', own.decl ?? '', ...parametersOf(node)];
            if (own.storage === 'typedef') {
                const name = owner ? [...owner.scope, own.name].join('::') : qualified(own.name);
                declare(name, { kind: 'typedef', scope: name.split('::'), bases: [], uses });
            } else if (owner) {
                owner.uses.push(...uses);
            } else {
                // An import of an overloaded name binds every overload.
                values.set(own.name, [...(values.get(own.name) ?? []), ...uses]);
            }
        } else if (node.tag === 'constructor') {
            if (owner && isPublic) owner.uses.push(own.decl ?? '', ...parametersOf(node));
        } else {
            node.children.forEach((child) => visit(child, namespace, owner));
        }
    };
    visit(parse(xml), [], null);
    return { types, values, enumerators };
}

// The classes and enums `names` reach from `header`, by qualified name, each with its kind and the header defining it.
// `treeOf` reads a header's parse; a name no header read so far declares is looked up through `definingHeader`, whose
// header is read in turn. ALL_NAMES starts from everything the header declares, as a header bound whole does.
export function typeClosure(header, names, { treeOf, definingHeader }) {
    const trees = new Map();
    const read = (file) => {
        if (!trees.has(file)) trees.set(file, treeOf(file) ?? EMPTY_TREE);
        return trees.get(file);
    };
    const root = read(header);
    const lookedUp = new Set();
    const inTrees = (candidates, wanted) => {
        for (const candidate of candidates) {
            for (const [file, tree] of trees) {
                const entry = tree.types.get(candidate);
                if (entry && wanted(entry)) return { name: candidate, file, entry };
            }
        }
        return null;
    };
    const isClassOrEnum = (entry) => entry.kind !== 'typedef';
    // A class or enum wins over a typedef of the same name, even one another header declares first (a forward header's
    // `typedef struct Foo Foo;`), so a header that may define the name is read before a typedef stands for it.
    const find = (candidates) => {
        const found = inTrees(candidates, isClassOrEnum);
        if (found) return found;
        for (const candidate of candidates) {
            if (lookedUp.has(candidate)) continue;
            lookedUp.add(candidate);
            const file = definingHeader(candidate);
            if (file && !trees.has(file)) read(file);
        }
        return inTrees(candidates, isClassOrEnum) ?? inTrees(candidates, () => true);
    };
    const queue = [];
    const reach = (text, scope) => {
        for (const [name] of text.matchAll(NAME)) {
            if (!NOT_TYPES.has(name)) queue.push({ name, scope });
        }
    };
    const start = names === ALL_NAMES ? [...root.values.keys(), ...root.types.keys()] : names;
    for (const name of start) {
        if (root.values.has(name)) root.values.get(name).forEach((use) => reach(use, []));
        else queue.push({ name: root.enumerators.get(name) ?? name, scope: [] });
    }
    const reached = new Map();
    const visited = new Set();
    while (queue.length) {
        const { name, scope } = queue.pop();
        // As in C++ lookup, a name used inside a class or namespace is tried there first.
        const candidates = [...scope.map((_, depth) => [...scope.slice(0, scope.length - depth), name].join('::')), name];
        const found = find(candidates);
        if (!found || visited.has(found.name)) continue;
        visited.add(found.name);
        const { entry } = found;
        if (entry.kind === 'class') reached.set(found.name, { kind: entry.kind, header: found.file, bound: entry.bound });
        else if (entry.kind === 'enum') reached.set(found.name, { kind: entry.kind, header: found.file });
        const enclosing = entry.scope.slice(0, -1);
        // SWIG binds an enum declared in a class only with that class.
        if (entry.kind === 'enum' && enclosing.length) queue.push({ name: enclosing.join('::'), scope: [] });
        entry.bases.forEach((base) => queue.push({ name: base, scope: enclosing }));
        entry.uses.forEach((use) => reach(use, entry.kind === 'class' ? entry.scope : enclosing));
    }
    return reached;
}
