# Security policy

## Reporting a vulnerability

Report a vulnerability privately, never in a public issue, discussion or pull request:

- with GitHub's form: [Report a vulnerability](https://github.com/crossbind/crossbind/security/advisories/new), or
- by email, to [security@crossbind.dev](mailto:security@crossbind.dev).

A report that says these helps the most:

- the package and its version, and the platform it runs on;
- how to reproduce the vulnerability, with a proof of concept if there is one;
- what an attacker gains with it.

Each report gets an answer. A confirmed vulnerability is fixed in a release and published as a GitHub security
advisory, which credits the reporter unless they ask otherwise.

## Supported versions

Fixes ship in the next release of each package affected, on npm's `beta` tag. Earlier releases are not patched:
upgrade to the latest.

## Scope

- the `crossbind` CLI and runtime, and every `@crossbind/*` and `create-crossbind` package;
- how the prebuilt libraries are built and packaged; a vulnerability in a wrapped library itself is also its upstream
  project's to fix;
- crossbind.dev, the playground and crossbind cloud.
