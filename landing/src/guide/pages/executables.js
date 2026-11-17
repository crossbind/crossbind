import { CREATE_COMMAND, LIBRARIES_URL, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';
import { BIN_TARGET, publishedTarget, WASI_TOOL_PORTS } from '../../ports/catalog.js';

const tag = RELEASE.distTagSuffix;
const DESKTOP = ['linux', 'linuxmusl', 'darwin', 'win32'];
const MAX_LISTED_COMMANDS = 6;

const commandsOf = (port) => (port.binCommands.length > MAX_LISTED_COMMANDS
    ? `${port.binCommands.length} commands`
    : port.binCommands.map((command) => `\`${command}\``).join(', '));

const TOOL_ROWS = WASI_TOOL_PORTS.map((port) => [
    `[${port.name}](${LIBRARIES_URL}${port.family}/)`,
    `\`${publishedTarget(port, BIN_TARGET).package}\``,
    commandsOf(port),
]);

export default {
    slug: 'executables',
    title: 'Executables',
    description: 'Native executables, WASI commands, prebuilt command-line tools, and port archives in your own build.',
    lede: `For programs with no JavaScript host, crossbind links your \`main()\` and the ports it uses into a native executable for macOS, Linux and Windows, or a WASI command for wasmtime. You can also run the command-line tools of ${WASI_TOOL_PORTS.length} ports straight from npm, or link the ports' archives into a build of your own.`,
    blocks: [
        { type: 'h2', id: 'native', text: 'Native executables' },
        {
            type: 'p',
            text: '`-e native` links the `main(int, char**)` in `src/native` into an executable. A port joins through its desktop packages, one per platform you build:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install ${DESKTOP.map((platform) => `@crossbind/port-zlib-${platform}${tag}`).join(' \\\n    ')}
npm install --save-dev crossbind${tag}`,
        },
        {
            type: 'code',
            file: 'crossbind.config.mjs',
            code: `import zlibLinux from '@crossbind/port-zlib-linux/crossbind.config.js';
import zlibLinuxmusl from '@crossbind/port-zlib-linuxmusl/crossbind.config.js';
import zlibDarwin from '@crossbind/port-zlib-darwin/crossbind.config.js';
import zlibWin32 from '@crossbind/port-zlib-win32/crossbind.config.js';

export default {
    general: { name: 'mytool' },
    dependencies: [zlibLinux, zlibLinuxmusl, zlibDarwin, zlibWin32],
    paths: { config: import.meta.url, output: 'dist' },
};`,
        },
        {
            type: 'code',
            file: 'src/native/main.cpp',
            code: `#include <cstdio>
#include <zlib.h>

int main(int argc, char **argv) {
    printf("zlib %s, %d arguments\\n", zlibVersion(), argc - 1);
    return 0;
}`,
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx crossbind build -p host -e native -b release
./dist/mytool.linux-x64`,
        },
        {
            type: 'entries',
            items: [
                { name: '`linux`', text: 'Writes `dist/<name>.linux-<arch>`. Runs on glibc 2.28 or later and needs only libc, libm, libdl, libpthread and libgcc_s.' },
                { name: '`linuxmusl`', text: 'Writes `dist/<name>.linuxmusl-<arch>`, fully static: it runs on any Linux, musl or glibc.' },
                { name: '`darwin`', text: 'Writes `dist/<name>.darwin-<arch>`. Runs on macOS 11 or later.' },
                { name: '`win32`', text: 'Writes `dist/<name>.win32-<arch>.exe`, with the C++ runtime linked in. Runs on Windows 10 or later.' },
            ],
        },
        {
            type: 'p',
            text: '`<arch>` is `arm64` or `x64`; a debug build adds `.debug` before the extension. `-p host` builds this machine\'s platform for both; `-p linux,linuxmusl,darwin,win32` builds all four. Linux and Windows executables build in Docker, macOS ones only on a Mac with Xcode\'s command line tools.',
        },
        {
            type: 'ul',
            items: [
                'Your own archive links whole; a port\'s archive keeps only what `main` reaches.',
                'A port\'s data, such as `GDAL_DATA` and `proj.db`, is copied to `dist/data`, but nothing points the executable at it: set `GDAL_DATA` and `PROJ_DATA` before running it.',
                '`-e node,native` makes the addon and the executable from the same archives. A Rust package (`export.type: \'cargo\'`) makes no executable.',
                'An executable also carries toolchain code: LLVM\'s C++ runtime on Linux and Windows, parts of the mingw-w64 runtime on Windows and musl\'s C library in the musl build. `npx crossbind licenses --platform <platform> -e native --notices` writes their notices with the packages\'.',
            ],
        },

        { type: 'h2', id: 'wasi', text: 'WASI commands' },
        {
            type: 'p',
            text: '`-p wasi -e wasi` builds the same kind of program into a `wasm32-wasip3` command, with no JavaScript. It runs on a WASI 0.3 runtime with Wasm 3.0 exceptions, such as wasmtime 47 or newer. Ports link from their `-wasi` packages; the `-wasm` ones do not link here.',
        },
        {
            type: 'code',
            file: 'crossbind.config.mjs',
            code: `import projWasi from '@crossbind/port-proj-wasi/crossbind.config.js';

export default {
    general: { name: 'proj-tool' },
    dependencies: [projWasi],
    paths: { config: import.meta.url, output: 'dist' },
};`,
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx crossbind build -p wasi -e wasi -b release
wasmtime run --dir=. --env PROJ_DATA=dist/data/proj dist/proj-tool-wasi-wasm32-st-release.wasm info EPSG:2056`,
        },
        {
            type: 'p',
            text: 'The command and its dependencies\' `data/` folder land in `paths.output`. The program sees only the folders you preopen with `--dir` and the variables you pass with `--env`; sockets work once granted with `-S inherit-network=y -S allow-ip-name-lookup=y -S tcp=y`. [PROJ\'s page](/ports/proj/#wasi-program) has the whole program, and every library page ends with one like it.',
        },
        {
            type: 'p',
            text: 'The build runs in the `web` Docker image, which ships the wasi-sdk. To build on the host instead, point crossbind at a wasi-sdk 34 or newer with the `wasm32-wasip3` sysroot:',
        },
        { type: 'code', file: 'shell', code: 'CROSSBIND_RUNNER=LOCAL CROSSBIND_WASI_SDK_PATH=/opt/wasi-sdk npx crossbind build -p wasi -e wasi -b release' },
        {
            type: 'ul',
            items: [
                'Single-threaded: the WASI threads ABI is still in flux.',
                'No processes and no dynamic loading. What crossbind stubs out, such as the `dlopen` family, fails at run time instead of at instantiation.',
                'No Rust: there is no `wasm32-wasip3` Rust target yet.',
            ],
        },

        { type: 'h2', id: 'tools', text: 'Prebuilt tools on npm' },
        {
            type: 'p',
            text: 'Where an upstream project ships command-line tools, a `-standalone-wasi` package carries them prebuilt for `wasm32-wasip3`. Nothing compiles; wasmtime 47 or newer has to be on `PATH`:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install --global @crossbind/port-gdal-standalone-wasi${tag}
gdalinfo-wasi --version
ogr2ogr-wasi out.gpkg in.geojson`,
        },
        {
            type: 'p',
            text: `Each tool installs as \`<tool>-wasi\`, so it never shadows a native one. It sees only the current folder, so paths must be inside it. The data a package needs (such as GDAL's and PROJ's data and OpenSSL's CA bundle) and network access come set up. To run a tool without installing it: \`npx -p @crossbind/port-gdal-standalone-wasi${tag} gdal-wasi --version\`.`,
        },
        { type: 'table', head: ['Library', 'Package', 'Commands'], rows: TOOL_ROWS },
        {
            type: 'p',
            text: 'A package\'s npm `license` field covers everything linked into it, and the package ships the license texts, an SBOM and a provenance record of its build.',
        },

        { type: 'h2', id: 'archives', text: 'Prebuilt archives in your own build' },
        {
            type: 'p',
            text: 'Each desktop package, `@crossbind/port-<name>-<platform>` for `darwin`, `linux`, `linuxmusl` and `win32`, ships one install tree per architecture that a C or C++ build of your own can link:',
        },
        {
            type: 'code',
            file: 'layout',
            code: `dist/prebuilt/<platform>-<arch>-mt-release/
├── include/          headers
├── lib/              static archives, compiled position-independent
├── lib/pkgconfig/    pkg-config files
├── lib/cmake/        CMake package configs, where upstream installs them
└── share/            data such as GDAL_DATA and proj.db`,
        },
        {
            type: 'table',
            head: ['Platform', 'Built with', 'Runs on'],
            rows: [
                ['`linux`', 'clang 19 and a static libc++ 19, against Debian 10 packages', 'glibc 2.28 or later'],
                ['`linuxmusl`', 'clang 19 and a static libc++ 19, against Alpine packages', 'musl 1.2.5 or later'],
                ['`darwin`', 'Xcode\'s clang and the system libc++', 'macOS 11 or later'],
                ['`win32`', 'llvm-mingw', 'Windows 10 or later, through the Universal C Runtime'],
            ],
        },
        {
            type: 'ul',
            items: [
                '**pkg-config and CMake.** The pkg-config files work wherever the tree lands, but a package names its dependencies by library name only (`-lproj`), so put every dependency\'s `lib/pkgconfig` on `PKG_CONFIG_PATH` too. Where upstream installs CMake configs, point `CMAKE_PREFIX_PATH` at the tree.',
                '**C++ means libc++.** A package with C++ code, or one that links such a package, needs clang with `-stdlib=libc++`, and libc++ 19 or later on Linux: GEOS, PROJ and Lerc, and what links them, such as libtiff, libgeotiff, SpatiaLite and GDAL. C packages such as zlib, zstd, SQLite and Expat link with any compiler.',
                '**Data has to be pointed at.** Set `GDAL_DATA` and `PROJ_DATA` to the `share/gdal` and `share/proj` directories of their packages; the path compiled into the archives belongs to the machine that built them.',
            ],
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install @crossbind/port-geos-linux${tag}
GEOS=node_modules/@crossbind/port-geos-linux/dist/prebuilt/linux-x64-mt-release
export PKG_CONFIG_PATH=$GEOS/lib/pkgconfig
clang -c app.c $(pkg-config --cflags geos)
clang++ -stdlib=libc++ app.o -o app $(pkg-config --static --libs geos)`,
        },

        {
            type: 'p',
            text: `[examples/native-executable](${REPO_URL}/tree/main/examples/native-executable) is a complete program, a \`main()\` with a library linked in for every desktop platform, and \`${CREATE_COMMAND} -- my-tool Native Executable\` scaffolds it.`,
        },
    ],
};
