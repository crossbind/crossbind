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
RUN mkdir -p /opt/playground/home /srv/playground \
    && printf '{"RUNNER":"LOCAL"}' > /opt/playground/home/.crossbind.json \
    && chown crossbind:crossbind /srv/playground

COPY compiler /opt/playground/compiler

# Built once at the path every compile reuses, so cmake's cache and emscripten's library cache start warm.
USER crossbind
RUN cp -R /opt/playground/compiler/template /srv/playground/work \
    && mkdir -p /tmp/home \
    && cp /opt/playground/home/.crossbind.json /tmp/home/ \
    && cd /srv/playground/work \
    && HOME=/tmp/home node /opt/playground/cli/node_modules/crossbind/src/bin.js build -p wasm -a wasm32 -r st -e browser -b debug \
    && cp -a /srv/playground/work /srv/playground/template \
    && rm -rf /srv/playground/work /tmp/home

# The server copies the template for every compile but cannot change it.
USER root
RUN chown -R root:root /srv/playground/template

USER crossbind
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/playground/compiler/server.js"]
