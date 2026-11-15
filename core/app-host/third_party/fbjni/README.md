# fbjni (license only)

An Android app carries `libfbjni.so`, which Hermes loads and Gradle takes from Maven Central with it. Its AAR holds no
license; this folder keeps fbjni's, which `crossbind licenses` quotes.

- Upstream: https://github.com/facebookincubator/fbjni
- Version: `0.7.0`, the one the Hermes release for Android depends on (`FBJNI_VERSION` in crossbind's `actions/licenses.js`)
- License: Apache-2.0, see `LICENSE`, the repository's `LICENSE` at tag `v0.7.0`,
  sha256 `f62d190c08e2b300b45780f0b3cabcacc78d0e373f7a0de79d31f82b084d35ea`

A Hermes update that moves fbjni changes this folder too.
