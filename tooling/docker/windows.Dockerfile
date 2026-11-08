# syntax=docker/dockerfile:1

# Windows targets: native Node.js addons and app hosts for x64 and arm64, cross-compiled by llvm-mingw against the
# Universal CRT every Windows 10 and 11 installation carries. The toolchain is the upstream release for this image's
# host architecture; nothing else of it runs here.

ARG BASE_IMAGE=crossbind/base:dev

FROM ${BASE_IMAGE} AS toolchains

# The base image is non-root by default; toolchain installation is an image-build operation only.
USER root

# nasm assembles libjpeg-turbo's x64 SIMD code; zip archives a Windows app, and nsis builds its installer.
RUN apt-get update && apt-get install -y --no-install-recommends nasm zip nsis \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
ARG LLVM_MINGW_VERSION=20260922
# The SHA-256 digests GitHub records for the two release assets.
ARG LLVM_MINGW_SHA256_AMD64=bb7bb7654b33d5aa8712acb837c963b2e0c56352560c76105270a3268c665c21
ARG LLVM_MINGW_SHA256_ARM64=07d21263c56bfe9a713db6fdb3f7434bf4c121a005e40397d3b4c0170fb06769
RUN set -eu; \
    case "${TARGETARCH}" in \
        amd64) host=x86_64; sha256="${LLVM_MINGW_SHA256_AMD64}";; \
        arm64) host=aarch64; sha256="${LLVM_MINGW_SHA256_ARM64}";; \
        *) exit 1;; \
    esac; \
    name="llvm-mingw-${LLVM_MINGW_VERSION}-ucrt-ubuntu-22.04-${host}"; \
    crossbind-download "https://github.com/mstorsjo/llvm-mingw/releases/download/${LLVM_MINGW_VERSION}/${name}.tar.xz" /tmp/llvm-mingw.tar.xz; \
    echo "${sha256}  /tmp/llvm-mingw.tar.xz" | sha256sum -c -; \
    tar -xf /tmp/llvm-mingw.tar.xz -C /opt; \
    mv "/opt/${name}" /opt/llvm-mingw; \
    rm /tmp/llvm-mingw.tar.xz; \
    # Only the x64 and arm64 targets are built here.
    rm -rf /opt/llvm-mingw/i686-w64-mingw32 /opt/llvm-mingw/armv7-w64-mingw32 /opt/llvm-mingw/bin/i686-w64-* /opt/llvm-mingw/bin/armv7-w64-*; \
    mkdir -p /opt/licenses/llvm-mingw; \
    cp /opt/llvm-mingw/LICENSE.TXT /opt/licenses/llvm-mingw/; \
    cp /opt/llvm-mingw/x86_64-w64-mingw32/share/mingw32/COPYING* /opt/licenses/llvm-mingw/

# One CMake toolchain file per target. The CRT is the system's own UCRT; everything else a program
# links (libc++, libunwind, winpthreads) is static, which crossbind asks for with -static.
RUN set -eu; \
    mkdir -p /opt/crossbind/windows; \
    for triple in x86_64-w64-mingw32 aarch64-w64-mingw32; do \
        case "${triple}" in x86_64-*) processor=AMD64;; aarch64-*) processor=ARM64;; esac; \
        bin="/opt/llvm-mingw/bin/${triple}"; \
        printf '%s\n' \
            'set(CMAKE_SYSTEM_NAME Windows)' \
            "set(CMAKE_SYSTEM_PROCESSOR ${processor})" \
            "set(CMAKE_C_COMPILER ${bin}-clang)" \
            "set(CMAKE_CXX_COMPILER ${bin}-clang++)" \
            "set(CMAKE_RC_COMPILER ${bin}-windres)" \
            "set(CMAKE_ASM_NASM_COMPILER /usr/bin/nasm)" \
            "set(CMAKE_AR ${bin}-ar)" \
            "set(CMAKE_RANLIB ${bin}-ranlib)" \
            "set(CMAKE_NM ${bin}-nm)" \
            "set(CMAKE_STRIP ${bin}-strip)" \
            "set(CMAKE_FIND_ROOT_PATH /opt/llvm-mingw/${triple})" \
            'set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)' \
            'set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)' \
            'set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)' \
            'set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)' \
            > "/opt/crossbind/windows/${triple}.cmake"; \
    done

# The stock stable std of both addon targets, for Rust packages and app-local Rust; the gnullvm
# targets are the ones built for llvm-mingw.
RUN rustup target add x86_64-pc-windows-gnullvm aarch64-pc-windows-gnullvm

# Docker Desktop on macOS now and then fails coreutils' install; crossbind-install says how.
COPY --chmod=0755 crossbind-install /usr/local/bin/install

# Hermes for the app hosts: the release crossbind pins (src/utils/hermes.js), built from its source as for Linux, with a
# hermesc for this machine and the VM for each Windows triple. Hermes chooses its Windows code by _WINDOWS, which MSVC
# projects define; it includes the SDK header as Windows.h, and llvh's Threading.inc finds WindowsSupport.h only where
# MSVC looks. Boost.Context has no GNU assembly for arm64 Windows and serves only StackExecutor, and llvh's call_once
# needs the two atomics Hermes leaves out.
FROM toolchains AS hermes

ARG HERMES_VERSION=250829098.0.17
ARG HERMES_SHA256=37e91915c67ce0c457f69b2de00fcaf28fcf755ab7de6e4f33f1d6ee9efcffed
COPY windows/llvh-atomic.cpp /tmp/llvh-atomic.cpp
RUN set -eu; \
    crossbind-download "https://github.com/facebook/hermes/archive/refs/tags/hermes-v${HERMES_VERSION}.tar.gz" /tmp/hermes.tar.gz; \
    echo "${HERMES_SHA256}  /tmp/hermes.tar.gz" | sha256sum -c -; \
    mkdir -p /src /tmp/compat; \
    tar -xzf /tmp/hermes.tar.gz -C /src --strip-components=1; \
    printf '%s\n' '#include <windows.h>' > /tmp/compat/Windows.h; \
    flags="-DCMAKE_BUILD_TYPE=Release -DHERMES_ENABLE_TEST_SUITE=OFF -DHERMES_ENABLE_INTL=OFF -DHERMES_UNICODE_LITE=ON -DHERMES_ENABLE_DEBUGGER=OFF"; \
    defines="-D_WINDOWS -D_USE_MATH_DEFINES"; \
    cmake -S /src -B /build/host -G "Unix Makefiles" ${flags}; \
    cmake --build /build/host --target hermesc shermes -- -j"$(nproc)"; \
    for pair in x64:x86_64-w64-mingw32 arm64:aarch64-w64-mingw32; do \
        triple="${pair#*:}"; \
        out="/opt/crossbind/hermes/${HERMES_VERSION}/win32-${pair%%:*}"; \
        cmake -S /src -B "/build/${triple}" -G "Unix Makefiles" ${flags} -DHERMES_ENABLE_TOOLS=OFF -DHERMES_ALLOW_BOOST_CONTEXT=0 \
            -DCMAKE_TOOLCHAIN_FILE="/opt/crossbind/windows/${triple}.cmake" -DCMAKE_C_FLAGS="${defines}" \
            -DCMAKE_CXX_FLAGS="${defines} -include exception -include type_traits -I/tmp/compat -I/src/external/llvh/lib/Support" \
            -DIMPORT_HOST_COMPILERS=/build/host/ImportHostCompilers.cmake; \
        cmake --build "/build/${triple}" --target hermesvm_a -- -j"$(nproc)"; \
        "/opt/llvm-mingw/bin/${triple}-clang++" -std=c++17 -O2 -c -I/src/external/llvh/include /tmp/llvh-atomic.cpp \
            -o "/build/${triple}/llvh-atomic.o"; \
        "/opt/llvm-mingw/bin/${triple}-ar" r "/build/${triple}/lib/libhermesvm_a.a" "/build/${triple}/llvh-atomic.o"; \
        mkdir -p "${out}/lib" "${out}/include/hermes" "${out}/include/jsi" "${out}/bin"; \
        cp "/build/${triple}/lib/libhermesvm_a.a" "${out}/lib/"; \
        (cd /src/API/hermes && find . -name '*.h' -exec cp --parents {} "${out}/include/hermes/" \;); \
        (cd /src/public/hermes && find . -name '*.h' -exec cp --parents {} "${out}/include/hermes/" \;); \
        cp /src/API/jsi/jsi/*.h "${out}/include/jsi/"; \
        cp /build/host/bin/hermesc "${out}/bin/"; \
    done; \
    cp /src/LICENSE /opt/licenses/hermes-LICENSE

FROM toolchains AS windows

COPY --from=hermes /opt/crossbind/hermes /opt/crossbind/hermes
COPY --from=hermes /opt/licenses/hermes-LICENSE /opt/licenses/hermes-LICENSE

# WebView2's SDK headers alone (BSD-3-Clause): an app's window loads the runtime the system has, so no loader DLL ships.
# WebView2.h includes the SDK's EventToken.h, whose mingw-w64 copy is eventtoken.h; crossbind_webview2.h names the
# runtime the SDK targets, which the host asks for.
ARG WEBVIEW2_VERSION=1.0.4258.31
ARG WEBVIEW2_SHA256=56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9
RUN set -eu; \
    crossbind-download "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2_VERSION}/microsoft.web.webview2.${WEBVIEW2_VERSION}.nupkg" /tmp/webview2.nupkg; \
    echo "${WEBVIEW2_SHA256}  /tmp/webview2.nupkg" | sha256sum -c -; \
    unzip -q /tmp/webview2.nupkg 'build/native/include/*' LICENSE.txt -d /tmp/webview2; \
    mkdir -p /opt/crossbind/webview2 /opt/licenses/webview2-sdk; \
    mv /tmp/webview2/build/native/include /opt/crossbind/webview2/include; \
    printf '%s\n' '#include <eventtoken.h>' > /opt/crossbind/webview2/include/EventToken.h; \
    version="$(sed -n 's/^#define CORE_WEBVIEW_TARGET_PRODUCT_VERSION //p' /opt/crossbind/webview2/include/WebView2EnvironmentOptions.h | tr -d '\r')"; \
    test -n "${version}"; \
    printf '#define CROSSBIND_WEBVIEW2_TARGET_VERSION %s\n' "${version}" > /opt/crossbind/webview2/include/crossbind_webview2.h; \
    cp /tmp/webview2/LICENSE.txt /opt/licenses/webview2-sdk/; \
    rm -rf /tmp/webview2 /tmp/webview2.nupkg

# jsign signs a Windows app, its uninstaller and its setup program with Authenticode, by whatever holds the key: a
# PKCS#12 file, a PKCS#11 token or a cloud's key service. Its release jar bundles what it uses, and Debian's OpenJDK
# runs it.
ARG JSIGN_VERSION=7.6
ARG JSIGN_SHA256=6cf58aa080e7ff82656f320cff8d4a3bff30408df8766806dcba3740dd839fa5
COPY windows/jsign-NOTICE /opt/licenses/jsign/NOTICE
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends openjdk-21-jre-headless; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /opt/jsign; \
    crossbind-download "https://repo1.maven.org/maven2/net/jsign/jsign/${JSIGN_VERSION}/jsign-${JSIGN_VERSION}.jar" /opt/jsign/jsign.jar; \
    echo "${JSIGN_SHA256}  /opt/jsign/jsign.jar" | sha256sum -c -; \
    printf '#!/bin/sh\nexec java -jar /opt/jsign/jsign.jar "$@"\n' > /usr/local/bin/jsign; \
    chmod 755 /usr/local/bin/jsign

WORKDIR /
USER 10001:10001
