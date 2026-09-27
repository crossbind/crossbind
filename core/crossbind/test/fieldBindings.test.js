import { describe, test, expect } from 'vitest';
import { parseCppSurface } from '../src/utils/cppDts.js';
import { buildFieldPropertyLines, injectFieldBindings } from '../src/utils/cppFieldBindings.js';

const HEADER = `
class ConfBox {
  public:
    int width;
    int height = 0;
    std::string label;
    bool ready;
    double ratio{1.5};
    static int counter;
    std::vector<int> data;
    ConfBox(int w, int h) : width(w), height(h) {}
    int area() { return width * height; }
  private:
    int secret;
};

struct Pair {
    int a;
    int b;
};

struct Holder {
    const int &ref;
    int &&moved;
    int value;
};
`;

describe('parseCppSurface fields', () => {
    const model = parseCppSurface(HEADER, () => {});
    const box = model.classes.find((c) => c.name === 'ConfBox');
    const pair = model.classes.find((c) => c.name === 'Pair');

    test('captures public primitive, bool and string fields', () => {
        expect(box.fields.map((f) => f.name)).toEqual(['width', 'height', 'label', 'ready', 'ratio']);
        expect(box.fields.find((f) => f.name === 'label').type).toBe('string');
        expect(box.fields.find((f) => f.name === 'ready').type).toBe('boolean');
    });

    test('skips static, private and non-value fields', () => {
        const names = box.fields.map((f) => f.name);
        expect(names).not.toContain('counter');
        expect(names).not.toContain('secret');
        expect(names).not.toContain('data');
    });

    test('struct members are public by default', () => {
        expect(pair.fields.map((f) => f.name)).toEqual(['a', 'b']);
    });

    test('skips reference members, which a pointer to member cannot name', () => {
        const holder = model.classes.find((c) => c.name === 'Holder');
        expect(holder.fields.map((f) => f.name)).toEqual(['value']);
    });
});

describe('injectFieldBindings', () => {
    const model = parseCppSurface(HEADER, () => {});
    const bridge = `
EMSCRIPTEN_BINDINGS(x) {
  emscripten::class_<ConfBox>("ConfBox")
    .constructor<int, int>()
    .function("area", &ConfBox::area)
  ;
  emscripten::class_<Pair, emscripten::base<ConfBox>>("Pair")
  ;
}
`;

    test('injects .property lines after the class_ opener', () => {
        const out = injectFieldBindings(bridge, model);
        expect(out).toContain('.property("width", &ConfBox::width)');
        expect(out).toContain('.property("label", &ConfBox::label)');
        expect(out.indexOf('.property("width"')).toBeLessThan(out.indexOf('.constructor<int, int>()'));
    });

    test('handles template arguments containing > in the class_ opener', () => {
        const out = injectFieldBindings(bridge, model);
        expect(out).toContain('.property("a", &Pair::a)');
        expect(out).toContain('.property("b", &Pair::b)');
    });

    test('is idempotent', () => {
        const once = injectFieldBindings(bridge, model);
        const twice = injectFieldBindings(once, model);
        expect(twice).toBe(once);
    });

    test('classes absent from the bridge are ignored', () => {
        const out = injectFieldBindings('int main() { return 0; }', model);
        expect(out).toBe('int main() { return 0; }');
    });

    test('buildFieldPropertyLines emits one line per bindable field', () => {
        const lines = buildFieldPropertyLines(model.classes.find((c) => c.name === 'Pair'));
        expect(lines).toEqual(['.property("a", &Pair::a)', '.property("b", &Pair::b)']);
    });
});

// Shapes the port headers use: a JavaScript-only build of zstd, zlib, WebP, PROJ, libgeotiff and
// Expat bound none of these fields before.
describe('parseCppSurface fields of C headers', () => {
    const fieldsOf = (header, options) => parseCppSurface(header, () => {}, options).classes.map((c) => [c.name, c.fields.map((f) => f.name)]);

    test('a /* inside a // comment does not hide what follows', () => {
        expect(fieldsOf('// planes *y/*u/*v\nstruct W { int w; };\n/* colorspace */\n')).toEqual([['W', ['w']]]);
    });

    test('an anonymous typedef struct takes its typedef name', () => {
        expect(fieldsOf('typedef struct { int major; int minor; } Version;')).toEqual([['Version', ['major', 'minor']]]);
    });

    test('a typedef union keeps its value members', () => {
        expect(fieldsOf('typedef union { double v[4]; int i; } Coord;')).toEqual([['Coord', ['i']]]);
    });

    test('a tagged typedef struct keeps its tag and records its alias', () => {
        const [stream] = parseCppSurface('typedef struct z_stream_s { int avail; } z_stream, *z_streamp;', () => {}).classes;
        expect([stream.name, stream.aliases]).toEqual(['z_stream_s', ['z_stream']]);
    });

    test('a struct followed by a variable records no alias', () => {
        const [state] = parseCppSurface('struct state { int n; } current;', () => {}).classes;
        expect(state.aliases).toEqual([]);
    });

    test('declarators sharing a type each become a field; pointers, arrays and bit-fields do not', () => {
        expect(fieldsOf('struct S { int x, y; int *p, q; unsigned a : 1, b : 2; int arr[4], n; double w = 1.5, h; std::map<int, int> m; };')).toEqual([
            ['S', ['x', 'y', 'q', 'n', 'w', 'h']],
        ]);
    });

    test('scalar typedefs of the translation unit resolve to numbers and booleans', () => {
        const typedefs = new Map([
            ['uInt', 'unsigned int'],
            ['flag_t', 'bool'],
        ]);
        expect(parseCppSurface('struct Z { uInt avail; flag_t ok; opaque_t o; };', () => {}, { typedefs }).classes[0].fields).toEqual([
            { name: 'avail', type: 'number' },
            { name: 'ok', type: 'boolean' },
        ]);
    });
});

describe('injectFieldBindings on C headers', () => {
    test('fields of a tagged typedef struct land on the class SWIG registered under the alias', () => {
        const model = parseCppSurface('typedef struct z_stream_s { int avail; } z_stream;', () => {});
        const out = injectFieldBindings('  emscripten::class_<z_stream_s>("z_stream")\n  ;', model);
        expect(out).toContain('.property("avail", &z_stream_s::avail)');
    });

    test('lines an earlier pass injected are replaced, so a stale field goes away', () => {
        const bridge = '  emscripten::class_<S>("S")\n    .property("gone", &S::gone)\n  ;';
        const out = injectFieldBindings(bridge, parseCppSurface('struct S { int kept; };', () => {}));
        expect(out).not.toContain('"gone"');
        expect(out).toContain('.property("kept", &S::kept)');
    });
});

// A package's C structs also carry pointers (buffers, error managers) and enums (colour spaces): pointers
// cross as handles and enums as their underlying integer, but only for headers the build reads preprocessed.
describe('pointer and enum fields of a package header', () => {
    const header = [
        'typedef enum { RED, GREEN } Color;',
        'typedef struct buf_s {',
        '    const void *src;',
        '    size_t size;',
        '    Color color;',
        '    unsigned char **rows;',
        '    void (*release)(void *);',
        '    int pair[2];',
        '    struct peer *next;',
        '} buf;',
    ].join('\n');
    const options = { enums: new Set(['Color']), pointerFields: true };
    const prelude = 'namespace crossbind {\ntemplate<typename Q> PointerHandle toHandle(Q *p) { return nullptr; }\n}\n';
    const bridge = `${prelude}EMSCRIPTEN_BINDINGS(buf) {\n  emscripten::class_<buf_s>("buf")\n  ;\n}\n`;

    test('are found only when the build asks for them', () => {
        expect(parseCppSurface(header, () => {}).classes[0].fields.map((f) => f.name)).toEqual(['size']);
        expect(parseCppSurface(header, () => {}, options).classes[0].fields).toEqual([
            { name: 'src', type: 'NativePointer | null', kind: 'pointer' },
            { name: 'size', type: 'number' },
            { name: 'color', type: 'number', kind: 'enum' },
            { name: 'rows', type: 'NativePointer | null', kind: 'pointer' },
            { name: 'next', type: 'NativePointer | null', kind: 'pointer', pointee: 'peer' },
        ]);
    });

    test('an enum field reads and writes its underlying integer', () => {
        const [cls] = parseCppSurface(header, () => {}, options).classes;
        const line = buildFieldPropertyLines(cls, { pointers: true }).find((l) => l.includes('"color"'));
        expect(line).toContain('std::underlying_type_t<decltype(buf_s::color)>');
        expect(line).toMatch(/\/\/ crossbind field$/);
    });

    test('a pointer field reads a handle and writes a handle, null or an instance', () => {
        const [cls] = parseCppSurface(header, () => {}, options).classes;
        const line = buildFieldPropertyLines(cls, { pointers: true }).find((l) => l.includes('"src"'));
        expect(line).toContain('crossbind::toHandle(s.src)');
        expect(line).toContain('crossbind_fields::set<decltype(buf_s::src)>(v)');
    });

    test('brings its helpers once, ahead of the bindings, when the bridge has the pointer runtime', () => {
        const model = parseCppSurface(header, () => {}, options);
        const out = injectFieldBindings(bridge, model);
        expect(out.split('namespace crossbind_fields').length - 1).toBe(1);
        expect(out.indexOf('namespace crossbind_fields')).toBeLessThan(out.indexOf('EMSCRIPTEN_BINDINGS(buf)'));
        expect(out).toContain('.property("src", ');
        expect(out).toContain('.property("color", ');
        expect(injectFieldBindings(out, model)).toBe(out);
    });

    test('a field declared through a pointer typedef is a pointer, one through a function-pointer typedef is not', () => {
        const source = 'struct marker { marker_ptr next; alloc_func zalloc; const marker_ptr fixed; unsigned char code; };';
        const types = { pointerTypedefs: new Map([['marker_ptr', 'struct marker']]), pointerFields: true };
        const { fields } = parseCppSurface(source, () => {}, types).classes[0];
        expect(fields.map((f) => [f.name, f.kind ?? 'value'])).toEqual([['next', 'pointer'], ['code', 'value']]);
    });

    test('a pointer to a struct the bridge binds reads as an instance that owns nothing', () => {
        const source = 'typedef struct node_s { struct node_s *next; node_ptr previous; struct other *elsewhere; const struct node_s *fixed; } node;';
        const model = parseCppSurface(source, () => {}, { pointerTypedefs: new Map([['node_ptr', 'struct node_s']]), pointerFields: true });
        const nodeBridge = `${prelude}EMSCRIPTEN_BINDINGS(node) {\n  emscripten::class_<node_s>("node")\n    .smart_ptr<std::shared_ptr<node_s>>("node")\n  ;\n}\n`;

        const out = injectFieldBindings(nodeBridge, model);

        expect(out).toContain('return crossbind_fields::view(s.next);');
        expect(out).toContain('return crossbind_fields::view(s.previous);');
        expect(out).toContain('return crossbind::toHandle(s.elsewhere);');
        expect(out).toContain('return crossbind::toHandle(s.fixed);');
    });

    test('leaves pointer fields out of a bridge without the pointer runtime', () => {
        const out = injectFieldBindings('EMSCRIPTEN_BINDINGS(buf) {\n  emscripten::class_<buf_s>("buf")\n  ;\n}\n', parseCppSurface(header, () => {}, options));
        expect(out).not.toContain('"src"');
        expect(out).not.toContain('crossbind_fields');
        expect(out).toContain('.property("color", ');
    });
});
