// SWIG's -xml output in miniature, for the bindings plan's tests: a node's attributes and its base and parameter lists sit
// in its attributelist, the declarations it holds after it. SWIG leaves `>` unescaped inside attribute values, and so
// does this.
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function node(tag, attributes, children = [], { bases = [], parameters = [] } = {}) {
    const list = [
        ...Object.entries(attributes).map(([name, value]) => `<attribute name="${name}" value="${escape(value)}" />`),
        ...(bases.length ? [`<baselist>${bases.map((base) => `<base name="${base}" />`).join('')}</baselist>`] : []),
        ...(parameters.length
            ? [`<parmlist>${parameters.map((type) => `<parm><attributelist><attribute name="type" value="${escape(type)}" /></attributelist></parm>`).join('')}</parmlist>`]
            : []),
    ];
    return `<${tag}>\n<attributelist>${list.join('')}</attributelist>\n${children.join('\n')}\n</${tag}>`;
}

export const top = (...declarations) => `<top><attributelist></attributelist>\n<include><attributelist></attributelist>\n${declarations.join('\n')}\n</include>\n</top>\n`;
export const classOf = (name, members = [], { bases = [], ...attributes } = {}) => node('class', { name, kind: 'class', ...attributes }, members, { bases });
export const enumOf = (name, items = []) => node('enum', { name }, items.map((item) => node('enumitem', { name: item })));
export const member = (name, type, decl = 'f().', { parameters = [], access = 'public' } = {}) => node('cdecl', {
    name, kind: 'function', type, decl, access, ismember: '1',
}, [], { parameters });
export const field = (name, type, decl = '') => node('cdecl', { name, kind: 'variable', type, decl, access: 'public', ismember: '1' });
export const fn = (name, type, decl, parameters = []) => node('cdecl', { name, kind: 'function', type, decl }, [], { parameters });
export const typedef = (name, type, decl = '') => node('cdecl', { name, kind: 'typedef', type, decl, storage: 'typedef' });
