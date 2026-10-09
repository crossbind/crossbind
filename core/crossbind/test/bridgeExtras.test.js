import { describe, test, expect } from 'vitest';
import crypto from 'node:crypto';
import {
    macroCall, interfaceExtras, bridgeExtras, withPointerRuntimeAnchor, withoutBridgeExtras, EXTRAS_RUNTIME, POINTER_RUNTIME_ANCHOR,
} from '../src/utils/bridgeExtras.js';
import { buildInterfaceContent, parseMacroDump } from '../src/utils/swigInterface.js';
import { ALL_NAMES } from '../src/utils/headerImports.js';

const macro = (line) => [...parseMacroDump(line)][0][1];
const warning = (message) => `/tmp/crossbind/live/native/extras.h:12: ${message}`;
const variadicWarning = (name) => warning(`Variable length arguments are not supported by embind, ${name} skipped.`);
const globalWarning = (name) => warning(`Global ${name} is not const, so embind cannot bind it as a constant; skipped.`);
const registration = (name, arity) => `    if (crossbind::claimFunction("${name}", ${arity})) emscripten::function("${name}", &${name});`;

describe('macroCall', () => {
    test('finds the function a macro calls and where each parameter goes', () => {
        expect(macroCall(macro('#define deflateInit2(strm,level,method,windowBits,memLevel,strategy) deflateInit2_((strm),(level),(method),(windowBits),(memLevel),(strategy), ZLIB_VERSION, (int)sizeof(z_stream))')))
            .toEqual({ callee: 'deflateInit2_', positions: [0, 1, 2, 3, 4, 5] });
    });

    test('reads a parameter through a cast and the parentheses around the whole body', () => {
        expect(macroCall(macro('#define BIO_get_mem_data(b,pp) BIO_ctrl(b,BIO_CTRL_INFO,0,(char *)(pp))'))).toEqual({ callee: 'BIO_ctrl', positions: [0, 3] });
        expect(macroCall(macro('#define SSL_set_tlsext_host_name(s,name) (SSL_ctrl(s,SSL_CTRL_SET_TLSEXT_HOSTNAME,TLSEXT_NAMETYPE_host_name, (void *)name))')))
            .toEqual({ callee: 'SSL_ctrl', positions: [0, 3] });
        expect(macroCall(macro('#define touch() touch_()'))).toEqual({ callee: 'touch_', positions: [] });
    });

    test('reads an argument that is no cast in linear time', () => {
        const started = performance.now();

        expect(macroCall(macro('#define M(x) call((SSL_CTRL_SET_MIN_PROTO_VERSION_WITH_A_LONGER_NAME + 1) * 2, x)')))
            .toEqual({ callee: 'call', positions: [1] });
        expect(performance.now() - started).toBeLessThan(100);
    });

    test('counts no comma or parenthesis inside a string or character literal', () => {
        expect(macroCall(macro('#define F3(b) fmt3("a,b(", b, \',\')'))).toEqual({ callee: 'fmt3', positions: [1] });
    });

    test('types nothing that is not one call passing each parameter whole', () => {
        expect(macroCall(macro('#define TIFFGetR(abgr) ((abgr) & 0xff)'))).toBeNull();
        expect(macroCall(macro('#define twice(x) add((x) + 1, 2)'))).toBeNull();
        expect(macroCall(macro('#define log(...) printf(__VA_ARGS__)'))).toBeNull();
        expect(macroCall(macro('#define pair(a, b) first(a) + second(b)'))).toBeNull();
    });
});

describe('interfaceExtras', () => {
    const macros = parseMacroDump([
        '#define iconv_open libiconv_open',
        '#define deflateInit2(strm,level) deflateInit2_((strm),(level),1)',
        '#define compress2(dest,source) z_compress2_((dest),(source))',
        '#define z_compress2_ compress2_',
        '#define LIMIT MAX_LIMIT',
        '#define MAX_LIMIT 10',
        '#define WIDE long',
    ].join('\n'));

    test('carries a function-like macro and a macro naming a function to the bridge, and has SWIG bind the function each one reaches', () => {
        expect(interfaceExtras(['iconv_open', 'deflateInit2', 'compress2', 'LIMIT', 'WIDE', 'compress'], macros)).toEqual({
            lines: [
                '// crossbind:alias iconv_open libiconv_open',
                '// crossbind:macro deflateInit2_ #define deflateInit2(strm,level) deflateInit2_((strm),(level),1)',
                '// crossbind:macro compress2_ #define compress2(dest,source) z_compress2_((dest),(source))',
            ],
            functions: ['libiconv_open', 'deflateInit2_', 'compress2_'],
        });
    });

    test('notes a macro that calls another function-like macro instead of carrying it to the bridge', () => {
        const nested = parseMacroDump(['#define outer(x) inner((x))', '#define inner(y) inner_((y), 1)'].join('\n'));

        expect(interfaceExtras(['outer'], nested)).toEqual({
            lines: ['// crossbind:note outer: a function-like macro binds only when it calls a function, not the macro inner; skipped.'],
            functions: [],
        });
    });

    test('adds nothing without names imported by name', () => {
        expect(interfaceExtras(ALL_NAMES, macros)).toEqual({ lines: [], functions: [] });
        expect(interfaceExtras([], macros)).toEqual({ lines: [], functions: [] });
    });
});

describe('bridgeExtras', () => {
    const header = [
        'extern "C" {',
        'int confVaSum(const char *kinds, ...);',
        'int confVaList(const char *format, va_list ap);',
        'extern int confCounter;',
        '}',
        'namespace conf { extern int hidden; }',
        'struct Holder { int member; };',
    ].join('\n');

    test('binds an imported variadic function and the vaDouble helper, and answers its warning', () => {
        const warnings = [variadicWarning('confVaSum'), variadicWarning('notImported')];
        const extras = bridgeExtras({ named: ['confVaSum'], warnings, headerText: header, module: 'EXTRAS' });

        expect(extras.code).toContain('crossbind::bindVariadic<F, static_cast<F>(&confVaSum), 6>("confVaSum")');
        expect(extras.code).toContain('inline crossbind::Unbound (confVaSum)(crossbind::Unbound)');
        expect(extras.code).toContain('EMSCRIPTEN_BINDINGS(CrossbindExtras_EXTRAS)');
        expect(extras.exports).toEqual(['confVaSum', 'vaDouble']);
        expect([...extras.answered]).toEqual([warnings[0]]);
    });

    test('leaves a function taking a va_list and its warning alone', () => {
        const extras = bridgeExtras({ named: ['confVaList'], warnings: [variadicWarning('confVaList')], headerText: header, module: 'EXTRAS' });

        expect(extras).toMatchObject({ code: '', exports: [] });
        expect(extras.answered.size).toBe(0);
    });

    test('binds a mutable global declared at file scope as a handle, and none inside a namespace', () => {
        const warnings = [globalWarning('confCounter'), globalWarning('hidden')];
        const extras = bridgeExtras({ named: ['confCounter', 'hidden'], warnings, headerText: header, module: 'EXTRAS' });

        expect(extras.code).toContain('crossbind::bindGlobal("confCounter", &confCounter);');
        expect(extras.code).not.toContain('hidden');
        expect(extras.exports).toEqual(['confCounter']);
        expect([...extras.answered]).toEqual([warnings[0]]);
    });

    test('binds a function-like macro with the types of the function it calls, and notes one it cannot type', () => {
        const interfaceText = [
            '// crossbind:macro confMacroAdd_ #define confMacroAdd(a, b) confMacroAdd_((a), (b), 100)',
            '// crossbind:macro confMacroTwice #define confMacroTwice(x) ((x) * 2)',
        ].join('\n');
        const bridgeText = registration('confMacroAdd_', 3);
        const extras = bridgeExtras({ interfaceText, named: ['confMacroAdd', 'confMacroTwice'], bridgeText, headerText: header, module: 'EXTRAS' });

        expect(extras.code).toContain('crossbind::bindMacro<crossbind_macro_confMacroAdd, decltype(&confMacroAdd_), 0, 1>("confMacroAdd");');
        expect(extras.code).toContain('static auto call(A0 a0, A1 a1) { return confMacroAdd(a0, a1); }');
        expect(extras.exports).toEqual(['confMacroAdd']);
        expect(extras.notes).toEqual(['confMacroTwice: a function-like macro binds only when its body calls one function with each of its parameters as a whole argument; skipped.']);
    });

    test('binds a function-like macro only when SWIG bound the one function it calls', () => {
        const interfaceText = [
            '// crossbind:macro sizeof #define confSize(x) sizeof(x)',
            '// crossbind:macro confOverloaded #define confCall(x) confOverloaded((x), 1)',
        ].join('\n');
        const warnings = [warning('embind cannot bind another overload of confOverloaded taking 2 arguments, ignored.')];
        const extras = bridgeExtras({ interfaceText, named: ['confSize', 'confCall'], bridgeText: registration('confOverloaded', 2), warnings, module: 'EXTRAS' });

        expect(extras).toMatchObject({ code: '', exports: [] });
        expect(extras.notes).toEqual([
            'confSize: a function-like macro binds only when it calls one function the header binds, which sizeof is not; skipped.',
            'confCall: a function-like macro binds only when it calls one function the header binds, which confOverloaded is not; skipped.',
        ]);
    });

    test('registers the macros before the fallbacks of variadic functions, so a callee name stays one function', () => {
        const interfaceText = '// crossbind:macro confMacroAdd_ #define confMacroAdd(a, b) confMacroAdd_((a), (b), 100)';
        const extras = bridgeExtras({
            interfaceText, named: ['confMacroAdd', 'confVaSum'], bridgeText: registration('confMacroAdd_', 3), warnings: [variadicWarning('confVaSum')], headerText: header, module: 'EXTRAS',
        });

        expect(extras.code.indexOf('bindMacro<')).toBeLessThan(extras.code.indexOf('inline crossbind::Unbound (confVaSum)'));
    });

    test('binds a macro naming a function under the macro\'s name once SWIG bound that function, and notes any other', () => {
        const interfaceText = ['// crossbind:alias confRenamed confRenamedTarget', '// crossbind:alias confTypeAlias ConfType'].join('\n');
        const interfaceWithOverload = `${interfaceText}\n// crossbind:alias confPick confPicked`;
        const bridgeText = `${registration('confRenamedTarget', 1)}\n${registration('confPicked', 1)}`;
        const warnings = [warning('embind cannot bind another overload of confPicked taking 1 arguments, ignored.')];
        const extras = bridgeExtras({ interfaceText: interfaceWithOverload, named: ['confRenamed', 'confTypeAlias', 'confPick'], bridgeText, warnings, headerText: header, module: 'EXTRAS' });

        expect(extras.code).toContain('crossbind::bindAlias<decltype(&confRenamedTarget), &confRenamedTarget>("confRenamed");');
        expect(extras.exports).toEqual(['confRenamed']);
        expect(extras.notes).toEqual([
            'confTypeAlias: a macro naming ConfType binds only when ConfType is one function the header binds; skipped.',
            'confPick: a macro naming confPicked binds only when confPicked is one function the header binds; skipped.',
        ]);
    });

    // Every bridge carrying the runtime registers through it, and bridges of one module must agree on it.
    test('keeps the C++ runtime the bridge format names', () => {
        const hash = crypto.createHash('sha256').update(EXTRAS_RUNTIME).digest('hex').slice(0, 16);

        expect(hash, 'the extras runtime changed: bump BRIDGE_FORMAT in actions/createInterface.js, then this hash').toBe('251c523d8c879d8b');
    });

    test('adds nothing when the app imports no such name', () => {
        expect(bridgeExtras({ interfaceText: '', named: ['compress'], warnings: [variadicWarning('gzprintf')], headerText: header, module: 'Z' }))
            .toMatchObject({ code: '', exports: [], notes: [] });
    });
});

describe('withoutBridgeExtras', () => {
    test('gives back the interface without the lines and the anchor the bridge added', () => {
        const interfaceOf = (extras) => buildInterfaceContent({ moduleName: 'ICONV', headerPath: 'iconv.h', functions: ['iconv'], extras });
        const extended = withPointerRuntimeAnchor(interfaceOf([
            '// crossbind:alias iconv_open libiconv_open',
            '// crossbind:note iconv_close: a macro naming libiconv_close binds only when libiconv_close is one function the header binds; skipped.',
        ]));

        expect(extended).toContain(POINTER_RUNTIME_ANCHOR);
        expect(withoutBridgeExtras(extended)).toBe(interfaceOf([]));
    });
});
