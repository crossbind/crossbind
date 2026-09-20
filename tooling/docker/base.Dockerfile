# syntax=docker/dockerfile:1

# The common layer of the crossbind image family: host build tools, Node and the pinned Rust
# toolchain. Nothing above Debian is inherited. Node and (in web.Dockerfile) Emscripten are copied
# out of digest-pinned upstream images. Rust is installed as an exact release by the rustup shipped
# in a digest-pinned upstream image; the point-release Docker tag can lag the Rust release itself.
# The runtime layout - PATH, Node version, CARGO_HOME, cache permissions - is ours to guarantee.

ARG RUST_VERSION=1.98.1

FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS node
FROM rust:1.98.1-slim@sha256:f47a8de237dcbb0b0ce1099901e60a89728e3d51f24e664b40e947171538ade7 AS rust
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

FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a AS os

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

ARG SWIG_REV=844524ad2562f8f5a5f7ae2c7d4e230dded0b866
ARG SWIG_SHA256=61365d97b46e00c2d43356e2f7df185666610765c63ab8de9345e0ad89a2f8e5

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

# The toolchain tree is read-only image content; CARGO_HOME is the mutable half and lives outside
# it so a named volume can take it over. 0777 because containers run as the host uid, which has no
# passwd entry and therefore no writable HOME of its own.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/var/cache/crossbind/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=rust /usr/local/cargo /usr/local/cargo
RUN rm -rf /usr/local/cargo/registry && mkdir -p "${CARGO_HOME}" && chmod 0777 "${CARGO_HOME}"

COPY --from=swig /out/usr/local/bin/swig /usr/local/bin/swig
COPY --from=swig /out/usr/local/share/swig /usr/local/share/swig

# Texts for what this layer redistributes; apt packages keep Debian's /usr/share/doc convention.
COPY --from=node /usr/local/LICENSE /opt/licenses/node-LICENSE
COPY --from=rust /usr/local/rustup/toolchains/*/share/doc/rust /opt/licenses/rust/
COPY --from=swig /out/licenses/LICENSE /opt/licenses/swig-LICENSE
COPY --from=swig /out/licenses/LICENSE-GPL /opt/licenses/swig-LICENSE-GPL
COPY --from=swig /out/licenses/LICENSE-UNIVERSITIES /opt/licenses/swig-LICENSE-UNIVERSITIES
COPY licenses-README.md /opt/licenses/README.md

WORKDIR /
USER 10001:10001
