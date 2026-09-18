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
