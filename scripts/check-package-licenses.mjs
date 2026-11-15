#!/usr/bin/env node
// Each package the workspace publishes carries its own license at its root. pnpm pack gives a package without a license
// file the workspace's LICENSE, but not a package whose files hold any license file, as the LICENSE of a copy it ships
// under third_party/: that package needs a LICENSE of its own. The ports' builds write theirs, and so does the build of a
// package whose files list its license; scripts/check-publish-hygiene.js and the train check those.
//
//   node scripts/check-package-licenses.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE_FILE = /^(LICEN[CS]E|COPYING)(\..+)?$/i;
const OUTPUT_LIMIT = 64 * 1024 * 1024;

const pnpm = async (args, cwd) => (await execFileAsync('pnpm', args, { cwd, encoding: 'utf8', maxBuffer: OUTPUT_LIMIT })).stdout;

const projects = JSON.parse(await pnpm(['ls', '--recursive', '--depth', '-1', '--json'], ROOT));
const packages = projects.filter((project) => {
    if (!project.name || project.private) return false;
    if (path.relative(ROOT, project.path).split(path.sep)[0] === 'ports') return false;
    const manifest = JSON.parse(fs.readFileSync(path.join(project.path, 'package.json'), 'utf8'));
    return !(manifest.files ?? []).some((entry) => LICENSE_FILE.test(entry));
});

// pnpm pack is all of this check's time, so the packages are packed side by side.
const missing = [];
let next = 0;
await Promise.all(
    Array.from({ length: Math.min(os.availableParallelism(), packages.length) }, async () => {
        while (next < packages.length) {
            const { name, path: dir } = packages[next++];
            const packed = JSON.parse(await pnpm(['pack', '--dry-run', '--json'], dir));
            if (!packed.files.some((file) => LICENSE_FILE.test(file.path))) missing.push(`${name} (${path.relative(ROOT, dir)})`);
        }
    }),
);

if (missing.length > 0) {
    console.error(`check-package-licenses: ${missing.length} package(s) would publish without a license of their own; give each its LICENSE:`);
    for (const entry of missing.sort()) console.error(`  ${entry}`);
    process.exit(1);
}
console.log(`check-package-licenses: ${packages.length} packages publish their own license.`);
