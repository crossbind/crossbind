<!-- GENERATED from docs/api/conan.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Conan — C and C++ packages from ConanCenter

> Import a C or C++ library from [ConanCenter](https://conan.io/center) the way you import a
> crate with `cargo:`: declare it, then name one of its headers. crossbind builds the package with
> its own toolchain, links it like a port and binds the header like any other. Web builds (wasm32
> and wasm64, `st` and `mt`), React Native on Android (arm64-v8a and x86_64) and iOS (arm64
> devices and simulators), and Node.js addons for Linux (glibc and musl), macOS and Windows, x64 and
> arm64.

## Requirement

Nothing to install for web, Android, Linux addon and Windows addon builds with the default Docker
runner: the toolchain images carry Conan 2.33 from image family 1.0.11 on. iOS and macOS packages
build on your Mac with Xcode whatever the runner, so those builds need Conan 2.19 or later and
CMake on the `PATH` (`brew install conan` or `brew upgrade conan`, or `pipx install conan`); a
Conan release older than your Xcode still takes its clang. The first build of a package needs the
network, to reach ConanCenter and the sources its recipe downloads. Under `RUNNER=LOCAL`, web
builds need Conan 2.19 or later, Emscripten and CMake on the `PATH`, and Android, Linux and Windows
packages are refused: they need the android image's NDK, the linux image's sysroots and the
windows image's llvm-mingw.

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

Your sources and their bridges compile with the defines a recipe declares for the code that uses
it (`cpp_info.defines`), on every target. libcurl's `CURL_STATICLIB`, for one, tells `curl.h` on
Windows that the library is linked in, not loaded from a DLL.

## React Native

The same imports work in a React Native app on Android and iOS, from JavaScript and from your own
headers. The native build installs the packages before Metro bundles the bridges, and a Metro
server started before that first build picks them up once they are staged. On Android, Metro reads
headers for arm64-v8a, so its packages are built even when the app builds x86_64 only.

Android packages are built for API level 33, as the ports are. In an app whose `minSdkVersion` is
lower, a package that calls a newer libc function fails to link, as such a port would.

iOS packages are built for the device and the simulator SDK, arm64 and iOS 15.1 like the ports,
and each library becomes an xcframework that the `react-native-crossbind` pod vendors. CocoaPods
links what it finds at `pod install`, so run `pod install` again after you change
`conanDependencies`.

## Node.js addons

A Node.js addon for Linux, macOS or Windows (`crossbind build -p linux -p linuxmusl -p darwin
-p win32 -e node`) links the packages too, and your own headers reach them as
[above](#through-your-own-header). Each addon links the packages built for its own target, with
the system libraries and Apple frameworks their recipes ask for (`system_libs`, `frameworks`);
glibc and musl builds share every Conan setting, so crossbind keeps them apart as packages of their
own. A package's symbols stay inside the addon, as a port's do: Node.js exports its own zlib and
OpenSSL, and the addon's copies do not trade calls with them.

`pnpm --filter @crossbind/e2e-backend-nodejs-native-conan e2e:prod` runs the fixture's glibc addon
on Debian, its musl addon on Alpine and its macOS addon on the host (after `build:darwin`), and
reads each Windows addon for the DLLs it loads and the symbols it exports; CI also runs the Windows
addons on x64 and arm64 Windows.

## What a build does

1. When a build starts (`buildStart` in Vite and Rollup, `beforeRun` and `watchRun` in Webpack and
   Rspack, `crossbind build`, the Gradle or Xcode build of a React Native app), crossbind runs
   `conan install` for every release target the build needs, with a profile crossbind writes from
   its own toolchain:
   - wasm, in the web image: the image's `emcc`, `-fwasm-exceptions -msimd128`, `-pthread` on
     `mt`, `-sMEMORY64=1` on wasm64;
   - Android, in the android image: its NDK through the NDK's own CMake toolchain, API level 33 and
     `c++_static`, as the ports' Android archives are built;
   - iOS, on your Mac: the clang and archive tools of `/Applications/Xcode.app` for the device and
     the simulator SDK, arm64, deployment target 15.1 and `libc++`, as the ports' iOS archives are
     built. Conan finds Xcode's `ar`, `nm`, `ranlib` and `strip` ahead of any on your `PATH`, such
     as Homebrew's binutils, whose GNU archives Apple's linker cannot read;
   - Linux addons, in the linux image: its clang wrappers through its CMake toolchain file for each
     triple, against the glibc 2.28 or musl sysroot, with `libc++`, `-fPIC` and `-pthread`, as the
     ports' Linux archives are built;
   - macOS addons, on your Mac: the clang `xcode-select` picks, for macOS 11.0, with `libc++` and
     `-pthread`, as the ports' macOS archives are built. CMake and pkg-config leave out the packages
     Homebrew and MacPorts installed, and the archive tools `xcode-select` picks come first on the
     `PATH`;
   - Windows addons, in the windows image: its llvm-mingw clang through its CMake toolchain file for
     each triple, with `libc++` and `-pthread`, as the ports' Windows archives are built.

   Every package is a static library.
2. ConanCenter publishes no binaries built with these toolchains, so each package builds from
   source the first time; zlib, libpng and fmt take seconds, or about half a minute in the android
   image, which runs emulated on Apple silicon. Built packages stay in `~/.crossbind/conan/store`,
   shared by every project, and any build with the same profile reuses them. Under `RUNNER=LOCAL`,
   and for iOS and macOS, the store is `~/.crossbind/conan-local/store`, apart from the one
   containers write to.
3. crossbind copies each package to `.crossbind/conan/packages/<package>/dist/prebuilt/<target>/`,
   the layout a port ships, and links it like one. A debug build links the release archives. For
   iOS, each library also gets an xcframework in `.crossbind/conan/packages/<package>/`.
4. A target is installed again only when its inputs change: `conanDependencies`, the toolchain
   (the image; on the host, `conan` with `emcc` under `RUNNER=LOCAL` or with Xcode's clang for
   iOS and macOS), crossbind's profile or `conan.lock`.

Each install writes Conan's whole log to `.crossbind/conan/logs/<target>.log`; a failed one also
prints the end of it.

A `crossbind build` that would also build for WASI fails while `conanDependencies` is declared;
leave it out with `-p`.

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
- A define a recipe declares for the code that uses it reaches your compile as one argument, and
  only as a plain name with a plain value (letters, digits and `_`, and `. + - / , :` in the value);
  any other is left out, with a notice.
- The store itself is shared and writable: a recipe built for one project can change what another
  project later takes from it, as a crate's build script can change cargo's registry cache. Delete
  `~/.crossbind/conan/store` to build every package again.
- With `RUNNER=DOCKER_EXEC`, conan runs in the long-lived container `crossbind docker create`
  made, which mounts your project for the other build steps.
- With `RUNNER=REMOTE`, conan runs on the runner of the package's image: the work directory
  travels, sources and build folders stay on the runner, and the built packages come back into
  the local store ([`remote-runner.md`](./remote-runner.md)).
- With `RUNNER=LOCAL`, and for iOS and macOS whatever the runner, recipes run on your machine with
  your permissions, like any other host build.

## `conan.lock`

The first install writes `conan.lock` next to `crossbind.config.js`. It pins the exact version and
recipe revision of every package, so commit it. Later installs follow it and add any requirement
it does not list yet; delete it to resolve every version again.

## Types

Each `conan:` import is typed by an ambient module, `declare module 'conan:zlib/zlib.h'`, under
`.crossbind/conan/types/`, which `@crossbind/typescript-config` includes (see
[`lifecycle-and-types.md`](./lifecycle-and-types.md)).

The declarations list every bindable function in the header, even before the app imports it.
Only the requested functions enter the compiled bridge; generating the editor's full catalog
does not add them to the runtime binary. Package `ignoredDeclarations` still apply.

## Licenses

`crossbind licenses` lists every Conan package of the build with the license its recipe declares
(a recipe's list as all of them, joined with `AND`), the source URL and SHA-256 the recipe
downloads, and the license texts the package ships. The SBOM
names it `pkg:conan/<package>@<version>`. It reads what the last build installed, so on a fresh
checkout build first; until then it stops with an error instead of leaving the packages out.

## Limits

- No WASI builds: Conan has no WASI target at all.
- A recipe that does not build for Emscripten, the NDK, iOS, macOS, a Linux sysroot or llvm-mingw
  fails the build with Conan's own error. The recipe's options can often switch the failing part off.
- Web and React Native builds link a package's own archives only: the system libraries and Apple
  frameworks its recipe asks for are not added, so a package that needs one there stops the build
  at its symbols.
- A header binds as far as a port's headers do ([`cpp-binding-rules.md`](./cpp-binding-rules.md)):
  C APIs bind; templates and variadic functions (`gzprintf`) do not.
- Packages come from ConanCenter only; another remote or a login to one is not supported.

## See also

- [`rust.md`](./rust.md) — the `cargo:` scheme this one mirrors.
- [`crossbind-config.md`](./crossbind-config.md) — `conanDependencies` next to the other fields.
- ADR-0013 — why the scheme, the declaration and the staging look the way they do.
