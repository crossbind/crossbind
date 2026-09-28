# syntax=docker/dockerfile:1

# Windows targets: native Node.js addons for x64 and arm64, cross-compiled by llvm-mingw against the
# Universal CRT every Windows 10 and 11 installation carries. The toolchain is the upstream release
# for this image's host architecture; nothing else of it runs here.

ARG BASE_IMAGE=crossbind/base:dev

FROM ${BASE_IMAGE} AS windows

# The base image is non-root by default; toolchain installation is an image-build operation only.
USER root

# nasm assembles libjpeg-turbo's x64 SIMD code.
RUN apt-get update && apt-get install -y --no-install-recommends nasm \
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
    wget -q "https://github.com/mstorsjo/llvm-mingw/releases/download/${LLVM_MINGW_VERSION}/${name}.tar.xz" -O /tmp/llvm-mingw.tar.xz; \
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

# Docker Desktop on macOS now and then fails coreutils' install; crossbind-install says how.
COPY --chmod=0755 crossbind-install /usr/local/bin/install

WORKDIR /
USER 10001:10001
