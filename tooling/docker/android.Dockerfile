# syntax=docker/dockerfile:1

# Android targets. linux/amd64 only: Google ships the Linux NDK host tools for x86_64 alone, so
# the CLI pins android builds to the amd64 leaf of this image even on Apple Silicon.

ARG BASE_IMAGE=crossbind/base:dev

FROM ${BASE_IMAGE} AS android

# The base image is non-root by default; SDK installation is an image-build operation only.
USER root

RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

ENV NDK_VERSION=27.3.13750724
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV NDK_ROOT="${ANDROID_SDK_ROOT}/ndk/${NDK_VERSION}"

ARG CMDLINE_TOOLS=commandlinetools-linux-15859902_latest.zip
# Published in Google's repository2-3.xml next to this exact archive.
ARG CMDLINE_TOOLS_SHA1=040d3996a65543d22ec4bf73e4c37aa37a8d4af4
# Derived from the byte-identical archive after checking the Google-published SHA-1 above.
ARG CMDLINE_TOOLS_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
# This cmdline-tools release warns that sdkmanager is deprecated, but Google still documents it
# for deterministic SDK package installation and recommends a specific cmdline-tools revision in
# scripts. Android CLI is a separately distributed, independently moving tool.
RUN wget -q "https://dl.google.com/android/repository/${CMDLINE_TOOLS}" -P /tmp && \
    echo "${CMDLINE_TOOLS_SHA1}  /tmp/${CMDLINE_TOOLS}" | sha1sum -c - && \
    echo "${CMDLINE_TOOLS_SHA256}  /tmp/${CMDLINE_TOOLS}" | sha256sum -c - && \
    unzip -q "/tmp/${CMDLINE_TOOLS}" -d /tmp && \
    yes | /tmp/cmdline-tools/bin/sdkmanager --sdk_root=${ANDROID_SDK_ROOT} --licenses && \
    /tmp/cmdline-tools/bin/sdkmanager --sdk_root=${ANDROID_SDK_ROOT} --install "ndk;${NDK_VERSION}" && \
    rm -r "/tmp/${CMDLINE_TOOLS}" /tmp/cmdline-tools && \
    mkdir -p /root/.android/ && touch /root/.android/repositories.cfg

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
