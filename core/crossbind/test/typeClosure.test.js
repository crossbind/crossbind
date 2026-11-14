import { describe, expect, test } from 'vitest';
import { ALL_NAMES } from '../src/utils/headerImports.js';
import { readSwigTree, typeClosure } from '../src/utils/typeClosure.js';
import {
    classOf, enumOf, field, fn, member, node, top, typedef,
} from './swigXml.js';

const closureOf = (trees, header, names, defining = {}) => typeClosure(header, names, {
    treeOf: (file) => (trees[file] ? readSwigTree(trees[file]) : null),
    definingHeader: (name) => defining[name] ?? null,
});
const names = (reached) => [...reached.keys()].sort();

const SHAPES = top(
    enumOf('Color', ['Red', 'Green']),
    enumOf('Unused', ['Nothing']),
    classOf('Base', [member('baseValue', 'int', 'q(const).f().')]),
    classOf('Shape', [member('color', 'Color', 'q(const).f().')], { bases: ['Base'] }),
    classOf('Other', [field('x', 'int')]),
    classOf('Holder', [member('shape', 'Shape', 'f().p.'), member('other', 'Other', 'f().p.')]),
    classOf('Point', [field('x', 'double'), field('y', 'double')]),
    fn('makeHolder', 'Holder', 'f().p.'),
    fn('centroid', 'Point', 'f(r.q(const).Shape).', ['r.q(const).Shape']),
    fn('plain', 'int', 'f(int).', ['int']),
);

describe('readSwigTree', () => {
    test('reads classes with their bases, enums with their enumerators, and free functions', () => {
        const tree = readSwigTree(SHAPES);

        expect([...tree.types.keys()].sort()).toEqual(['Base', 'Color', 'Holder', 'Other', 'Point', 'Shape', 'Unused']);
        expect(tree.types.get('Shape').bases).toEqual(['Base']);
        expect(tree.enumerators.get('Green')).toBe('Color');
        expect([...tree.values.keys()].sort()).toEqual(['centroid', 'makeHolder', 'plain']);
    });

    test('leaves out nested classes, class templates and what a class keeps private', () => {
        const tree = readSwigTree(top(
            classOf('Outer', [
                classOf('Outer::Inner', [], { nested: '1', access: 'public' }),
                member('secret', 'Hidden', 'f().p.', { access: 'private' }),
                member('open', 'int', 'f().'),
            ]),
            node('template', { name: 'Box', kind: 'class' }, [classOf('Box')]),
            classOf('Hidden'),
        ));

        expect([...tree.types.keys()].sort()).toEqual(['Hidden', 'Outer']);
        expect(tree.types.get('Outer').uses.join(' ')).not.toContain('Hidden');
    });

    // SWIG binds a C struct under its typedef name, which a bridge's exports list.
    test('keeps the name SWIG binds a struct under', () => {
        const tree = readSwigTree(top(classOf('X509V3_CONF_METHOD_st', [], { tdname: 'X509V3_CONF_METHOD', sym_name: 'X509V3_CONF_METHOD' }), classOf('Plain')));

        expect(tree.types.get('X509V3_CONF_METHOD_st').bound).toBe('X509V3_CONF_METHOD');
        expect(tree.types.get('Plain').bound).toBe('Plain');
    });

    test('reads a template argument SWIG writes after an unescaped >', () => {
        const tree = readSwigTree(top(classOf('Item'), fn('take', 'void', 'f(r.q(const).std::vector<(Item)>).', ['r.q(const).std::vector<(Item)>'])));

        expect(tree.values.get('take').join(' ')).toContain('std::vector<(Item)>');
    });
});

describe('typeClosure', () => {
    test('reaches the classes and enums an imported function names, their bases and what their public members use', () => {
        const reached = closureOf({ 'shapes.h': SHAPES }, 'shapes.h', ['makeHolder']);

        expect(names(reached)).toEqual(['Base', 'Color', 'Holder', 'Other', 'Shape']);
        expect(reached.get('Color')).toEqual({ kind: 'enum', header: 'shapes.h' });
    });

    test('reaches nothing for a function that names no class', () => {
        expect(names(closureOf({ 'shapes.h': SHAPES }, 'shapes.h', ['plain']))).toEqual([]);
    });

    test('reaches a class an imported name names itself, an enum through one of its enumerators', () => {
        expect(names(closureOf({ 'shapes.h': SHAPES }, 'shapes.h', ['Point', 'Red']))).toEqual(['Color', 'Point']);
    });

    test('follows a typedef to the class it names', () => {
        const tree = top(classOf('Box', [field('side', 'int')]), typedef('BoxH', 'Box', 'p.'), fn('area', 'int', 'f(BoxH).', ['BoxH']));

        expect(names(closureOf({ 'box.h': tree }, 'box.h', ['area']))).toEqual(['Box']);
    });

    // PROJ declares `typedef struct PJ_INFO PJ_INFO;` ahead of the struct, and proj_info() returns it by value.
    test('takes a struct over the typedef C names it alike', () => {
        const tree = top(typedef('PJ_INFO', 'struct PJ_INFO'), classOf('PJ_INFO', [field('release', 'char', 'p.q(const).')]), fn('proj_info', 'PJ_INFO', 'f(void).'));

        expect(names(closureOf({ 'proj.h': tree }, 'proj.h', ['proj_info']))).toEqual(['PJ_INFO']);
    });

    // An import of an overloaded name binds every overload.
    test('reaches what every overload of an imported function names', () => {
        const tree = top(classOf('Bar'), classOf('Foo'), fn('make', 'Bar', 'f(int).', ['int']), fn('make', 'Foo', 'f(double).', ['double']));

        expect(names(closureOf({ 'make.h': tree }, 'make.h', ['make']))).toEqual(['Bar', 'Foo']);
    });

    // SWIG binds an enum declared in a class only with that class.
    test('reaches the class an enum it reaches is declared in', () => {
        const tree = top(classOf('Reader', [enumOf('Mode')]), fn('open', 'int', 'f(Reader::Mode).', ['Reader::Mode']));

        expect(names(closureOf({ 'reader.h': tree }, 'reader.h', ['open']))).toEqual(['Reader', 'Reader::Mode']);
    });

    test('takes a struct another header defines over the typedef of it this one declares first', () => {
        const trees = {
            'api.h': top(typedef('Foo', 'struct Foo'), fn('make', 'Foo', 'f().p.')),
            'foo.h': top(classOf('Foo', [field('size', 'int')])),
        };

        expect([...closureOf(trees, 'api.h', ['make'], { Foo: 'foo.h' })]).toEqual([['Foo', { kind: 'class', header: 'foo.h', bound: 'Foo' }]]);
    });

    test('starts from everything a header bound whole declares', () => {
        expect(names(closureOf({ 'shapes.h': SHAPES }, 'shapes.h', ALL_NAMES))).toEqual(['Base', 'Color', 'Holder', 'Other', 'Point', 'Shape', 'Unused']);
    });

    test('looks a name up in the header defining it, and that header\'s names in turn', () => {
        const trees = {
            'app.h': top(fn('open', 'Dataset', 'f().p.')),
            'dataset.h': top(classOf('Dataset', [member('layer', 'Layer', 'f(int).p.', { parameters: ['int'] })])),
            'layer.h': top(classOf('Layer'), classOf('Unrelated')),
        };

        const reached = closureOf(trees, 'app.h', ['open'], { Dataset: 'dataset.h', Layer: 'layer.h', Unrelated: 'layer.h' });

        expect([...reached]).toEqual([
            ['Dataset', { kind: 'class', header: 'dataset.h', bound: 'Dataset' }],
            ['Layer', { kind: 'class', header: 'layer.h', bound: 'Layer' }],
        ]);
    });

    test('tries a name used inside a class in that class first, as C++ lookup does', () => {
        const tree = top(
            enumOf('Mode'),
            classOf('Reader', [enumOf('Mode'), member('mode', 'Mode', 'q(const).f().')]),
            fn('reader', 'Reader', 'f().p.'),
        );

        expect(names(closureOf({ 'reader.h': tree }, 'reader.h', ['reader']))).toEqual(['Reader', 'Reader::Mode']);
    });

    test('reaches a class inside a namespace by the full name SWIG writes', () => {
        const tree = top(node('namespace', { name: 'ns' }, [classOf('ns::Spaced')]), fn('makeSpaced', 'ns::Spaced', 'f().p.'));

        expect(names(closureOf({ 'spaced.h': tree }, 'spaced.h', ['makeSpaced']))).toEqual(['ns::Spaced']);
    });
});
