import { describe, expect, test } from 'vitest';
import fixBridgeRuntime from '../src/utils/bridgeRuntimeFixes.js';

// The parts of the SWIG fork's runtime the callback fix rewrites, already past its field fix.
const RUNTIME = [
    'template<typename A> auto callbackArgument(std::remove_reference_t<A> &value) { return value; }',
    'template<auto M, typename Builder> void bindFunctionPointerField(const Builder &cls, const char *name);',
    '#ifndef __EMSCRIPTEN__\nstruct RuntimeCallbacks {};\n#endif',
    'template<typename R, typename... A> R invokeCallback(size_t slot, A... args) {\n  return callbackArgument<A>(args);\n}',
    'template<typename F> struct Callback {};',
].join('\n');
const KEEPS_CONST = 'callbackArgument<Arg>(std::get<I>(values))';
const DROPS_CONST = 'callbackArgument<A>(std::get<I>(values))';

describe('fixBridgeRuntime', () => {
    // GDALDriver::pfnInstantiateAlgorithm takes a const std::vector<std::string> &, which binds to no non-const reference.
    test('hands callbackArgument an argument with its const', () => {
        const fixed = fixBridgeRuntime(RUNTIME);

        expect(fixed).toContain('using Arg = std::remove_reference_t<decltype(std::get<I>(values))>;');
        expect(fixed).toContain(KEEPS_CONST);
        expect(fixed).not.toContain(DROPS_CONST);
    });

    test('rewrites a bridge cached when the argument lost its const', () => {
        const cached = fixBridgeRuntime(RUNTIME).replaceAll(KEEPS_CONST, DROPS_CONST)
            .replace('  using Arg = std::remove_reference_t<decltype(std::get<I>(values))>;\n  using A = std::remove_cv_t<Arg>;\n',
                '  using A = std::remove_cv_t<std::remove_reference_t<decltype(std::get<I>(values))>>;\n');

        expect(fixBridgeRuntime(cached)).toBe(fixBridgeRuntime(RUNTIME));
    });

    test('leaves a fixed bridge as it is', () => {
        const fixed = fixBridgeRuntime(RUNTIME);

        expect(fixBridgeRuntime(fixed)).toBe(fixed);
    });
});
