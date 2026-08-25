#!/usr/bin/env node
/**
 * Pretty-print every `pnpm run` script in the root package.json, grouped by
 * top-level prefix (build / clear / ci / e2e / publish / check / other), with
 * a one-line annotation per script.
 *
 * Annotations live in this file (ANNOTATIONS map) — keep them aligned with
 * package.json. If a script has no annotation here, it still prints under
 * "Other" with the raw command for context.
 *
 * Usage:
 *   pnpm run help                # default invocation
 *   node scripts/help.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

// One-line description per script. Order doesn't matter.
const ANNOTATIONS = {
    // build
    'build:ports': 'Build every @crossbind/port-* (pnpm topological order)',
    'build:examples': 'Build every @crossbind/example-*',
    'build:examples:lib': 'Build sample-lib-* packages (the C++ library samples)',
    'build:examples:lib:wasm': 'Build sample-lib-* for wasm only',
    'build:examples:lib:android': 'Build sample-lib-* for android only',
    'build:examples:lib:ios': 'Build sample-lib-* for iOS only',
    'build:examples:wasm': 'Build all wasm-targeting samples (web/cloud/backend) + sample-lib wasm',
    'build:website': 'Build the Docusaurus site',
    'build:agents': 'Generate contributor context and the portable skill reference bundle',
    build: 'build:ports then build:examples (full)',

    // clear
    'clear:cache:examples': "Remove samples' .crossbind/ cache dirs",
    'clear:cache:ports': "Remove packages' .crossbind/ cache dirs",
    'clear:cache': 'Both samples + packages cache',
    'clear:dist:examples': "Remove samples' dist/ + *.xcframework",
    'clear:dist:ports': "Remove packages' dist/ + *.xcframework",
    'clear:dist:ports:android': 'Remove only android dist/ for packages',
    'clear:dist': 'Both samples + packages dist',
    'clear:pack': 'Remove published .tgz files (workspace-scoped, never node_modules)',
    'clear:examples': 'samples cache + dist',
    'clear:ports': 'packages cache + dist',
    'clear:ports:android': 'packages cache + android-only dist',
    clear: 'All clear: cache + dist + pack',
    'pack:list': 'List existing .tgz files under ports/',

    // ci
    'ci:linux:build:port': 'CI linux: build the zlib package as a smoke test',
    'ci:linux:build': 'CI linux: build all samples + zlib package',
    'ci:windows:build': 'CI windows: build wasm + android sample-lib + zlib',
    'ci:ios:build:port': 'CI macos: build zlib for iOS',
    'ci:macos:build': 'CI macos: build sample-lib for iOS + zlib for iOS',

    // e2e
    'e2e:dev': 'Playwright e2e against dev servers (workspace-concurrency=1)',
    'e2e:prod': 'Playwright e2e against built artifacts',
    'e2e:ios': 'iOS e2e via Maestro',
    'e2e:android': 'Android e2e via Maestro',
    'e2e:mobile': 'iOS + android e2e',
    e2e: 'dev + prod + mobile e2e',

    // publish
    'publish:examples': 'npm publish all @crossbind/example-*',
    'publish:plugins': 'npm publish all @crossbind/plugin-*',
    'publish:core': 'npm publish crossbind (core)',
    'publish:all': 'core + plugins + samples',
    'publish:changeset': 'changeset publish',
    'publish:beta': 'Publish all @crossbind/* under the beta tag',

    // check
    'check:dist': 'Verify each package has prebuilt artifacts for expected targets',
    'check:beta': 'Inventory npm beta tags + package sizes',
    'check:deps': 'External npm dependency drift report (info)',
    'check:deps:strict': 'Same as check:deps but exits non-zero on outdated/unknown',
    'check:native': 'Native library version drift report (GitHub/registry/HTML)',
    'check:native:strict': 'Same as check:native but exits non-zero on outdated/unknown',
    'check:agents': 'Verify the single-skill agent surface and run its deterministic tests',
    check: 'check:dist + dependency/native checks + agent-surface checks (CI-suitable)',

    // self
    'scaffold:port': 'Generate a new in-repository ports/<name> family skeleton',
    help: 'This command — list all pnpm scripts grouped by area',
};

const GROUPS = [
    { title: 'Build', match: /^build/ },
    { title: 'Clear / pack', match: /^(clear|pack)/ },
    { title: 'CI', match: /^ci:/ },
    { title: 'E2E', match: /^e2e/ },
    { title: 'Publish', match: /^publish/ },
    { title: 'Check', match: /^check/ },
    { title: 'Other', match: /^/ }, // catch-all
];

const buckets = new Map(GROUPS.map((g) => [g.title, []]));
const claimed = new Set();
for (const name of Object.keys(scripts).sort()) {
    if (claimed.has(name)) continue;
    for (const g of GROUPS) {
        if (g.match.test(name)) {
            buckets.get(g.title).push(name);
            claimed.add(name);
            break;
        }
    }
}

const nameWidth = Math.max(...Object.keys(scripts).map((n) => n.length), 'Script'.length);

function printGroup(title, names) {
    if (!names.length) return;
    process.stdout.write(`\n${title}\n`);
    process.stdout.write(`${'-'.repeat(title.length)}\n`);
    for (const name of names) {
        const ann = ANNOTATIONS[name] || `(no annotation — runs: ${scripts[name]})`;
        process.stdout.write(`  ${name.padEnd(nameWidth + 2)}${ann}\n`);
    }
}

process.stdout.write('crossbind — pnpm scripts\n');
process.stdout.write('Run any script with `pnpm run <name>` (or `pnpm <name>` if unambiguous).\n');
for (const g of GROUPS) printGroup(g.title, buckets.get(g.title));
process.stdout.write('\nFor agent docs see AGENTS.md, ARCHITECTURE.md, CODEMAP.md.\n');
