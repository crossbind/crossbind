#!/bin/sh
# Keep the caller's source URL and checksum gate; retry only the transfer, with visible errors.
set -eu

if [ "$#" -ne 2 ]; then
    echo 'usage: crossbind-download URL OUTPUT' >&2
    exit 2
fi

url=$1
output=$2
mkdir -p "$(dirname "$output")"
temporary=$(mktemp "${output}.download.XXXXXX")
trap 'rm -f "$temporary"' EXIT

if wget --progress=dot:giga \
    --tries=5 --waitretry=5 \
    --dns-timeout=15 --connect-timeout=15 --read-timeout=60 \
    --retry-connrefused --retry-on-host-error \
    --retry-on-http-error=429,500,502,503,504 \
    --output-document="$temporary" "$url"; then
    # mktemp starts private; these public toolchain files must remain readable by the image's non-root user.
    chmod 644 "$temporary"
    mv -f "$temporary" "$output"
else
    status=$?
    echo "crossbind-download: transfer failed (exit ${status}): ${url}" >&2
    exit "$status"
fi
