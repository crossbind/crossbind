#!/usr/bin/env node

process.stderr.write(
    'Legacy local and bulk npm publication is disabled because it can use a stored npm token or login session. ' +
        'Publish only through an approved GitHub Actions OIDC Trusted Publishing workflow. The current protected ' +
        '`release-crossbind.yml` workflow covers the unscoped `crossbind` package; add scoped packages to the ' +
        'reviewed release-train workflow before publishing them.\n',
);
process.exitCode = 1;
