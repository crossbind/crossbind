#!/bin/bash
# Runs inside crossbind's web image, as root, with the package at /work: builds PCRE2 and SWIG as wasm64 and copies the
# headers em++ reads, so a Mac's clang makes the same macro table and the wasm SWIG the same bridges as the image.
set -euo pipefail
: "${SWIG_REV:?}" "${PCRE2_VERSION:?}" "${HOST_UID:?}" "${HOST_GID:?}"
OUT=/work/dist
B=/tmp/bridge-tools

# The image's own swig is built with Debian's bison, so its parser is the same.
apt-get update -qq
apt-get install -y -qq --no-install-recommends bison > /dev/null
rm -rf "$OUT" "$B"
mkdir -p "$B" "$OUT"
cd "$B"
python3 -c "import zipfile; zipfile.ZipFile('/work/.downloads/swig.zip').extractall('.')"
tar -xzf /work/.downloads/pcre2.tar.gz
chmod -R u+w "swig-$SWIG_REV"

emcmake cmake -S "pcre2-$PCRE2_VERSION" -B pcre2-build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DPCRE2_BUILD_PCRE2GREP=OFF -DPCRE2_BUILD_TESTS=OFF -DPCRE2_SUPPORT_JIT=OFF \
    -DCMAKE_C_FLAGS=-m64 -DCMAKE_INSTALL_PREFIX="$B/pcre2" > pcre2-cmake.log
cmake --build pcre2-build -j"$(nproc)" > pcre2-build.log
cmake --install pcre2-build > /dev/null

# wasm64 keeps long 64-bit, as SWIG's #if arithmetic takes it. Compiling synchronously lets a call run SWIG to its end
# before it returns, as crossbind's bridge steps are synchronous.
LINK="-m64 -sNODERAWFS -sEXIT_RUNTIME -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=8MB -sINVOKE_RUN=0 -sWASM_ASYNC_COMPILATION=0"
LINK="$LINK -sNODEJS_CATCH_EXIT=0 -sNODEJS_CATCH_REJECTION=0 -sEXPORTED_RUNTIME_METHODS=callMain,FS"
emcmake cmake -S "swig-$SWIG_REV" -B swig-build -DCMAKE_BUILD_TYPE=Release -DWITH_PCRE=ON \
    -DPCRE2_INCLUDE_DIR="$B/pcre2/include" -DPCRE2_LIBRARY="$B/pcre2/lib/libpcre2-8.a" \
    -DCMAKE_C_FLAGS=-m64 -DCMAKE_CXX_FLAGS=-m64 -DCMAKE_EXE_LINKER_FLAGS="$LINK" \
    -DCMAKE_INSTALL_PREFIX="$B/swig-install" > swig-cmake.log
cmake --build swig-build -j"$(nproc)" > swig-build.log
cmake --install swig-build > /dev/null

mkdir -p "$OUT/swig" "$OUT/emscripten" "$OUT/clang" "$OUT/licenses"
# Each call of the wrapped loader makes a new SWIG, as each run of the image's swig is a new process. Under node the
# loader takes its environment from process.env, sets process.exitCode and exports itself as module.exports: the caller
# hands it a process of its own, and module is shadowed.
{ echo 'module.exports = function createSwig(Module, process) {'; echo 'var module;'; cat swig-build/swig.js; printf 'return Module;\n};\n'; } \
    > "$OUT/swig/swig.cjs"
cp swig-build/swig.wasm "$OUT/swig/"
cp -R "$B/swig-install/share" "$OUT/swig/share"
cp -R /emsdk/upstream/emscripten/cache/sysroot/include "$OUT/emscripten/include"
cp -R /emsdk/upstream/lib/clang/*/include "$OUT/clang/include"
em++ -x c++ -std=c++17 -dM -E /dev/null > "$OUT/predefined.h"
em++ -x c++ -std=c++17 -E -v /dev/null 2>&1 \
    | sed -n '/#include <...> search starts here:/,/End of search list./p' | sed '1d;$d' | sed 's/^ *//' > "$OUT/include-order.txt"

cp "swig-$SWIG_REV/LICENSE" "$OUT/licenses/swig-LICENSE"
cp "swig-$SWIG_REV/LICENSE-GPL" "$OUT/licenses/swig-LICENSE-GPL"
cp "swig-$SWIG_REV/LICENSE-UNIVERSITIES" "$OUT/licenses/swig-LICENSE-UNIVERSITIES"
cp "swig-$SWIG_REV/COPYRIGHT" "$OUT/licenses/swig-COPYRIGHT"
cp "pcre2-$PCRE2_VERSION/LICENCE.md" "$OUT/licenses/pcre2-LICENCE.md"
cp /emsdk/upstream/emscripten/LICENSE "$OUT/licenses/emscripten-LICENSE"
cp /emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT "$OUT/licenses/musl-COPYRIGHT"
cp /emsdk/upstream/emscripten/system/lib/libcxx/LICENSE.TXT "$OUT/licenses/llvm-LICENSE.TXT"
printf '{"emscripten":"%s","musl":"%s","clang":"%s"}\n' \
    "$(em++ --version | head -1 | sed -E 's/.* ([0-9]+\.[0-9]+\.[0-9]+) .*/\1/')" \
    "$(cat /emsdk/upstream/emscripten/system/lib/libc/musl/VERSION)" \
    "$(basename "$(dirname "$(ls -d /emsdk/upstream/lib/clang/*/include)")")" > "$OUT/versions.json"
chown -R "$HOST_UID:$HOST_GID" "$OUT"
