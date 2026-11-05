# Monocypher (vendored)

The host's updater checks a desktop app's update's Ed25519 signature, and hashes the update with SHA-512, with
Monocypher, which it compiles as C++ through `../monocypher.cpp` and `../monocypher-ed25519.cpp`: `monocypher.c` and
`monocypher.h`, and `monocypher-ed25519.c` and `monocypher-ed25519.h` from the release's `src/optional/`, unchanged.

- Upstream: https://monocypher.org
- Version: `4.0.3`, `https://monocypher.org/download/monocypher-4.0.3.tar.gz`, sha256
  `8cc9bc341a66249016db9bd70e9142d8d0aef9945973744b1ac05dbc55d8ee66`, which matches the release's published SHA-512
- License: BSD-2-Clause or CC0-1.0, whichever one picks; see `LICENCE.md`, the release's own
