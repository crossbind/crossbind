import { describe, test, expect } from 'vitest';
import { parseCppSurface } from '../src/utils/cppDts.js';

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

// Shapes the port headers use.
describe('parseCppSurface fields of C headers', () => {
    const fieldsOf = (header) => parseCppSurface(header, () => {}).classes.map((c) => [c.name, c.fields.map((f) => f.name)]);

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

    test('pointer, enum and function-pointer fields stay out of the types', () => {
        const header = 'typedef struct buf_s { const void *src; size_t size; Color color; void (*release)(void *); } buf;';
        expect(fieldsOf(header)).toEqual([['buf_s', ['size']]]);
    });
});
