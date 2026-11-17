export default {
    slug: 'conan',
    title: 'ConanCenter',
    description: 'Import a C or C++ library from ConanCenter with the conan: scheme, built from source by crossbind.',
    lede: "Declare a ConanCenter package in `crossbind.config.js` and import its headers with the `conan:` prefix. crossbind builds the package from source, links it statically and binds the header like a port's.",
    blocks: [
        { type: 'h2', id: 'requirement', text: 'What you need' },
        {
            type: 'p',
            text: 'With the default Docker runner, web, Android, Linux and Windows builds need nothing installed: the images carry Conan. iOS and macOS packages build on your Mac with Xcode on any runner, so they need Conan 2.19 or later and CMake on the `PATH`. The first build of a package needs the network.',
        },
        {
            type: 'p',
            text: 'Under `RUNNER=LOCAL`, web builds need Conan 2.19 or later, Emscripten and CMake on the `PATH`; Android, Linux and Windows packages cannot build there.',
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
                "`packages.conan` holds what `conan:` imports. The key is the Conan package name; the value is a version, a Conan version range, or `{ version, options }` with the recipe's options as strings, numbers or booleans.",
                '`shared` cannot be set: every package links statically.',
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
            text: "`conan:<package>/<header>` names a header in the package's include folder, subfolders included: `conan:libxml2/libxml/parser.h`. Importing a package that `packages.conan` does not declare fails the build. A package another one requires (zlib under libpng) is built and linked either way; declare it to import it too.",
        },
        {
            type: 'p',
            text: 'The header binds like any [library header](/guide/bindings/#imports). Without a bundler, Node.js resolves `conan:` imports through the hooks `crossbind build -e node` writes ([Node.js](/guide/node/)).',
        },

        { type: 'h2', id: 'own-header', text: 'Through your own header' },
        {
            type: 'p',
            text: "Every package's headers are on your native include path, so your own header can use them. That is also how to reach what cannot bind directly, such as templates and header-only libraries:",
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
            text: "An exception thrown inside a package, such as libfmt's `fmt::format_error`, reaches your `catch`. Your sources compile with the defines a recipe declares for its users, such as libcurl's `CURL_STATICLIB` on Windows.",
        },

        { type: 'h2', id: 'platforms', text: 'React Native and Node.js' },
        {
            type: 'p',
            text: 'The same imports work in a React Native app on Android and iOS. Android packages build for API level 33: in an app with a lower `minSdkVersion`, a package that calls a newer libc function fails to link. iOS packages build for iOS 15.1, device and simulator; run `pod install` again after you change `packages.conan`.',
        },
        {
            type: 'p',
            text: 'A [Node.js addon](/guide/node/#addon) for macOS, Linux or Windows links the packages for its target, with the system libraries their recipes ask for. Their symbols stay inside the addon, so they never clash with the zlib and OpenSSL that Node.js exports.',
        },

        { type: 'h2', id: 'build', text: 'What a build does' },
        {
            type: 'p',
            text: 'ConanCenter publishes no binaries for these toolchains, so the first build of a package compiles it from source. Built packages stay in `~/.crossbind/conan/store`, shared by every project (`~/.crossbind/conan-local/store` for iOS, macOS and `RUNNER=LOCAL`). A target installs again only when `packages.conan`, the toolchain or `conan.lock` changes. A debug build links the release archives.',
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
            text: 'The first install writes `conan.lock` next to `crossbind.config.js`. It pins the version and recipe revision of every package: commit it. Later installs follow it; delete it to resolve every version again.',
        },

        { type: 'h2', id: 'typescript', text: 'TypeScript' },
        {
            type: 'p',
            text: 'Each `conan:` import is typed by a declaration in `.crossbind/conan/types/`, which `@crossbind/typescript-config` includes; a tsconfig with its own `include` needs `.crossbind/conan/types/**/*.d.ts` in it. The types list every function of the header, but only the ones you import are compiled in.',
        },

        { type: 'h2', id: 'licenses', text: 'Licenses' },
        {
            type: 'p',
            text: '`crossbind licenses` lists every Conan package of the build with its license, source and license texts. It reads what the last build installed, so on a fresh checkout build first ([CLI](/guide/cli/#licenses)).',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                'No WASI: Conan has no WASI target. While `packages.conan` declares a package, name your platforms with `-p` so `crossbind build` skips WASI.',
                "A recipe that does not build for Emscripten, the NDK, iOS, macOS, a Linux sysroot or llvm-mingw fails with Conan's own error; its options can often switch the failing part off.",
                "Web and React Native builds link a package's own archives only: the system libraries and Apple frameworks its recipe asks for are not added.",
                "A header binds as far as a port's does: C APIs bind, variadic functions when imported by name, templates do not.",
                'Packages come from ConanCenter only; another remote, or a login to one, is not supported.',
            ],
        },
    ],
};
