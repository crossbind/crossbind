#!/usr/bin/env node
// Runs the e2e/check.mjs of every standalone Node-API package (ports/<family>/standalone-napi) in one process, as an app that uses
// several of them does: each package must keep its own addon, registrations and runtime helpers, and together they
// must stay under Node's listener limits. Runs after the packages' builds.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORTS = fileURLToPath(new URL('../ports', import.meta.url));

process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') throw warning;
});

const families = fs.readdirSync(PORTS).sort()
    .filter((family) => fs.existsSync(path.join(PORTS, family, 'standalone-napi', 'e2e', 'check.mjs')));
const unbuilt = families.filter((family) => !fs.existsSync(path.join(PORTS, family, 'standalone-napi', 'dist')));
if (unbuilt.length) {
    throw new Error(`e2e-node-packages-together: build ${unbuilt.map((family) => `@crossbind/port-${family}-standalone-napi`).join(', ')} first.`);
}

for (const family of families) {
    const packageDir = path.join(PORTS, family, 'standalone-napi');
    process.env.NATIVE_VERSION = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).nativeVersion;
    await import(pathToFileURL(path.join(packageDir, 'e2e', 'check.mjs')).href);
}
console.log(`ok: ${families.length} standalone Node-API packages in one process`);
