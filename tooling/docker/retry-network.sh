#!/bin/bash
# Gradle keeps successful downloads between attempts. Compile and verification errors fail immediately.
set -euo pipefail

if [ "$#" -eq 0 ]; then
    echo 'usage: crossbind-retry-network COMMAND [ARGS...]' >&2
    exit 2
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT

for attempt in 1 2 3; do
    set +e
    "$@" 2>&1 | tee "$log"
    statuses=("${PIPESTATUS[@]}")
    set -e
    status=${statuses[0]}
    [ "${statuses[1]}" -eq 0 ] || exit "${statuses[1]}"
    [ "$status" -ne 0 ] || exit 0

    # A network message elsewhere in the log must never hide an integrity failure.
    if grep -Eiq 'dependency verification failed|checksum.*(mismatch|failed|does not match)|signature.*(invalid|failed)|PKIX path building failed' "$log"; then
        exit "$status"
    fi
    if ! grep -Eiq '(received status code|HTTP(/[0-9.]+)?)[ :]+(429|5[0-9]{2})|timed? out|connection (reset|refused|closed)|temporary failure in name resolution|unknownhostexception|could not resolve host|network is unreachable' "$log"; then
        exit "$status"
    fi
    [ "$attempt" -lt 3 ] || exit "$status"

    delay=$((attempt * 5))
    echo "crossbind-retry-network: network failure; retrying in ${delay}s (attempt $((attempt + 1))/3)" >&2
    sleep "$delay"
done
