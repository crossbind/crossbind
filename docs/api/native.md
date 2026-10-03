# Native platforms — `darwin`, `linux`, `linuxmusl`, `win32`

> The desktop platforms build Node.js addons (see [`nodejs.md`](../playbooks/integration/nodejs.md)). This page covers what else their output is good for, starting with the prebuilt archives of every `@crossbind/port-*` package in a C or C++ build that is not crossbind.

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
npm install @crossbind/port-geos-linux
GEOS=node_modules/@crossbind/port-geos-linux/dist/prebuilt/linux-x64-mt-release
export PKG_CONFIG_PATH=$GEOS/lib/pkgconfig
clang -c app.c $(pkg-config --cflags geos)
clang++ -stdlib=libc++ app.o -o app $(pkg-config --static --libs geos)
```

`pnpm e2e:linux` proves this for Linux: it compiles a small program against zlib with the stock gcc 8 of a glibc 2.28 image, and against GEOS with the clang 19 and libc++ 19 of Debian 13, each through the package's pkg-config file and from a different directory than the one it was built in. Before publishing, `pnpm check:publish` (rule K5) fails a package whose metadata still names the machine that built it.
