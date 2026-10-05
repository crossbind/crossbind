#!/usr/bin/env node
// The prepack script of every standalone Node-API package: refuses a package a build did not fill, such
// as an addon package without the addon of its platform or a package without the license files
// `crossbind licenses --package` derives at the end of its build, so npm never publishes one hollow.

import { nodePackageProblems } from './release/node-packages.mjs';

const problems = nodePackageProblems(process.cwd());
if (problems.length > 0) {
    console.error(`check-node-package: ${process.cwd()} is not ready to pack:\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
