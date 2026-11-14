export default {
    slug: 'conan',
    title: 'ConanCenter',
    description: 'Import a C or C++ library from ConanCenter with the conan: scheme, built from source by crossbind.',
    lede: "Declare a ConanCenter package in `crossbind.config.js`, then import one of its headers with the `conan:` prefix. crossbind builds the package from source with its own toolchains, links it statically and binds the header as it binds a port's.",
    blocks: [
        { type: 'h2', id: 'requirement', text: 'What you need' },
        {
            type: 'p',
            text: 'With the default Docker runner, nothing to install for web, Android, Linux and Windows builds: the toolchain images carry Conan. iOS and macOS packages build on your Mac with Xcode whatever the runner, so those need Conan 2.19 or later and CMake on the `PATH`. The first build of a package needs the network, to reach ConanCenter and the sources its recipe downloads.',
        },
        {
            type: 'p',
            text: 'Under `RUNNER=LOCAL`, web builds need Conan 2.19 or later, Emscripten and CMake on the `PATH`, and Android, Linux and Windows packages are refused: they need the NDK, the sysroots and llvm-mingw of the images.',
        },

        { type: 'h2', id: 'declare', text: 'Declare the package' },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    packages: {
        conan: {
            zlib: '1.3.2',
            libpng: '[>=1.6 <2]',
            sqlite3: { version: '3.53.4', options: { enable_fts5: true } },
        },
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'ul',
            items: [
                '`packages.conan` holds what `conan:` imports. A key is the Conan package name. Its value is a version, a Conan version range, or `{ version, options }` with options the recipe defines, as strings, numbers or booleans.',
                '`shared` is not an option you can set: every package links statically into the module.',
            ],
        },

        { type: 'h2', id: 'import', text: 'Import a header' },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, zlibVersion, compressBound } from 'conan:zlib/zlib.h';
import { png_access_version_number } from 'conan:libpng/png.h';

await initNative();
console.log(await zlibVersion(), await compressBound(1000));`,
        },
        {
            type: 'p',
            text: "`conan:<package>/<header>` names a header under the package's include directory, subdirectories included: `conan:libxml2/libxml/parser.h`. Importing a package that `packages.conan` does not declare fails the build. A package another one requires - zlib under libpng - is built and linked either way, and importable once you declare it.",
        },
        {
            type: 'p',
            text: 'The header binds as any [library header](/guide/bindings/#imports) does: its enums whole, a free function only when your code imports it by name, a class only when an import reaches it. Without a bundler, Node.js resolves `conan:` imports through the module hooks `crossbind build -e node` writes ([Node.js](/guide/node/)).',
        },

        { type: 'h2', id: 'own-header', text: 'Through your own header' },
        {
            type: 'p',
            text: "The include directories of every package are on your native sources' include path, so a header of your own can use any of them, C++ libraries included. It is also the way to reach what a header cannot bind on its own, such as templates and header-only libraries:",
        },
        {
            type: 'code',
            file: 'src/native/text.h',
            code: `#pragma once

#include <string>
#include <fmt/format.h>

class Text {
public:
    static std::string price(double value) { return fmt::format("{:.2f}", value); }
};`,
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, Text } from './native/text.h';

await initNative();
console.log(await Text.price(3.14159));`,
        },
        {
            type: 'p',
            text: "C++ exceptions cross between your code and a package: an `fmt::format_error` thrown inside libfmt reaches your `catch`. Your sources also compile with the defines a recipe declares for code that uses it (`cpp_info.defines`), such as libcurl's `CURL_STATICLIB` on Windows.",
        },

        { type: 'h2', id: 'platforms', text: 'React Native and Node.js' },
        {
            type: 'p',
            text: 'The same imports work in a React Native app on Android and iOS; the native build installs the packages before Metro bundles the bridges. Android packages are built for API level 33, as the ports are, so in an app with a lower `minSdkVersion` a package that calls a newer libc function fails to link. iOS packages are built for device and simulator, arm64 and iOS 15.1, and each library becomes an xcframework the `react-native-crossbind` pod vendors - run `pod install` again after you change `packages.conan`.',
        },
        {
            type: 'p',
            text: "A [Node.js addon](/guide/node/#addon) for macOS, Linux or Windows links the packages built for its own target, with the system libraries and Apple frameworks their recipes ask for. A package's symbols stay inside the addon, as a port's do, so they never trade calls with the zlib and OpenSSL that Node.js exports itself.",
        },

        { type: 'h2', id: 'build', text: 'What a build does' },
        {
            type: 'ol',
            items: [
                'When a build starts - in a bundler plugin, `crossbind build`, or the Gradle or Xcode build of a React Native app - crossbind runs `conan install` for each release target it needs, with a profile written from the toolchain the ports are built with. Every package is a static library.',
                'ConanCenter publishes no binaries for these toolchains, so each package builds from source the first time. Built packages stay in `~/.crossbind/conan/store`, shared by every project; iOS, macOS and `RUNNER=LOCAL` builds use `~/.crossbind/conan-local/store`.',
                'Each package is staged in `.crossbind/conan/packages/<package>/dist/prebuilt/<target>/`, the layout a port ships, and linked like one. A debug build links the release archives.',
                "A target is installed again only when its inputs change: `packages.conan`, the toolchain, crossbind's profile or `conan.lock`.",
            ],
        },
        {
            type: 'p',
            text: "Each install writes Conan's whole log to `.crossbind/conan/logs/<target>.log`; a failed one also prints its end.",
        },

        { type: 'h2', id: 'recipes', text: 'What a recipe can reach' },
        {
            type: 'p',
            text: "A recipe is Python that runs the package's own build system, so crossbind fences it in as far as the runner allows:",
        },
        {
            type: 'ul',
            items: [
                'Each `conan install` gets a work directory and a Conan home of its own, deleted when it ends: plugins, hooks, remotes or settings a recipe writes never reach the next install.',
                'In the default Docker runner the container sees the package store and that work directory, not your project, and every path it reports back is checked before anything is copied. A [remote runner](/guide/remote-builds/) sends back only the built packages.',
                'The store is shared and writable, so a recipe built for one project can change what another later takes from it. Delete `~/.crossbind/conan/store` to build every package again.',
                'Under `RUNNER=LOCAL`, and for iOS and macOS on any runner, recipes run on your machine with your permissions.',
            ],
        },

        { type: 'h2', id: 'lockfile', text: 'The lockfile' },
        {
            type: 'p',
            text: 'The first install writes `conan.lock` next to `crossbind.config.js`. It pins the exact version and recipe revision of every package, so commit it. Later installs follow it and add any requirement it does not list yet; delete it to resolve every version again.',
        },

        { type: 'h2', id: 'typescript', text: 'TypeScript' },
        {
            type: 'p',
            text: "Each `conan:` import is typed by an ambient module, `declare module 'conan:zlib/zlib.h'`, under `.crossbind/conan/types/`, which `@crossbind/typescript-config` includes; a tsconfig with its own `include` needs `.crossbind/conan/types/**/*.d.ts` in it. The declarations list every bindable function of the header, even before you import it, but only the imported ones enter the compiled bridge.",
        },

        { type: 'h2', id: 'licenses', text: 'Licenses' },
        {
            type: 'p',
            text: '`crossbind licenses` lists every Conan package of the build with the license its recipe declares, the source URL and SHA-256 the recipe downloads, and the license texts the package ships; in the SBOM a package is `pkg:conan/<package>@<version>`. It reads what the last build installed, so on a fresh checkout it stops with an error until you build ([CLI](/guide/cli/#licenses)).',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                'No WASI: Conan has no WASI target, and a `crossbind build` that would also build WASI fails while `packages.conan` declares a package - name your platforms with `-p`.',
                "A recipe that does not build for Emscripten, the NDK, iOS, macOS, a Linux sysroot or llvm-mingw fails with Conan's own error; its options can often switch the failing part off.",
                "Web and React Native builds link a package's own archives only: the system libraries and Apple frameworks its recipe asks for are not added.",
                "A header binds as far as a port's does: C APIs bind, variadic functions when imported by name, templates do not.",
                'Packages come from ConanCenter only; another remote, or a login to one, is not supported.',
            ],
        },
    ],
};
