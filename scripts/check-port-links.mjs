#!/usr/bin/env node
// Links the published C++ ports against the pinned toolchain image and calls into them. A toolchain
// bump that changes the C++ exception ABI, or a header declaring what the library never defines,
// breaks the link only when a project references port symbols - which no fixture in CI does.
// Usage: node scripts/check-port-links.mjs [--tag beta]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tagIndex = process.argv.indexOf('--tag');
const TAG = tagIndex === -1 ? 'beta' : process.argv[tagIndex + 1];
// Under the repository so the Docker mount of paths.base ('../..') carries the CLI, the packages and the project.
const PROJECT = path.join(ROOT, 'tmp', 'port-links');
const PORTS = ['gdal', 'proj', 'geos'];

const FILES = {
    'package.json': '{ "name": "port-links", "private": true }\n',
    'crossbind.config.mjs': `import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js';

export default {
    general: { name: 'portlinks' },
    dependencies: [gdal],
    paths: { config: import.meta.url, base: '../..', output: 'dist' },
};
`,
    'src/native/portlinks.h': `#pragma once
#include <string>

std::string gdalVersion();
std::string projVersion();
std::string geosVersion();
`,
    'src/native/portlinks.cpp': `#include "portlinks.h"
#include <gdal.h>
#include <geos_c.h>
#include <proj.h>

std::string gdalVersion() { return GDALVersionInfo("RELEASE_NAME"); }
std::string projVersion() { return proj_info().version; }
std::string geosVersion() { return GEOSversion(); }
`,
    'src/check.mjs': `import initNative from '../dist/portlinks-wasm-wasm32-st-release.node.js';

const m = await initNative();
const versions = { gdal: m.gdalVersion(), proj: m.projVersion(), geos: m.geosVersion() };
console.log(JSON.stringify(versions));
const wrong = Object.entries(versions).filter(([, version]) => !/^\\d+\\.\\d+\\.\\d+/.test(String(version)));
if (wrong.length) {
    console.error(\`unexpected versions: \${JSON.stringify(Object.fromEntries(wrong))}\`);
    process.exit(1);
}
`,
};

function run(command, args, cwd) {
    console.log(`$ ${command} ${args.join(' ')}`);
    execFileSync(command, args, { cwd, stdio: 'inherit' });
}

fs.rmSync(PROJECT, { recursive: true, force: true });
for (const [file, content] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(PROJECT, file)), { recursive: true });
    fs.writeFileSync(path.join(PROJECT, file), content);
}
// xhr2 backs the node loader's fetch, as in the node fixtures.
run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', `@crossbind/port-gdal-wasm@${TAG}`, 'xhr2@^0.2.1'], PROJECT);
for (const port of PORTS) {
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT, 'node_modules', '@crossbind', `port-${port}-wasm`, 'package.json'), 'utf8'));
    console.log(`@crossbind/port-${port}-wasm ${manifest.version}`);
}
run('node', [path.join(ROOT, 'core/crossbind/src/bin.js'), 'build', '-p', 'wasm', '-e', 'node', '-r', 'st'], PROJECT);
run('node', ['src/check.mjs'], PROJECT);
console.log(`port links OK: ${PORTS.join(', ')} linked with the pinned image and answered.`);
