# syntax=docker/dockerfile:1

# The common layer of the crossbind image family: host build tools, Node and the pinned Rust
# toolchain. Nothing above Debian is inherited. Node and (in web.Dockerfile) Emscripten are copied
# out of digest-pinned upstream images. Rust is installed as an exact release by the rustup shipped
# in a digest-pinned upstream image; the point-release Docker tag can lag the Rust release itself.
# The runtime layout - PATH, Node version, CARGO_HOME, cache permissions - is ours to guarantee.

ARG RUST_VERSION=1.99.0

FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS node
FROM rust:1.98.1-slim@sha256:4cd829461bd5c4d511c32e269da9cb8929223b666519d8004e35fc8d1d771ab7 AS rust
ARG RUST_VERSION
# Only the pinned toolchain may survive: /opt/licenses/rust is copied through a toolchains/* glob.
RUN set -eu; \
    rustup toolchain install "${RUST_VERSION}" --profile minimal --no-self-update; \
    rustup default "${RUST_VERSION}"; \
    rustup toolchain list | cut -d' ' -f1 | while read -r toolchain; do \
        case "${toolchain}" in "${RUST_VERSION}"-*) continue;; esac; \
        rustup toolchain uninstall "${toolchain}"; \
    done; \
    test "$(rustup toolchain list | wc -l)" -eq 1; \
    test "$(rustc -vV | sed -n 's/^release: //p')" = "${RUST_VERSION}"

FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS os

# A digest-pinned base keeps the package versions it shipped with, so patched ones are pulled in
# explicitly; --with-new-pkgs lets a security fix bring a new dependency without removing anything.
RUN apt-get update && apt-get upgrade -y --with-new-pkgs && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        file \
        git \
        libpcre2-8-0 \
        make \
        patch \
        perl \
        pkg-config \
        python3 \
        sqlite3 \
        unzip \
        wget \
        xz-utils \
        zip \
    && rm -rf /var/lib/apt/lists/*

# Built here rather than fetched: no upstream ships a binary of the fork.
FROM os AS swig

ARG SWIG_REV=9aa62a1eb401c1f29f92804aa018fa1e9b11a73c
ARG SWIG_SHA256=480c2f2bc1fc7a246bf7e9f82fe8ef1e3b577ee130409376ccc915b5370d7a0c

RUN apt-get update && apt-get install -y --no-install-recommends automake bison libbison-dev libpcre2-dev
WORKDIR /src
RUN wget -q "https://github.com/crossbind/swig/archive/${SWIG_REV}.zip" -O swig.zip && \
    echo "${SWIG_SHA256}  swig.zip" | sha256sum -c - && \
    unzip -q swig.zip && \
    cd "swig-${SWIG_REV}" && \
    cmake . && \
    make -j"$(nproc)" && \
    make install DESTDIR=/out && \
    mkdir -p /out/licenses && \
    cp LICENSE LICENSE-GPL LICENSE-UNIVERSITIES /out/licenses/

# Conan runs on Debian's Python from a venv of the wheels conan-requirements.txt pins by hash. pip
# is removed once they are in, so only Conan and the packages it imports ship, each with its texts.
FROM os AS conan

RUN apt-get update && apt-get install -y --no-install-recommends python3-venv
COPY conan-requirements.txt /tmp/conan-requirements.txt
RUN set -eu; \
    python3 -m venv /opt/conan; \
    /opt/conan/bin/pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary :all: --no-deps -r /tmp/conan-requirements.txt; \
    /opt/conan/bin/pip check; \
    /opt/conan/bin/pip uninstall --yes pip; \
    /opt/conan/bin/conan --version; \
    for info in /opt/conan/lib/python3*/site-packages/*.dist-info; do \
      name="$(basename "${info}" .dist-info)"; \
      mkdir -p "/out/licenses/${name}"; \
      find "${info}" -type f \( -iname 'LICEN[CS]E*' -o -iname 'COPYING*' -o -iname 'NOTICE*' \) -exec cp {} "/out/licenses/${name}/" \; ; \
      [ -n "$(ls -A "/out/licenses/${name}")" ] || { echo "no license text in ${info}" >&2; exit 1; }; \
    done

FROM os AS base

# Safe default for direct consumers. The CLI still overrides this with the host uid:gid so bind
# mount outputs remain owned by the developer rather than by this fixed image account.
RUN groupadd --gid 10001 crossbind && \
    useradd --uid 10001 --gid 10001 --no-log-init --create-home --shell /bin/sh crossbind

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# The Node image bundles npm 11.19.0, whose vendored tar, brace-expansion and ip-address carry fixable
# HIGH CVEs; npm 12.0.2 still ships the same set. Replace it with the patched 11.x from a hash-verified tarball.
ARG NPM_VERSION=11.19.1
ARG NPM_SHA256=9f58bff01604cb1b14008fef14dceb14d836a49225e45c6c2e37de3be3e707f0
RUN wget -q "https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz" -O /tmp/npm.tgz && \
    echo "${NPM_SHA256}  /tmp/npm.tgz" | sha256sum -c - && \
    npm install -g --ignore-scripts --no-audit --no-fund /tmp/npm.tgz && \
    rm -f /tmp/npm.tgz && \
    test "$(npm -v)" = "${NPM_VERSION}"
# npm 11.19.1 still vendors brace-expansion 5.0.9 and undici 6.28.0, whose fixable HIGH CVEs no npm
# release has picked up yet (11.21.0 and 12.2.0 ship the same copies). Swap in the patched versions
# from hash-verified tarballs; drop this once the npm of the Node image carries them.
ARG BRACE_EXPANSION_VERSION=5.0.12
ARG BRACE_EXPANSION_SHA256=ef8448ec78f20b692f04fa6d01f39b5ab34c66404bea3429f5a39c6c9e0be8b4
ARG UNDICI_VERSION=6.28.1
ARG UNDICI_SHA256=e18191aac9c0ff43dac7fe9b10b7041a22d07addb7b66a6e8ac14a52a5b69b74
RUN set -eu; \
    vendored=/usr/local/lib/node_modules/npm/node_modules; \
    for package in "brace-expansion ${BRACE_EXPANSION_VERSION} ${BRACE_EXPANSION_SHA256}" "undici ${UNDICI_VERSION} ${UNDICI_SHA256}"; do \
        set -- ${package}; \
        wget -q "https://registry.npmjs.org/$1/-/$1-$2.tgz" -O /tmp/package.tgz; \
        echo "$3  /tmp/package.tgz" | sha256sum -c -; \
        rm -rf "${vendored:?}/$1"; \
        mkdir "${vendored}/$1"; \
        tar -xzf /tmp/package.tgz -C "${vendored}/$1" --strip-components=1 --no-same-owner; \
        rm /tmp/package.tgz; \
        test "$(node -p "require('${vendored}/$1/package.json').version")" = "$2"; \
    done

# The toolchain trees are read-only image content; CARGO_HOME and CONAN_HOME are the mutable halves
# and live outside them so a named volume can take them over. 0777 because containers run as the
# host uid, which has no passwd entry and therefore no writable HOME of its own.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/var/cache/crossbind/cargo \
    CONAN_HOME=/var/cache/crossbind/conan \
    PATH=/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=rust /usr/local/cargo /usr/local/cargo
RUN rm -rf /usr/local/cargo/registry && mkdir -p "${CARGO_HOME}" && chmod 0777 "${CARGO_HOME}"

COPY --from=conan /opt/conan /opt/conan
RUN ln -s /opt/conan/bin/conan /usr/local/bin/conan && mkdir -p "${CONAN_HOME}" && chmod 0777 "${CONAN_HOME}"

COPY --from=swig /out/usr/local/bin/swig /usr/local/bin/swig
COPY --from=swig /out/usr/local/share/swig /usr/local/share/swig

# Texts for what this layer redistributes; apt packages keep Debian's /usr/share/doc convention.
COPY --from=node /usr/local/LICENSE /opt/licenses/node-LICENSE
COPY --from=rust /usr/local/rustup/toolchains/*/share/doc/rust /opt/licenses/rust/
COPY --from=swig /out/licenses/LICENSE /opt/licenses/swig-LICENSE
COPY --from=swig /out/licenses/LICENSE-GPL /opt/licenses/swig-LICENSE-GPL
COPY --from=swig /out/licenses/LICENSE-UNIVERSITIES /opt/licenses/swig-LICENSE-UNIVERSITIES
COPY --from=conan /out/licenses /opt/licenses/conan/
COPY licenses-README.md /opt/licenses/README.md

WORKDIR /
USER 10001:10001
