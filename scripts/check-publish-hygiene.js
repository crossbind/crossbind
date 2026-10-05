#!/usr/bin/env node
// K1 gate: library packages must not publish executables - fail if any npm tarball
// would carry dist/prebuilt/**/bin/ files beyond *-config scripts. -bin packages are
// exempt for entries their bin map declares publish:true (package.json "crossbind.bin").
// K2 gate: a package shipping bin commands must depend on crossbind - the shims import
// the runner from it, and a devDependency passes in the workspace but not from npm.
// K4 gate: packages that publish bin tools must carry a derived crossbind.provenance
// block (recipe, source hash, build environment) and ship the SBOM it points to.
// K4 needs a built dist; where there is none (fresh checkout, CI) it is reported as
// not evaluated, so the gate stays honest instead of failing on absent build output.
// K5 gate: shipped build metadata (pkg-config, CMake configs, -config scripts) must not name
// paths of the machine that built it, and libtool archives must not ship at all; the build
// relocates them (core/crossbind/src/utils/relocatePrebuilt.js) and this reports what it missed.
//
//   node scripts/check-publish-hygiene.js

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { portsRoot } from './lib/ports.js';
import { DOCKER_BASE } from '../core/crossbind/src/utils/replaceBasePathForDocker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = portsRoot(ROOT);
const BUILD_METADATA = /^dist\/prebuilt\/.+(\.pc|\.cmake|\.la|\/bin\/[^/]+-config)$/;
const BUILD_PATHS = [DOCKER_BASE, ROOT];

const packageDirs = [];
for (const family of fs.readdirSync(PACKAGES_DIR)) {
    const familyDir = path.join(PACKAGES_DIR, family);
    if (!fs.statSync(familyDir).isDirectory()) continue;
    for (const pkg of fs.readdirSync(familyDir)) {
        const pkgDir = path.join(familyDir, pkg);
        if (fs.existsSync(path.join(pkgDir, 'package.json'))) packageDirs.push(pkgDir);
    }
}

let failures = 0;
let notEvaluated = 0;
for (const pkgDir of packageDirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    if (manifest.private) continue;

    // The bin map lives in the recipe (crossbind.build.js), contract C.
    let allowed = new Set();
    const recipeFile = path.join(pkgDir, 'crossbind.build.js');
    if (fs.existsSync(recipeFile)) {
        const recipe = (await import(pathToFileURL(recipeFile).href)).default;
        allowed = new Set(
            Object.entries(recipe?.bin?.tools ?? {})
                .filter(([, tool]) => tool.publish)
                .map(([name]) => name),
        );
    }

    let files;
    try {
        // npm runs prepack even for a dry run, and a standalone Node-API package's prepack refuses a fresh checkout.
        const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
            cwd: pkgDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 64 * 1024 * 1024,
        });
        files = JSON.parse(raw)[0].files.map((f) => f.path);
    } catch (e) {
        console.error(`check-publish-hygiene: npm pack failed in ${pkgDir}: ${e.message}`);
        failures += 1;
        continue;
    }

    // K2: a bin shim imports the runner from crossbind at runtime, so the engine must be a real
    // dependency - a devDependency builds fine in the workspace and breaks every npm install.
    if (manifest.bin && !manifest.dependencies?.['crossbind']) {
        failures += 1;
        console.error(`K2 violation in ${manifest.name}: ships bin commands but does not depend on crossbind (the shims import its runner)`);
    }

    const leaks = files.filter((f) => {
        const match = f.match(/^dist\/prebuilt\/[^/]+\/bin\/(.+)$/);
        if (!match) return false;
        const name = match[1];
        return !name.endsWith('-config') && !allowed.has(name);
    });
    if (leaks.length > 0) {
        failures += 1;
        console.error(`K1 violation in ${manifest.name}: tarball ships executables:`);
        for (const leak of leaks) console.error(`  ${leak}`);
    }

    const unrelocated = files.filter(
        (f) =>
            BUILD_METADATA.test(f) &&
            (f.endsWith('.la') || BUILD_PATHS.some((buildPath) => fs.readFileSync(path.join(pkgDir, f), 'utf8').includes(buildPath))),
    );
    if (unrelocated.length > 0) {
        failures += 1;
        console.error(`K5 violation in ${manifest.name}: tarball ships build metadata that names the build machine:`);
        for (const file of unrelocated) console.error(`  ${file}`);
    }

    // A standalone Node-API package ships addons that link every component statically, so its license is
    // the compound expression its build derives with `crossbind licenses --package`; its LICENSE and SBOM are
    // build outputs, which scripts/check-node-package.mjs checks when the train packs it.
    const isNodePackage =
        (manifest.os && manifest.main?.endsWith('.node')) ||
        Object.keys(manifest.optionalDependencies ?? {}).some((dependency) => dependency.startsWith(`${manifest.name}-`));
    if (isNodePackage && !manifest.license?.includes(' AND ')) {
        failures += 1;
        console.error(
            `K4 violation in ${manifest.name}: license is not the derived compound expression (build the package: its build runs crossbind licenses --package)`,
        );
    }

    // Provenance and the SBOM are build outputs: a fresh checkout has no dist to judge, so
    // K4 reports as not evaluated instead of failing (the real gate is the pre-publish build).
    const hasDist = files.some((f) => f.startsWith('dist/prebuilt/'));
    if (allowed.size > 0 && !hasDist) {
        console.log(`check-publish-hygiene: ${manifest.name}: K4 not evaluated (no dist in tarball - not built here)`);
        notEvaluated += 1;
    } else if (allowed.size > 0) {
        const provenance = manifest.crossbind?.provenance;
        const problems = [];
        if (!provenance) problems.push('missing crossbind.provenance block (run the package build)');
        else {
            if (!provenance.recipe?.name || !provenance.recipe?.version) problems.push('recipe.name/version missing');
            if (!provenance.source?.url || !provenance.source?.sha256) problems.push('source.url/sha256 missing');
            if (!provenance.environment?.dockerImage) problems.push('environment.dockerImage missing');
            if (!provenance.sbom) problems.push('sbom path missing');
            else if (!files.includes(provenance.sbom)) problems.push(`sbom ${provenance.sbom} not in tarball (run crossbind licenses)`);
            if (manifest.license && !manifest.license.includes(' AND '))
                problems.push(
                    'license field is a single license for an aggregate binary (expected the derived compound expression - run the package build)',
                );
            const licenseFile = path.join(pkgDir, 'LICENSE');
            if (!fs.existsSync(licenseFile)) problems.push('LICENSE file missing (run the package build - it is derived)');
            else if (manifest.license && !fs.readFileSync(licenseFile, 'utf8').includes(manifest.license))
                problems.push('LICENSE file does not carry the derived license expression (run the package build)');
        }
        if (problems.length > 0) {
            failures += 1;
            console.error(`K4 violation in ${manifest.name}: ${problems.join('; ')}`);
        }
    }
}

if (failures > 0) {
    console.error(`check-publish-hygiene: ${failures} package(s) violate the publish contract (K1/K4/K5).`);
    process.exit(1);
}
console.log(
    `check-publish-hygiene: ${packageDirs.length} packages checked, no K1/K4/K5 violations` +
        `${notEvaluated > 0 ? ` (${notEvaluated} K4 gate(s) not evaluated - no dist)` : ''}.`,
);
