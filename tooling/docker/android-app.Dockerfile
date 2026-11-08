# syntax=docker/dockerfile:1

# Android apps: the android image, plus what packages an app's Gradle project offline - a JDK, the SDK platform and
# build tools, Gradle, and the Maven artifacts of the project crossbind writes - and Hermes for the app's host.
# linux/amd64 only, as android.

ARG BASE_IMAGE=crossbind/android:dev

FROM ${BASE_IMAGE} AS android-app

# The android image is non-root by default; installation is an image-build operation only.
USER root

RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# The platform and build tools as Google's repository2-3.xml lists them, unpacked where sdkmanager would put them,
# without it: as with the NDK, what lands here is exactly the reviewed bytes. The SHA-256 of each archive is derived
# from the byte-identical download after checking the published SHA-1.
ENV ANDROID_HOME=/opt/android-sdk
ARG PLATFORM=android-36
ARG PLATFORM_ARCHIVE=platform-36_r02.zip
ARG PLATFORM_SHA1=2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576
ARG PLATFORM_SHA256=37607369a28c5b640b3a7998868d45898ebcb777565a0e85f9acf36f29631d2e
# The build tools the Android Gradle plugin of android-app/ defaults to.
ARG BUILD_TOOLS=36.0.0
ARG BUILD_TOOLS_ARCHIVE=build-tools_r36_linux.zip
ARG BUILD_TOOLS_SHA1=b0b6376977657e8ad9b969bacf4093601da2c6fb
ARG BUILD_TOOLS_SHA256=5d9ac77fb6ff43d9da518a337b4fcf8f9097113df531d99ccefe80ef7ce8250b
RUN set -eu; \
    unpack() { \
        crossbind-download "https://dl.google.com/android/repository/$1" "/tmp/$1"; \
        echo "$2  /tmp/$1" | sha1sum -c -; \
        echo "$3  /tmp/$1" | sha256sum -c -; \
        mkdir -p /tmp/unpack "$(dirname "$4")"; \
        unzip -q "/tmp/$1" -d /tmp/unpack; \
        mv /tmp/unpack/* "$4"; \
        rmdir /tmp/unpack; \
        rm "/tmp/$1"; \
    }; \
    unpack "${PLATFORM_ARCHIVE}" "${PLATFORM_SHA1}" "${PLATFORM_SHA256}" "${ANDROID_HOME}/platforms/${PLATFORM}"; \
    unpack "${BUILD_TOOLS_ARCHIVE}" "${BUILD_TOOLS_SHA1}" "${BUILD_TOOLS_SHA256}" "${ANDROID_HOME}/build-tools/${BUILD_TOOLS}"; \
    cp "${ANDROID_HOME}/platforms/${PLATFORM}/data/NOTICE.txt" /opt/licenses/android-platform-NOTICE.txt; \
    cp "${ANDROID_HOME}/build-tools/${BUILD_TOOLS}/NOTICE.txt" /opt/licenses/android-build-tools-NOTICE.txt

# Published by services.gradle.org next to the distribution.
ARG GRADLE_VERSION=9.8.1
ARG GRADLE_SHA256=dce76f55f8e251a3a1f130eb120f30b3d271de2b76c9b0729d316b5a1b6dc01f
RUN set -eu; \
    crossbind-download "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" /tmp/gradle.zip; \
    echo "${GRADLE_SHA256}  /tmp/gradle.zip" | sha256sum -c -; \
    unzip -q /tmp/gradle.zip -d /opt; \
    mv "/opt/gradle-${GRADLE_VERSION}" /opt/gradle; \
    rm /tmp/gradle.zip; \
    cp /opt/gradle/LICENSE /opt/licenses/gradle-LICENSE; \
    cp /opt/gradle/NOTICE /opt/licenses/gradle-NOTICE
ENV PATH=/opt/gradle/bin:${PATH}

# The Maven artifacts of the project crossbind writes for an app, which android-app/ mirrors, resolved once into a
# read-only cache Gradle reads them from offline. Gradle checks each against the SHA-256 recorded in
# android-app/gradle/verification-metadata.xml, which `gradle --write-verification-metadata sha256` rewrites when the
# project's dependencies move. Hermes' AAR among them must be the one crossbind pins; its headers and libraries, with
# hermesc from the same release, are laid out for the app's host as on the other platforms. The host links the
# stripped libraries the app packages: the prefab copies keep their debug symbols, 60 MB each.
ARG HERMES_VERSION=250829098.0.17
ARG HERMES_ANDROID_SHA256=6fb440b29aadb5925bed1109338da61623c54c3508020bb2cecebcaaa80e53b8
ARG HERMES_COMPILER_SHA256=517f2a48812931f89fe6e6e8ab4b2b7335269cb502f41cd65d6d396703f60757
ARG HERMES_LICENSE_SHA256=da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93
COPY android-app /tmp/android-app
RUN set -eu; \
    export GRADLE_USER_HOME=/tmp/gradle-home ANDROID_USER_HOME=/tmp/android-home; \
    crossbind-retry-network gradle --no-daemon --console=plain -p /tmp/android-app assembleDebug assembleRelease bundleRelease; \
    mkdir -p /opt/gradle-ro-cache; \
    cp -R "${GRADLE_USER_HOME}/caches/modules-2" /opt/gradle-ro-cache/; \
    find /opt/gradle-ro-cache -name '*.lock' -delete; \
    rm -f /opt/gradle-ro-cache/modules-2/gc.properties; \
    aar="$(find /opt/gradle-ro-cache -name "hermes-android-${HERMES_VERSION}-release.aar")"; \
    echo "${HERMES_ANDROID_SHA256}  ${aar}" | sha256sum -c -; \
    hermes="/opt/crossbind/hermes/${HERMES_VERSION}/android"; \
    mkdir -p "${hermes}/bin" /tmp/aar; \
    unzip -q "${aar}" 'prefab/modules/hermesvm/include/*' 'jni/*' -d /tmp/aar; \
    mv /tmp/aar/prefab/modules/hermesvm/include "${hermes}/"; \
    for abi in /tmp/aar/jni/*; do \
        mkdir -p "${hermes}/libs/android.$(basename "${abi}")"; \
        mv "${abi}/libhermesvm.so" "${hermes}/libs/android.$(basename "${abi}")/"; \
    done; \
    crossbind-download "https://registry.npmjs.org/hermes-compiler/-/hermes-compiler-${HERMES_VERSION}.tgz" /tmp/hermes-compiler.tgz; \
    echo "${HERMES_COMPILER_SHA256}  /tmp/hermes-compiler.tgz" | sha256sum -c -; \
    tar -xzf /tmp/hermes-compiler.tgz -C /tmp package/hermesc/linux64-bin/hermesc; \
    install -m 0755 /tmp/package/hermesc/linux64-bin/hermesc "${hermes}/bin/hermesc"; \
    crossbind-download "https://raw.githubusercontent.com/facebook/hermes/hermes-v${HERMES_VERSION}/LICENSE" /opt/licenses/hermes-LICENSE; \
    echo "${HERMES_LICENSE_SHA256}  /opt/licenses/hermes-LICENSE" | sha256sum -c -; \
    rm -rf /tmp/android-app /tmp/aar /tmp/package /tmp/hermes-compiler.tgz "${GRADLE_USER_HOME}" "${ANDROID_USER_HOME}"

# Gradle's and the Android tools' mutable homes, as CARGO_HOME and CONAN_HOME are: writable by the host uid, which has
# no home of its own, and outside the read-only cache so a volume can take them over.
ENV GRADLE_RO_DEP_CACHE=/opt/gradle-ro-cache \
    GRADLE_USER_HOME=/var/cache/crossbind/gradle \
    ANDROID_USER_HOME=/var/cache/crossbind/android
RUN mkdir -p "${GRADLE_USER_HOME}" "${ANDROID_USER_HOME}" && chmod 0777 "${GRADLE_USER_HOME}" "${ANDROID_USER_HOME}"

WORKDIR /
USER 10001:10001
