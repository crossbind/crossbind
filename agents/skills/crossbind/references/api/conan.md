<!-- GENERATED from docs/api/conan.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Conan — C and C++ packages from ConanCenter

> Import a C or C++ library from [ConanCenter](https://conan.io/center) the way you import a
> crate with `cargo:`: declare it, then name one of its headers. crossbind builds the package with
> its own toolchain, links it like a port and binds the header like any other. Web builds (wasm32
> and wasm64, `st` and `mt`) and React Native on Android (arm64-v8a and x86_64) for now.

## Requirement

Nothing to install with the default Docker runner: the toolchain images carry Conan 2.33 from
image family 1.0.11 on. The first build of a package needs the network, to reach ConanCenter and
the sources its recipe downloads. Under `RUNNER=LOCAL`, Conan 2.19 or later, Emscripten and CMake
have to be on the `PATH`, and only web builds work: Android packages need the android image's NDK.

## Declare, then import

```js
// crossbind.config.js — top level, next to `dependencies`
conanDependencies: {
  zlib: '1.3.2',
  libpng: '[>=1.6 <2]',
  sqlite3: { version: '3.53.4', options: { enable_fts5: true } },
},
```

```js
import { initNative, zlibVersion, compressBound } from 'conan:zlib/zlib.h';
import { png_access_version_number } from 'conan:libpng/png.h';

await initNative();
zlibVersion(); // '1.3.2'
```

- A key is the Conan package name. Its value is a version, a Conan version range, or
  `{ version, options }` with options the recipe defines.
- `conan:<package>/<header>` names a header under the package's include directory,
  subdirectories included: `conan:libxml2/libxml/parser.h`.
- Importing a package that `conanDependencies` does not declare is a hard error. A package that
  another one requires (zlib under libpng) is built and linked either way, and importable once it
  is declared.
- `shared` is not an option you can set: every package links statically into the module.

## Through your own header

The include directories of every Conan package are on your native sources' include path, so a
header of your own can use any of them, C++ libraries included. It is also the way to reach what a
header cannot bind on its own, such as templates, header-only libraries and variadic functions:

```cpp
// src/native/text.h
#include <string>
#include <fmt/format.h>

class Text {
public:
    static std::string price(double value) { return fmt::format("{:.2f}", value); }
};
```

```js
import { initNative, Text } from './native/text.h';
```

C++ exceptions cross between your code and a Conan package: an `fmt::format_error` thrown inside
libfmt reaches your `catch`.

## React Native

On Android the same imports work in a React Native app, from JavaScript and from your own headers.
The Gradle build installs the packages before Metro bundles the bridges, and a Metro server started
before that first build picks them up once they are staged. Metro reads headers for arm64-v8a, so
its packages are built even when the app builds x86_64 only. iOS is not wired yet: an app that
declares `conanDependencies` stops its iOS build with an error.

Android packages are built for API level 33, as the ports are. In an app whose `minSdkVersion` is
lower, a package that calls a newer libc function fails to link, as such a port would.

## What a build does

1. When a build starts (`buildStart` in Vite and Rollup, `beforeRun` and `watchRun` in Webpack and
   Rspack, `crossbind build`, the Gradle build of a React Native app), crossbind runs
   `conan install` for every release target the build needs, with a profile crossbind writes from
   its own toolchain:
   - wasm, in the web image: the image's `emcc`, `-fwasm-exceptions -msimd128`, `-pthread` on
     `mt`, `-sMEMORY64=1` on wasm64;
   - Android, in the android image: its NDK through the NDK's own CMake toolchain, API level 33 and
     `c++_static`, as the ports' Android archives are built.

   Every package is a static library.
2. ConanCenter publishes no WebAssembly or Android binaries, so each package builds from source the
   first time; zlib, libpng and fmt take seconds, or about half a minute in the android image, which
   runs emulated on Apple silicon. Built packages stay in `~/.crossbind/conan/store`, shared by
   every project, and any build with the same profile reuses them. Under `RUNNER=LOCAL` the store is
   `~/.crossbind/conan-local/store`, apart from the one containers write to.
3. crossbind copies each package to `.crossbind/conan/packages/<package>/dist/prebuilt/<target>/`,
   the layout a port ships, and links it like one. A debug build links the release archives.
4. A target is installed again only when its inputs change: `conanDependencies`, the toolchain
   (the image, or the host's `emcc` and `conan` under `RUNNER=LOCAL`), crossbind's profile or
   `conan.lock`.

Each install writes Conan's whole log to `.crossbind/conan/logs/<target>.log`; a failed one also
prints the end of it.

A `crossbind build` that would also build for iOS, WASI or a Node.js addon fails while
`conanDependencies` is declared; pass `-p wasm` or `-p android`.

## What a recipe can reach

A recipe is Python, and it runs the package's own build system. crossbind keeps that away from
everything else:

- Every `conan install` gets a work directory and a Conan home of its own, both deleted when it
  ends. Plugins, hooks, remotes or settings a recipe writes there never reach the next install, and
  no remote login carries over: packages come from ConanCenter, Conan's default remote.
- With the default `RUNNER=DOCKER_RUN`, the container sees the package store and that work
  directory, not your project. What it reports back is checked before anything is copied: names
  and library names must be plain names, and every path, links followed, must stay inside the
  package's own folder in the store.
- The store itself is shared and writable: a recipe built for one project can change what another
  project later takes from it, as a crate's build script can change cargo's registry cache. Delete
  `~/.crossbind/conan/store` to build every package again.
- With `RUNNER=DOCKER_EXEC`, conan runs in the long-lived container `crossbind docker create`
  made, which mounts your project for the other build steps.
- With `RUNNER=LOCAL`, recipes run on your machine with your permissions, like any other host
  build.

## `conan.lock`

The first install writes `conan.lock` next to `crossbind.config.js`. It pins the exact version and
recipe revision of every package, so commit it. Later installs follow it and add any requirement
it does not list yet; delete it to resolve every version again.

## Types

Each `conan:` import is typed by an ambient module, `declare module 'conan:zlib/zlib.h'`, under
`.crossbind/conan/types/`, which `@crossbind/typescript-config` includes (see
[`lifecycle-and-types.md`](./lifecycle-and-types.md)).

## Licenses

`crossbind licenses` lists every Conan package of the build with the license its recipe declares
(a recipe's list as all of them, joined with `AND`), the source URL and SHA-256 the recipe
downloads, and the license texts the package ships. The SBOM
names it `pkg:conan/<package>@<version>`. It reads what the last build installed, so on a fresh
checkout build first; until then it stops with an error instead of leaving the packages out.

## Limits

- Web and Android builds only. Conan has no WASI target at all; iOS and Node.js addons are not
  wired yet.
- A recipe that does not build for Emscripten or the NDK fails the build with Conan's own error.
  The recipe's options can often switch the failing part off.
- A header binds as far as a port's headers do ([`cpp-binding-rules.md`](./cpp-binding-rules.md)):
  C APIs bind; templates and variadic functions (`gzprintf`) do not.
- Packages come from ConanCenter only; another remote or a login to one is not supported.

## See also

- [`rust.md`](./rust.md) — the `cargo:` scheme this one mirrors.
- [`crossbind-config.md`](./crossbind-config.md) — `conanDependencies` next to the other fields.
- ADR-0013 — why the scheme, the declaration and the staging look the way they do.
