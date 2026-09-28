# syntax=docker/dockerfile:1

# Linux targets: native Node.js addons for x86_64 and aarch64. clang cross-compiles both from either
# host against glibc 2.28 sysroots made of Debian 10 packages - the baseline Node's own Linux builds
# require - and links LLVM's libc++, built here against the same sysroots. An addon built in this
# image therefore loads wherever glibc 2.28 or newer does, whichever distribution runs it.

ARG BASE_IMAGE=crossbind/base:dev

# The sysroots and libc++ are the same bytes for both image leaves, so they are assembled once on
# the build platform.
FROM --platform=$BUILDPLATFORM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a AS sysroots

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        clang-19 \
        cmake \
        lld-19 \
        llvm-19 \
        ninja-build \
        python3 \
        wget \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# buster left the mirrors for Debian's archive, which keeps its pool. Every package is checked
# against the SHA-256 of the signed Packages index, recorded in linux-sysroot.txt.
ARG DEBIAN_ARCHIVE=http://archive.debian.org/debian
COPY linux-sysroot.txt /tmp/linux-sysroot.txt
RUN set -eu; \
    grep -v -e '^#' -e '^$' /tmp/linux-sysroot.txt | while read -r arch pool sha256; do \
        case "${arch}" in amd64) triple=x86_64-linux-gnu;; arm64) triple=aarch64-linux-gnu;; *) exit 1;; esac; \
        deb="/tmp/$(basename "${pool}")"; \
        wget -q "${DEBIAN_ARCHIVE}/${pool}" -O "${deb}"; \
        echo "${sha256}  ${deb}" | sha256sum -c -; \
        mkdir -p "/opt/crossbind/sysroots/${triple}"; \
        dpkg-deb -x "${deb}" "/opt/crossbind/sysroots/${triple}"; \
        rm "${deb}"; \
    done; \
    for root in /opt/crossbind/sysroots/*; do \
        # gcc-8-base carries the copyright of the GCC runtime packages, whose doc directories link to it.
        find "${root}/usr/share/doc" -mindepth 2 -maxdepth 2 -name copyright -type f | while read -r copyright; do \
            package="$(basename "$(dirname "${copyright}")")"; \
            mkdir -p "/opt/licenses/linux-sysroot/$(basename "${root}")"; \
            cp "${copyright}" "/opt/licenses/linux-sysroot/$(basename "${root}")/${package}-copyright"; \
        done; \
        rm -rf "${root}/usr/share" "${root}/etc" "${root}/sbin" "${root}/usr/bin" "${root}/usr/sbin" "${root}/usr/lib/"*/gconv; \
        # An absolute link would resolve into this image's own, newer glibc.
        find "${root}" -type l | while read -r link; do \
            target="$(readlink "${link}")"; \
            case "${target}" in /*) ln -sfn "$(realpath -m --relative-to="$(dirname "${link}")" "${root}${target}")" "${link}";; esac; \
        done; \
    done

# libc++ against the glibc 2.28 headers, not Debian's own build of it: that one follows trixie's
# glibc and references symbols a glibc 2.28 system does not have. Static and hermetic, so the
# addon keeps its copy private instead of exporting it into the node process.
ARG LLVM_VERSION=19.1.7
# The release tarball, whose signature verifies against the LLVM release key D574BD5D1D0E98895E3BF90044F2485E45D59042.
ARG LLVM_SHA256=82401fea7b79d0078043f7598b835284d6650a75b93e64b6f761ea7b63097501
RUN set -eu; \
    wget -q "https://github.com/llvm/llvm-project/releases/download/llvmorg-${LLVM_VERSION}/llvm-project-${LLVM_VERSION}.src.tar.xz" -O /tmp/llvm.tar.xz; \
    echo "${LLVM_SHA256}  /tmp/llvm.tar.xz" | sha256sum -c -; \
    mkdir /src; \
    tar -xf /tmp/llvm.tar.xz -C /src --strip-components=1 --wildcards \
        '*/runtimes' '*/libcxx' '*/libcxxabi' '*/libc' '*/llvm/cmake' '*/llvm/utils' '*/cmake' '*/third-party'; \
    rm /tmp/llvm.tar.xz; \
    for triple in x86_64-linux-gnu aarch64-linux-gnu; do \
        root="/opt/crossbind/sysroots/${triple}"; \
        cmake -G Ninja -S /src/runtimes -B "/build/${triple}" \
            -DLLVM_ENABLE_RUNTIMES='libcxx;libcxxabi' \
            -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_SYSTEM_NAME=Linux \
            -DCMAKE_SYSTEM_PROCESSOR="${triple%%-*}" \
            -DCMAKE_C_COMPILER=clang-19 \
            -DCMAKE_CXX_COMPILER=clang++-19 \
            -DCMAKE_C_COMPILER_TARGET="${triple}" \
            -DCMAKE_CXX_COMPILER_TARGET="${triple}" \
            -DCMAKE_SYSROOT="${root}" \
            -DCMAKE_AR=/usr/bin/llvm-ar-19 \
            -DCMAKE_RANLIB=/usr/bin/llvm-ranlib-19 \
            -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
            -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
            -DCMAKE_INSTALL_PREFIX="${root}/usr" \
            -DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF \
            -DLIBCXX_ENABLE_SHARED=OFF \
            -DLIBCXXABI_ENABLE_SHARED=OFF \
            -DLIBCXX_ENABLE_STATIC_ABI_LIBRARY=ON \
            -DLIBCXXABI_USE_LLVM_UNWINDER=OFF \
            -DLIBCXX_HERMETIC_STATIC_LIBRARY=ON \
            -DLIBCXXABI_HERMETIC_STATIC_LIBRARY=ON \
            -DLIBCXX_INCLUDE_TESTS=OFF \
            -DLIBCXXABI_INCLUDE_TESTS=OFF \
            -DLIBCXX_INCLUDE_BENCHMARKS=OFF \
            -DLIBCXX_INSTALL_MODULES=OFF; \
        ninja -C "/build/${triple}" install; \
    done; \
    mkdir -p /opt/licenses/linux-sysroot; \
    cp /src/libcxx/LICENSE.TXT /opt/licenses/linux-sysroot/libcxx-LICENSE.TXT

FROM ${BASE_IMAGE} AS linux

# The base image is non-root by default; toolchain installation is an image-build operation only.
USER root

# Debian's clang drives both targets; nasm assembles libjpeg-turbo's x86_64 SIMD code.
RUN apt-get update && apt-get install -y --no-install-recommends clang-19 lld-19 llvm-19 nasm \
    && rm -rf /var/lib/apt/lists/*

COPY --from=sysroots /opt/crossbind/sysroots /opt/crossbind/sysroots
COPY --from=sysroots /opt/licenses/linux-sysroot /opt/licenses/linux-sysroot

# One compiler pair and one CMake toolchain file per target. Every C++ link takes libc++ statically.
RUN set -eu; \
    mkdir -p /opt/crossbind/linux/bin; \
    for triple in x86_64-linux-gnu aarch64-linux-gnu; do \
        root="/opt/crossbind/sysroots/${triple}"; \
        bin="/opt/crossbind/linux/bin/${triple}"; \
        flags="--target=${triple} --sysroot=${root} -fuse-ld=lld -Wno-unused-command-line-argument"; \
        printf '#!/bin/sh\nexec /usr/lib/llvm-19/bin/clang %s "$@"\n' "${flags}" > "${bin}-clang"; \
        printf '#!/bin/sh\nexec /usr/lib/llvm-19/bin/clang++ %s -stdlib=libc++ -static-libstdc++ "$@"\n' "${flags}" > "${bin}-clang++"; \
        chmod 0755 "${bin}-clang" "${bin}-clang++"; \
        for tool in ar ranlib nm strip objcopy; do ln -s "/usr/lib/llvm-19/bin/llvm-${tool}" "${bin}-${tool}"; done; \
        printf '%s\n' \
            'set(CMAKE_SYSTEM_NAME Linux)' \
            "set(CMAKE_SYSTEM_PROCESSOR ${triple%%-*})" \
            "set(CMAKE_SYSROOT ${root})" \
            "set(CMAKE_C_COMPILER ${bin}-clang)" \
            "set(CMAKE_CXX_COMPILER ${bin}-clang++)" \
            "set(CMAKE_ASM_NASM_COMPILER /usr/bin/nasm)" \
            "set(CMAKE_AR ${bin}-ar)" \
            "set(CMAKE_RANLIB ${bin}-ranlib)" \
            "set(CMAKE_NM ${bin}-nm)" \
            "set(CMAKE_STRIP ${bin}-strip)" \
            "set(CMAKE_OBJCOPY ${bin}-objcopy)" \
            '# Every archive ends up inside a loadable .node module.' \
            'set(CMAKE_POSITION_INDEPENDENT_CODE ON)' \
            'set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)' \
            'set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)' \
            'set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)' \
            'set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)' \
            > "/opt/crossbind/linux/${triple}.cmake"; \
    done

# Docker Desktop on macOS now and then fails coreutils' install; crossbind-install says how.
COPY --chmod=0755 crossbind-install /usr/local/bin/install

WORKDIR /
USER 10001:10001
