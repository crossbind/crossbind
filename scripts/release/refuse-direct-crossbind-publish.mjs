#!/usr/bin/env node

process.stderr.write(
    'Direct crossbind publication is disabled. Run `pnpm release:dry-run`, then dispatch ' +
        '`.github/workflows/release-crossbind.yml` so the exact tarball is published through npm OIDC Trusted Publishing ' +
        'and its notes, registry verification, exact tag and GitHub Release stay coordinated.\n',
);
process.exitCode = 1;
