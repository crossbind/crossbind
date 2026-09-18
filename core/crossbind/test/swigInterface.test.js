import { describe, test, expect } from 'vitest';
import {
    buildInterfaceContent, completingIncludes, findHeaderPrelude, findIgnoredDeclarations, indexTypeDefinitions, interfaceToRetryWithoutMacros,
    parseMacroDump, referencedTypeHeaders, selectSwigMacros, withoutSwigMacros,
} from '../src/utils/swigInterface.js';

describe('header-specific prelude', () => {
    const gdal = {
        paths: { project: '/work/ports/gdal/wasm', output: '/work/ports/gdal/wasm/dist' },
        export: { headerPrelude: { '*': ['cpl_port.h'], 'gdal_multidim.h': ['gdal_rat.h'] } },
    };
    const include = '/work/ports/gdal/wasm/dist/prebuilt/wasm-wasm32-st-release/include';

    test('adds the entries listed for the imported header to the package-wide ones', () => {
        expect(findHeaderPrelude(`${include}/gdal_multidim.h`, [gdal], 'gdal_multidim.h')).toEqual(['cpl_port.h', 'gdal_rat.h']);
    });

    test('gives every other header only the package-wide entries', () => {
        expect(findHeaderPrelude(`${include}/gdal_priv.h`, [gdal], 'gdal_priv.h')).toEqual(['cpl_port.h']);
    });
});

describe('findIgnoredDeclarations', () => {
    const gdal = {
        paths: { project: '/work/ports/gdal/wasm', output: '/work/ports/gdal/wasm/dist' },
        export: { headerPrelude: ['cpl_port.h'], ignoredDeclarations: { 'vrtdataset.h': ['VRTAverageFilteredSource'] } },
    };
    const include = '/work/ports/gdal/wasm/dist/prebuilt/wasm-wasm32-st-release/include';

    test('returns the declarations listed for the imported header, apart from its prelude', () => {
        expect(findIgnoredDeclarations(`${include}/vrtdataset.h`, [gdal], 'vrtdataset.h')).toEqual(['VRTAverageFilteredSource']);
        expect(findHeaderPrelude(`${include}/vrtdataset.h`, [gdal], 'vrtdataset.h')).toEqual(['cpl_port.h']);
    });

    test('ignores nothing in the other headers of the package', () => {
        expect(findIgnoredDeclarations(`${include}/gdal_priv.h`, [gdal], 'gdal_priv.h')).toEqual([]);
    });

    test('applies a list to every header of the package', () => {
        const legacy = { ...gdal, export: { ignoredDeclarations: ['LegacyOnly'] } };
        expect(findIgnoredDeclarations(`${include}/gdal_priv.h`, [legacy], 'gdal_priv.h')).toEqual(['LegacyOnly']);
    });

    test('a project owns the headers it lists under paths.header, wherever they live', () => {
        // The conformance kit's headers sit in a sibling workspace package that the leg bridges.
        const leg = {
            paths: { project: '/work/e2e/backend-nodejs', output: '/work/e2e/backend-nodejs/dist', header: ['/work/e2e/backend-nodejs/src/native', '/work/e2e/conformance/native'] },
            export: { headerPrelude: { 'confprelude.h': ['confpreludedeps.h'] }, ignoredDeclarations: { 'conftypes.h': ['confTypeDeclaredOnly'] } },
        };
        expect(findHeaderPrelude('/work/e2e/conformance/native/confprelude.h', [leg], 'confprelude.h')).toEqual(['confpreludedeps.h']);
        expect(findIgnoredDeclarations('/work/e2e/conformance/native/conftypes.h', [leg], 'conftypes.h')).toEqual(['confTypeDeclaredOnly']);
        expect(findIgnoredDeclarations('/work/e2e/conformance/native/confprelude.h', [leg], 'confprelude.h')).toEqual([]);
    });
});

describe('indexTypeDefinitions', () => {
    test('maps each class and struct definition to its header under its full namespace', () => {
        const definitions = indexTypeDefinitions([
            { path: 'geos/noding/Noder.h', text: 'namespace geos {\nnamespace noding {\nclass GEOS_DLL Noder {\npublic:\n    virtual ~Noder();\n};\n}\n}\n' },
            { path: 'gdal_rat.h', text: 'class CPL_DLL GDALRasterAttributeTable\n{\n};\nstruct GDALColorEntry { short c1; };\n' },
            { path: 'geos/operation/relateng/RelateNode.h', text: 'namespace geos::operation::relateng {\nclass GEOS_DLL RelateNode final : public Base {\n};\n}\n' },
        ]);
        expect(definitions.get('geos::noding::Noder')).toBe('geos/noding/Noder.h');
        expect(definitions.get('GDALRasterAttributeTable')).toBe('gdal_rat.h');
        expect(definitions.get('GDALColorEntry')).toBe('gdal_rat.h');
        expect(definitions.get('geos::operation::relateng::RelateNode')).toBe('geos/operation/relateng/RelateNode.h');
    });

    test('ignores forward declarations, template specializations and classes inside function bodies', () => {
        const definitions = indexTypeDefinitions([
            { path: 'a.h', text: 'class Forward;\ntemplate<> class Spec<int> {};\ninline void f() { struct Local { int x; }; }\nclass Outer { class Inner {}; };\n' },
        ]);
        expect([...definitions.keys()]).toEqual(['Outer', 'Outer::Inner']);
    });

    test('starts each #else branch from the scopes open at its #if', () => {
        const definitions = indexTypeDefinitions([
            { path: 'a.h', text: 'namespace n {\n#ifdef FOO\nclass A : public Base {\n#else\nclass B {\n#endif\n    int x;\n};\nclass After {};\n}\n' },
        ]);
        expect([...definitions.keys()]).toEqual(['n::A', 'n::B', 'n::After']);
    });

    test('indexes enums, scoped enums and the names C typedefs give', () => {
        const definitions = indexTypeDefinitions([
            {
                path: 'types.h',
                text: 'typedef enum { CE_None = 0, CE_Failure = 3 } CPLErr;\nenum OGRwkbGeometryType { wkbUnknown = 0 };\n'
                    + 'typedef struct GDALRPCInfo { double a; } GDALRPCInfoV2, *GDALRPCInfoPtr;\n'
                    + 'namespace geos { namespace geom { enum class Location : char { INTERIOR }; } }\n'
                    + 'inline int f() { enum Local { A }; return A; }\n',
            },
        ]);
        expect([...definitions.keys()].sort()).toEqual(['CPLErr', 'GDALRPCInfo', 'GDALRPCInfoV2', 'OGRwkbGeometryType', 'geos::geom::Location']);
    });

    test('reads declarations inside extern "C" blocks', () => {
        const definitions = indexTypeDefinitions([
            { path: 'c.h', text: '#ifdef __cplusplus\nextern "C" {\n#endif\ntypedef struct cap_point { int x; } cap_point;\n#ifdef __cplusplus\n}\n#endif\n' },
        ]);
        expect(definitions.get('cap_point')).toBe('c.h');
    });
});

describe('completingIncludes', () => {
    const definitions = indexTypeDefinitions([
        { path: 'geos/noding/Noder.h', text: 'namespace geos { namespace noding { class Noder {}; } }' },
        { path: 'geos/geom/MultiCurve.h', text: 'namespace geos { namespace geom { class MultiCurve {}; } }' },
        { path: 'geos/geom/Geometry.h', text: 'namespace geos { namespace geom { class Geometry {}; } }' },
    ]);

    test('includes the definition of each class a std::unique_ptr holds, found through the enclosing namespaces', () => {
        const headerText = 'namespace geos {\nnamespace geom { class MultiCurve; }\nnamespace noding {\nclass Noder;\nclass GeometryNoder {\n'
            + '    std::unique_ptr<Noder> noder;\n    std::unique_ptr<geom::MultiCurve> curve();\n};\n}\n}\n';
        expect(completingIncludes({ headerText, headerPath: 'geos/noding/GeometryNoder.h', definitions }))
            .toEqual(['geos/noding/Noder.h', 'geos/geom/MultiCurve.h']);
    });

    test('follows alias and using declarations to the class they name', () => {
        const headerText = 'namespace geos { namespace triangulate {\nusing geos::geom::MultiCurve;\nclass PolygonNoder {\n'
            + '    using Noder = geos::noding::Noder;\n    std::unique_ptr<Noder> noder;\n    std::vector<std::unique_ptr<MultiCurve>> curves;\n};\n} }\n';
        expect(completingIncludes({ headerText, headerPath: 'geos/triangulate/PolygonNoder.h', definitions }))
            .toEqual(['geos/noding/Noder.h', 'geos/geom/MultiCurve.h']);
    });

    test('leaves out classes defined in the header itself, types outside the package and repeats', () => {
        const headerText = 'namespace geos { namespace geom {\nclass Geometry {};\nstd::unique_ptr<Geometry> a();\nstd::unique_ptr<Geometry> b();\n'
            + 'std::unique_ptr<std::string> c();\n} }\n';
        expect(completingIncludes({ headerText, headerPath: 'geos/geom/Geometry.h', definitions })).toEqual([]);
    });

    test('are compiled after the imported header and never wrapped by SWIG', () => {
        const content = buildInterfaceContent({
            moduleName: 'GEOMETRYNODER', headerPath: 'geos/noding/GeometryNoder.h', prelude: ['geos/geom/Geometry.h'], completing: ['geos/noding/Noder.h'],
        });
        expect(content).toContain('%{\n#include "geos/geom/Geometry.h"\n#include "geos/noding/GeometryNoder.h"\n#include "geos/noding/Noder.h"\n%}');
        expect(content).not.toContain('%include "geos/noding/Noder.h"');
    });
});

describe('referencedTypeHeaders', () => {
    const definitions = indexTypeDefinitions([
        { path: 'cpl_error.h', text: 'typedef enum { CE_None = 0 } CPLErr;' },
        { path: 'geos/geom/Geometry.h', text: 'namespace geos { namespace geom { class Geometry {}; } }' },
        { path: 'geos/geom/Envelope.h', text: 'namespace geos { namespace geom { class Envelope {}; } }' },
        { path: 'geos/noding/GeometryNoder.h', text: 'namespace geos { namespace noding { class GeometryNoder {}; } }' },
    ]);

    test('finds the headers defining the enums and classes a C API uses', () => {
        const headerText = 'CPLErr GDALFlushCache(void *dataset);\nint GDALGetCount(void);\nCPLErr GDALClose(void *dataset);\n';
        expect(referencedTypeHeaders({ headerText, headerPath: 'gdal.h', definitions })).toEqual(['cpl_error.h']);
    });

    test('resolves C++ names through their namespaces and skips types used only inside function bodies', () => {
        const headerText = 'namespace geos {\nnamespace geom { class Geometry; }\nnamespace noding {\nclass GeometryNoder {\npublic:\n'
            + '    GeometryNoder(const geom::Geometry &g);\n    int count() const { geom::Envelope local; return 0; }\n};\n}\n}\n';
        expect(referencedTypeHeaders({ headerText, headerPath: 'geos/noding/GeometryNoder.h', definitions })).toEqual(['geos/geom/Geometry.h']);
    });
});

describe('buildInterfaceContent', () => {
    test('renders the pre-prelude interface text byte-for-byte when the package declares no prelude', () => {
        expect(buildInterfaceContent({ moduleName: 'NATIVE', headerPath: 'native.h' })).toBe(`#ifndef _NATIVE_I
#define _NATIVE_I

%module NATIVE

%{
#include "native.h"
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");

%include "native.h"

#endif
`);
    });

    test('includes the imported header once when it is also part of its package prelude', () => {
        const content = buildInterfaceContent({
            moduleName: 'GAIAGEO',
            headerPath: 'spatialite/gaiageo.h',
            prelude: ['sqlite3.h', 'spatialite/gaiageo.h'],
        });
        expect(content).toContain('%{\n#include "sqlite3.h"\n#include "spatialite/gaiageo.h"\n%}');
    });

    test('includes prelude headers ahead of the header but wraps only the header', () => {
        const content = buildInterfaceContent({
            moduleName: 'GAIAAUX',
            headerPath: 'spatialite/gaiaaux.h',
            prelude: ['sqlite3.h', 'spatialite/gaiageo.h'],
        });
        expect(content).toContain('%{\n#include "sqlite3.h"\n#include "spatialite/gaiageo.h"\n#include "spatialite/gaiaaux.h"\n%}');
        expect(content).toContain('%include "spatialite/gaiaaux.h"');
        expect(content).not.toContain('%include "sqlite3.h"');
    });

    test('places SWIG-only macro definitions after the features, outside the compiled wrapper code', () => {
        const content = buildInterfaceContent({
            moduleName: 'GDAL',
            headerPath: 'gdal.h',
            swigMacros: ['#define CPL_DLL', '#define CPL_C_START extern "C" {'],
        });
        expect(content).toContain('%feature("polymorphic_shared_ptr");\n\n#define CPL_DLL\n#define CPL_C_START extern "C" {\n\n%include "gdal.h"');
        expect(content.slice(content.indexOf('%{'), content.indexOf('%}'))).not.toContain('CPL_DLL');
    });

    test('turns a header name that is not an identifier into a valid SWIG module name', () => {
        const content = buildInterfaceContent({ moduleName: 'TYPECHECK-GCC', headerPath: 'curl/typecheck-gcc.h' });
        expect(content).toContain('#ifndef _TYPECHECK_GCC_I\n#define _TYPECHECK_GCC_I\n\n%module TYPECHECK_GCC\n');
        expect(content).toContain('%include "curl/typecheck-gcc.h"');
    });

    test('drops the SWIG-only macro block again, restoring the plain interface text', () => {
        const options = { moduleName: 'GDAL', headerPath: 'gdal.h', prelude: ['cpl_port.h'] };
        const plain = buildInterfaceContent(options);
        expect(withoutSwigMacros(buildInterfaceContent({ ...options, swigMacros: ['#define CPL_DLL', '#define __attribute__(x)'] }))).toBe(plain);
        expect(withoutSwigMacros(plain)).toBe(plain);
    });

    test('ignores the listed declarations before SWIG parses the header', () => {
        const content = buildInterfaceContent({ moduleName: 'VRTDATASET', headerPath: 'vrtdataset.h', ignored: ['VRTAverageFilteredSource'] });
        expect(content).toContain('%feature("polymorphic_shared_ptr");\n\n%ignore VRTAverageFilteredSource;\n\n%include "vrtdataset.h"');
    });

    test('keeps the ignored declarations when the SWIG-only macro block is dropped', () => {
        const options = { moduleName: 'VRTDATASET', headerPath: 'vrtdataset.h', ignored: ['VRTAverageFilteredSource'] };
        expect(withoutSwigMacros(buildInterfaceContent({ ...options, swigMacros: ['#define CPL_DLL'] }))).toBe(buildInterfaceContent(options));
    });
});

describe('interfaceToRetryWithoutMacros', () => {
    const options = { moduleName: 'CURL', headerPath: 'curl/curl.h' };
    const withMacros = buildInterfaceContent({ ...options, swigMacros: ['#define CURL_EXTERN'] });
    const failedWith = (status) => new Error('crossbind: command failed (swig)', { cause: { status } });

    test('drops the macros when SWIG itself rejected the interface', () => {
        expect(interfaceToRetryWithoutMacros(withMacros, failedWith(1))).toBe(buildInterfaceContent(options));
    });

    test('keeps the macros when SWIG did not run to the end, so a docker failure cannot downgrade the interface', () => {
        expect(interfaceToRetryWithoutMacros(withMacros, failedWith(125))).toBeNull();
        expect(interfaceToRetryWithoutMacros(withMacros, new Error('spawn docker ENOENT'))).toBeNull();
    });

    test('has nothing to retry when the interface carries no macros', () => {
        expect(interfaceToRetryWithoutMacros(buildInterfaceContent(options), failedWith(1))).toBeNull();
    });
});

describe('parseMacroDump', () => {
    test('reads object-like and function-like definitions from a compiler -dM dump', () => {
        const macros = parseMacroDump('#define GEOS_DLL \n#define EOF (-1)\n#define OF(args) args\n#define LOG(fmt, ...) printf(fmt, ...)\n');
        expect(macros.get('GEOS_DLL')).toEqual({ params: null, body: '', line: '#define GEOS_DLL' });
        expect(macros.get('EOF')).toEqual({ params: null, body: '(-1)', line: '#define EOF (-1)' });
        expect(macros.get('OF')).toEqual({ params: ['args'], body: 'args', line: '#define OF(args) args' });
        expect(macros.get('LOG').params).toEqual(['fmt', '...']);
    });
});

describe('selectSwigMacros', () => {
    const PREDEFINED = '#define __GNUC__ 4\n#define __cplusplus 201703L\n#define __clang__ 1\n';
    const select = (headerText, library) => selectSwigMacros({
        headerText,
        macros: parseMacroDump(PREDEFINED + library),
        predefined: parseMacroDump(PREDEFINED),
    });

    test('defines an export macro that another header provides', () => {
        expect(select('namespace geos { class GEOS_DLL Geometry {}; }', '#define GEOS_DLL \n')).toEqual(['#define GEOS_DLL']);
    });

    test('defines linkage and attribute macros and neutralizes the attributes they expand to', () => {
        const header = 'CPL_C_START\nint CPL_DLL CPL_STDCALL GDALGetDriverCount(void) CPL_WARN_UNUSED_RESULT;\nCPL_C_END\n';
        const library = '#define CPL_C_START extern "C" {\n#define CPL_C_END }\n#define CPL_DLL \n#define CPL_STDCALL \n#define CPL_WARN_UNUSED_RESULT __attribute__((warn_unused_result))\n';
        expect(select(header, library)).toEqual([
            '#define __attribute__(x)',
            '#define CPL_C_END }',
            '#define CPL_C_START extern "C" {',
            '#define CPL_DLL',
            '#define CPL_STDCALL',
            '#define CPL_WARN_UNUSED_RESULT __attribute__((warn_unused_result))',
        ]);
    });

    test('defines an access specifier macro that another header provides', () => {
        const header = 'NS_PROJ_START\nclass PROJ_GCC_DLL CRS {\n  PROJ_PRIVATE :\n    PROJ_INTERNAL void internal();\n};\nNS_PROJ_END\n';
        const library = '#define NS_PROJ_START namespace osgeo { namespace proj {\n#define NS_PROJ_END } }\n#define PROJ_GCC_DLL \n'
            + '#define PROJ_PRIVATE public\n#define PROJ_INTERNAL \n';
        expect(select(header, library)).toEqual([
            '#define NS_PROJ_END } }',
            '#define NS_PROJ_START namespace osgeo { namespace proj {',
            '#define PROJ_GCC_DLL',
            '#define PROJ_INTERNAL',
            '#define PROJ_PRIVATE public',
        ]);
    });

    test('follows function-like macros into the definitions their bodies use', () => {
        const library = '#define OSSL_DEPRECATEDIN_3_0 OSSL_DEPRECATED(3.0)\n#define OSSL_DEPRECATED(since) __attribute__((deprecated))\n';
        expect(select('OSSL_DEPRECATEDIN_3_0 int ERR_load_crypto_strings(void);', library)).toEqual([
            '#define __attribute__(x)',
            '#define OSSL_DEPRECATED(since) __attribute__((deprecated))',
            '#define OSSL_DEPRECATEDIN_3_0 OSSL_DEPRECATED(3.0)',
        ]);
    });

    test('keeps type and value macros undefined so each platform compiler resolves them', () => {
        const header = 'ZEXTERN z_off_t ZEXPORT gzseek OF((gzFile file, z_off_t offset, int whence));\nint fill(char buf[BUFSIZ], int eof = EOF);\n';
        const library = '#define ZEXTERN extern\n#define ZEXPORT \n#define OF(args) args\n#define z_off_t long\n#define BUFSIZ 1024\n#define EOF (-1)\n';
        expect(select(header, library)).toEqual(['#define OF(args) args', '#define ZEXPORT', '#define ZEXTERN extern']);
    });

    test('never forwards compiler predefined macros, even the ones the header tests', () => {
        const header = '#if defined(__GNUC__) && __GNUC__ >= 4\nint gnu_only(void);\n#endif\nEXPORT int f(void);\n';
        expect(select(header, '#define EXPORT __attribute__((visibility("default")))\n')).toEqual([
            '#define __attribute__(x)',
            '#define EXPORT __attribute__((visibility("default")))',
        ]);
    });

    test('forwards the configuration flags and version numbers that steer preprocessor branches, but no type macros', () => {
        const header = '#ifndef OPENSSL_NO_DEPRECATED_3_0\nint old_api(void);\n#endif\n#if OPENSSL_VERSION_NUMBER >= 0x30000000L\nint new_api(void);\n#endif\n#ifdef OPENSSL_SYS_TYPE\nint sys(void);\n#endif\n';
        const library = '#define OPENSSL_NO_DEPRECATED_3_0 \n#define OPENSSL_VERSION_NUMBER (OPENSSL_VERSION_MAJOR<<28)\n#define OPENSSL_VERSION_MAJOR 3\n#define OPENSSL_SYS_TYPE unix_type\n';
        expect(select(header, library)).toEqual([
            '#define OPENSSL_NO_DEPRECATED_3_0',
            '#define OPENSSL_VERSION_MAJOR 3',
            '#define OPENSSL_VERSION_NUMBER (OPENSSL_VERSION_MAJOR<<28)',
        ]);
    });

    test('leaves every macro the header defines itself to the header, since SWIG rejects a redefinition with another body', () => {
        const header = '#ifndef CAPITEST_H\n#define CAPITEST_H\n#ifndef __GNUC__\n#define __attribute__(x)\n#endif\n#ifndef CAP_API\n#define CAP_API extern\n#endif\n'
            + '#define CAP_DEPRECATED(msg)\nCAP_API CAP_DEPRECATED("old") int cap_open(void) __attribute__((pure));\n#endif\n';
        const library = '#define CAPITEST_H \n#define CAP_API extern\n#define CAP_DEPRECATED(msg) __attribute__((deprecated(msg)))\n';
        expect(select(header, library)).toEqual([]);
    });

    test('ignores macro names that appear only in comments, so a self-contained header needs nothing', () => {
        const header = '/* GEOS_DLL is empty outside Windows */\n// CPL_DLL too\nint add(int a, int b);\n';
        expect(select(header, '#define GEOS_DLL \n#define CPL_DLL \n')).toEqual([]);
    });

    test('splices a line comment that ends in a backslash, so its continuation line stays a comment', () => {
        const header = '// exported through CPL_DLL \\\nCPL_DLL is documented here\nint add(int a, int b);\n';
        expect(select(header, '#define CPL_DLL \n')).toEqual([]);
    });

    test('reads comment markers inside string literals as text, keeping the declarations between them', () => {
        const header = 'static const char *open_marker = "/*";\nGEOS_DLL int area(void);\nstatic const char *close_marker = "*/";\n';
        expect(select(header, '#define GEOS_DLL \n')).toEqual(['#define GEOS_DLL']);
    });

    test('maps compiler keyword spellings SWIG cannot parse to ones it can', () => {
        const header = '__extension__ typedef long long ll_t;\nstatic __inline int twice(int *restrict p) { return *p * 2; }\n';
        expect(select(header, '')).toEqual(['#define __extension__', '#define restrict', '#define __inline inline']);
    });
});

describe('findHeaderPrelude', () => {
    const app = { paths: { project: '/work/app', output: '/work/app/dist' }, export: {} };
    const sqlite = { paths: { project: '/work/ports/sqlite3/wasm', output: '/work/ports/sqlite3/wasm/dist' }, export: {} };
    const spatialite = {
        paths: { project: '/work/ports/spatialite/wasm', output: '/work/ports/spatialite/wasm/dist' },
        export: { headerPrelude: ['sqlite3.h', 'spatialite/gaiageo.h'] },
    };

    test('returns the prelude of the package that ships the header', () => {
        const header = '/work/ports/spatialite/wasm/dist/prebuilt/wasm-wasm32-st-release/include/spatialite/gaiaaux.h';
        expect(findHeaderPrelude(header, [app, sqlite, spatialite])).toEqual(['sqlite3.h', 'spatialite/gaiageo.h']);
    });

    test('returns an empty prelude when the owning package declares none', () => {
        const header = '/work/ports/sqlite3/wasm/dist/prebuilt/wasm-wasm32-st-release/include/sqlite3.h';
        expect(findHeaderPrelude(header, [app, sqlite, spatialite])).toEqual([]);
    });

    test('returns an empty prelude for headers outside every package', () => {
        expect(findHeaderPrelude('/elsewhere/include/other.h', [app, sqlite, spatialite])).toEqual([]);
    });

    test('does not treat a sibling directory that shares a name prefix as the owner', () => {
        const header = '/work/ports/spatialite/wasm-fork/dist/prebuilt/wasm-wasm32-st-release/include/spatialite/gaiaaux.h';
        expect(findHeaderPrelude(header, [app, sqlite, spatialite])).toEqual([]);
    });

    test('prefers the deepest owner when a package lives inside the project', () => {
        const nested = {
            paths: { project: '/work/app/node_modules/pkg', output: '/work/app/node_modules/pkg/dist' },
            export: { headerPrelude: ['pre.h'] },
        };
        const header = '/work/app/node_modules/pkg/dist/prebuilt/wasm-wasm32-st-release/include/lib.h';
        expect(findHeaderPrelude(header, [app, nested])).toEqual(['pre.h']);
    });
});
