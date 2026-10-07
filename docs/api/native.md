# Native platforms — `darwin`, `linux`, `linuxmusl`, `win32`

> The desktop platforms build Node.js addons (see [`nodejs.md`](../playbooks/integration/nodejs.md)). This page covers what else their output is good for: native executables, and the prebuilt archives of every `@crossbind/port-*` package in a C or C++ build that is not crossbind.

## Native executables

`-e native` links the project's `main()` into an executable where `-e node` would link an addon:

```bash
crossbind build -p linux,linuxmusl,darwin,win32 -e native -b release
./dist/<name>.linux-x64 arg1
```

`-p host` builds only this machine's platform: `darwin` on macOS, `win32` on Windows, and on Linux `linux` or `linuxmusl` by the C library Node.js runs on.

| Platform | Output | Runs on |
|---|---|---|
| `linux` | `dist/<name>.linux-<arch>` | glibc 2.28 or later; it needs libc, libm, libdl, libpthread and libgcc_s only |
| `linuxmusl` | `dist/<name>.linuxmusl-<arch>` | any Linux, musl or glibc: the executable is fully static |
| `darwin` | `dist/<name>.darwin-<arch>` | macOS 11 or later |
| `win32` | `dist/<name>.win32-<arch>.exe` | Windows 10 or later, with the C++ runtime linked in |

A debug build (`-b debug`) adds `.debug` before the extension.

- `src/native` provides `main(int, char**)`. The project's own archive is linked whole; dependency archives keep only what `main` reaches. `binary.addonFlags` adds the system libraries a package needs, as it does for the addon.
- There are no bindings, so no SWIG bridge: a macOS executable builds with Xcode alone, while Linux and Windows executables build in the same toolchain images as the addons.
- A port's data, such as `GDAL_DATA` and `proj.db`, is copied to `dist/data`, but nothing points the executable at it: set `GDAL_DATA` and `PROJ_DATA` before running it.
- `-e node,native` makes the addon and the executable from the same archives. Rust packages (`export.type: 'cargo'`) make no executable.

`npm create crossbind@beta -- <dir> Native Executable` scaffolds a project whose `main()` links a library, from `examples/native-executable`.

`pnpm --filter @crossbind/e2e-cli-native e2e:prod` runs the fixture's executable on Debian 10, its static musl build on Alpine and on Debian 13, and its macOS build on the host; the Windows build is checked for the machine it targets, not run.

## Prebuilt archives in your own build

Each `@crossbind/port-<name>-<platform>` package ships one install tree per architecture:

```
dist/prebuilt/<platform>-<arch>-mt-release/
├── include/          headers
├── lib/              static archives, compiled position-independent
├── lib/pkgconfig/    pkg-config files
├── lib/cmake/        CMake package configs, where upstream installs them
└── share/            data such as GDAL_DATA and proj.db
```

| Platform | Built with | Runs on |
|---|---|---|
| `linux` | clang 19 and a static libc++ 19, against Debian 10 packages | glibc 2.28 or later |
| `linuxmusl` | clang 19 and a static libc++ 19, against Alpine packages | musl 1.2.5 or later |
| `darwin` | Xcode's clang and the system libc++ | macOS 11 or later |
| `win32` | llvm-mingw | Windows 10 or later, through the Universal C Runtime |

Link them with a toolchain of the same kind. Three rules cover the rest:

- **The metadata finds the tree wherever it lands.** pkg-config files resolve through `${pcfiledir}`, `*-config` scripts work out their prefix from their own location, and libtool `.la` files are not shipped. A package names its dependencies by library name only (`-lproj`), so put the `lib/pkgconfig` directory of every dependency package on `PKG_CONFIG_PATH` as well. Where upstream installs CMake package configs, `CMAKE_PREFIX_PATH` pointing at the tree finds them.
- **C++ means libc++.** Every crossbind toolchain builds C++ against LLVM's libc++, and the metadata says `-lc++` even where an upstream template says `-lstdc++`. A package that contains C++ code, or links one that does, needs clang with `-stdlib=libc++`, and on Linux libc++ 19 or later: GEOS, PROJ and Lerc, and everything that links them, such as libtiff, libgeotiff, SpatiaLite and GDAL. C packages such as zlib, zstd, SQLite and Expat link with any compiler.
- **Data has to be pointed at.** GDAL and PROJ read their data from `GDAL_DATA` and `PROJ_DATA`; set them to the `share/gdal` and `share/proj` directories of their packages. The data path compiled into the archives belongs to the machine that built them.

```bash
npm install @crossbind/port-geos-linux@beta
GEOS=node_modules/@crossbind/port-geos-linux/dist/prebuilt/linux-x64-mt-release
export PKG_CONFIG_PATH=$GEOS/lib/pkgconfig
clang -c app.c $(pkg-config --cflags geos)
clang++ -stdlib=libc++ app.o -o app $(pkg-config --static --libs geos)
```

`pnpm e2e:linux` proves this for Linux: it compiles a small program against zlib with the stock gcc 8 of a glibc 2.28 image, and against GEOS with the clang 19 and libc++ 19 of Debian 13, each through the package's pkg-config file and from a different directory than the one it was built in. Before publishing, `pnpm check:publish` (rule K5) fails a package whose metadata still names the machine that built it.
