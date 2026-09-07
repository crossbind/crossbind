# syntax=docker/dockerfile:1

# The common layer of the crossbind image family: host build tools, Node and the pinned Rust
# toolchain. Nothing above Debian is inherited. Node and (in web.Dockerfile) Emscripten are copied
# out of digest-pinned upstream images. Rust is installed as an exact release by the rustup shipped
# in a digest-pinned upstream image; the point-release Docker tag can lag the Rust release itself.
# The runtime layout - PATH, Node version, CARGO_HOME, cache permissions - is ours to guarantee.

ARG RUST_VERSION=1.98.1

FROM node:24.20.0-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0 AS node
FROM rust:1.98.0-slim@sha256:cc0448b41c3b7b7fea44f5dc50eacba729a56db365b65b7bd5e8a82d5b3db078 AS rust
ARG RUST_VERSION
RUN rustup toolchain install "${RUST_VERSION}" --profile minimal --no-self-update && \
    rustup default "${RUST_VERSION}" && \
    rustup toolchain uninstall 1.98.0 && \
    test "$(rustc -vV | sed -n 's/^release: //p')" = "${RUST_VERSION}"

FROM debian:trixie-slim@sha256:3a39a0592364683e6bab97937b72cad5a8fa6dcbbee90edb3bb48c7f8e94f258 AS os

RUN apt-get update && apt-get install -y --no-install-recommends \
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

ARG SWIG_REV=1b6501ab958ac581229f765f30393f6119dd3e0e
ARG SWIG_SHA256=744d1f3a7cd9db687e642a505b282c46b0f1544bb6395284f217174b68f0aee8

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
