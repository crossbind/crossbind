#!/bin/sh
# Cloudflare holds a runner's HTTPS to its allowed hosts by intercepting it, with a CA that exists only at run time:
# trust it system-wide, then run the runner, and every build step after it, as the image's unprivileged user with no
# way back up.
set -eu
ca=/etc/cloudflare/certs/cloudflare-containers-ca.crt
if [ -f "$ca" ]; then
    cp "$ca" /usr/local/share/ca-certificates/cloudflare-containers-ca.crt
    update-ca-certificates > /dev/null
    export NODE_EXTRA_CA_CERTS="$ca"
fi
exec setpriv --reuid=10001 --regid=10001 --init-groups --no-new-privs --bounding-set=-all --inh-caps=-all \
    node /opt/crossbind/runner/server.js
