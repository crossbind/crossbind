# The web toolchain image this repository's crossbind pins; scripts/build-image.mjs passes it in.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root
# bubblewrap is the compile sandbox; tini reaps what the sandboxes leave behind and passes signals on, which
# node as PID 1 does neither. No setuid program is left for anything to climb through.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap=0.12.0-1~deb13u1 tini=0.19.0-3+b8 \
    && rm -rf /var/lib/apt/lists/* \
    && find / -xdev -perm /6000 -type f -exec chmod a-s {} +

# crossbind from this repository with the dependencies its lockfile pins (scripts/build-image.mjs), so the CLI and
# the toolchain image it pins always match. Nothing is fetched or run.
COPY crossbind /opt/playground/cli/node_modules/crossbind
RUN mkdir -p /opt/playground/home/.crossbind /srv/playground \
    && printf '{"RUNNER":"LOCAL"}' > /opt/playground/home/.crossbind/config.json \
    && chown crossbind:crossbind /srv/playground

COPY compiler /opt/playground/compiler

# Built once at the path every compile reuses, so cmake's cache and emscripten's library cache start warm. warm.js
# has the build use every package a compile may (compiler/packages.js); the crates and Conan builds it leaves under
# HOME become the store each compile works from offline (compiler/compile.js). The template's conan.lock and
# crossbind.cargo.lock pin the Conan recipes and the crates: a build that resolved others stops at the diff, which
# shows the lock to commit. The build runs as the server's user, and root copies what it leaves into a new template,
# with no setuid bits, which the server then cannot change; in one layer, so the image holds the tree once.
RUN runuser -u crossbind -- sh -ec ' \
        cp -R /opt/playground/compiler/template /srv/playground/work; \
        node /opt/playground/compiler/warm.js /srv/playground/work; \
        mkdir -p /tmp/home/.crossbind; \
        cp /opt/playground/home/.crossbind/config.json /tmp/home/.crossbind/; \
        cd /srv/playground/work; \
        HOME=/tmp/home node /opt/playground/cli/node_modules/crossbind/src/bin.js build -p wasm -a wasm32 -r st -e browser -b debug --bind-imports; \
        diff -u /opt/playground/compiler/template/conan.lock conan.lock; \
        diff -u /opt/playground/compiler/template/crossbind.cargo.lock crossbind.cargo.lock; \
        mkdir /srv/playground/store; \
        mv /tmp/home/.crossbind/cache/cargo /srv/playground/store/cargo; \
        mv /tmp/home/.crossbind/cache/conan-local /srv/playground/store/conan' \
    && rm -rf /srv/playground/template \
    && cp -dR --preserve=mode,timestamps /srv/playground/work /srv/playground/template \
    && find /srv/playground/template -perm /6000 -type f -exec chmod a-s {} + \
    && rm -rf /srv/playground/work /tmp/home

USER crossbind
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/playground/compiler/server.js"]
