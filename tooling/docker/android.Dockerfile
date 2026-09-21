# syntax=docker/dockerfile:1

# Android targets. linux/amd64 only: Google ships the Linux NDK host tools for x86_64 alone, so
# the CLI pins android builds to the amd64 leaf of this image even on Apple Silicon.

ARG BASE_IMAGE=crossbind/base:dev

FROM ${BASE_IMAGE} AS android

# The base image is non-root by default; NDK installation is an image-build operation only.
USER root

ENV NDK_VERSION=30.0.16248370
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV NDK_ROOT="${ANDROID_SDK_ROOT}/ndk/${NDK_VERSION}"

ARG NDK_ARCHIVE=android-ndk-r30-linux.zip
# The archive unpacks into its release name, which is not NDK_VERSION, so the tree is moved into
# the version-keyed path, and `ndk/current` points at it. Callers that name the stable path keep
# working across an NDK bump; one that names the version has to move in the same commit as the
# image, which it cannot, because the image is only published from main.
ARG NDK_ARCHIVE_ROOT=android-ndk-r30
# Published in Google's repository2-3.xml next to this exact archive.
ARG NDK_SHA1=5107f898313790e449e87eee2183d9a20602dee9
# Derived from the byte-identical archive after checking the Google-published SHA-1 above.
ARG NDK_SHA256=753611f410d002cfcd3f3dc2ef49aad532089d3180b436c060a90bf0fcb64df2
# The NDK ships as one self-contained archive, so this image needs no JDK, no command-line tools
# and no sdkmanager: what lands here is exactly the reviewed bytes. Installing through sdkmanager
# would hand the unpacking to a separately versioned tool fetched at build time.
RUN wget -q "https://dl.google.com/android/repository/${NDK_ARCHIVE}" -P /tmp && \
    echo "${NDK_SHA1}  /tmp/${NDK_ARCHIVE}" | sha1sum -c - && \
    echo "${NDK_SHA256}  /tmp/${NDK_ARCHIVE}" | sha256sum -c - && \
    mkdir -p "${ANDROID_SDK_ROOT}/ndk" && \
    unzip -q "/tmp/${NDK_ARCHIVE}" -d "${ANDROID_SDK_ROOT}/ndk" && \
    mv "${ANDROID_SDK_ROOT}/ndk/${NDK_ARCHIVE_ROOT}" "${NDK_ROOT}" && \
    ln -s "${NDK_VERSION}" "${ANDROID_SDK_ROOT}/ndk/current" && \
    rm "/tmp/${NDK_ARCHIVE}"

# The NDK's bundled Python carries setuptools 65.5.0 with fixable HIGH CVEs; nothing in the NDK
# imports setuptools or pkg_resources, so drop them rather than ship a patched copy.
RUN set -eu; \
    site="$(ls -d "${NDK_ROOT}"/toolchains/llvm/prebuilt/linux-x86_64/python3/lib/python3.*/site-packages)"; \
    rm -rf "${site}"/setuptools "${site}"/setuptools-*.dist-info "${site}"/pkg_resources "${site}"/_distutils_hack "${site}"/distutils-precedence.pth; \
    test ! -e "${site}/setuptools"

# Stock stable target stds - no bootstrap, unlike the emscripten MT sysroot.
RUN rustup target add aarch64-linux-android x86_64-linux-android

RUN cp "${NDK_ROOT}/NOTICE" /opt/licenses/ndk-NOTICE && \
    cp "${NDK_ROOT}/NOTICE.toolchain" /opt/licenses/ndk-NOTICE.toolchain

WORKDIR /
USER 10001:10001
