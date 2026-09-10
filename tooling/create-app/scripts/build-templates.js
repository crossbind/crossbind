#!/usr/bin/env node
// Copies each sample referenced by src/manifest.json into templates/<key>/ and
// rewrites it so end-users can `npm install` without the workspace:
//   - workspace:* | workspace:^ | workspace:~ -> ^<resolved-version>
//   - lines containing the marker "Delete this line for create-crossbind" are
//     stripped from crossbind.config.{js,mjs} and metro.config.js (these are
//     workspace-only knobs that don't belong in scaffolded projects).
// Build artifacts (node_modules, .crossbind, dist, native build outputs, lockfiles
// when not whitelisted) are filtered out during copy.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(PKG_DIR, 'templates');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'src/manifest.json'), 'utf8'));

const SCAN_ROOTS = ['core', 'tooling', 'plugins', 'ports', 'examples', 'e2e'];
const STRIP_MARKER = /^.*Delete this line for create-crossbind.*\r?\n?/gm;

function findAllPackageJsons() {
    const out = [];
    const walk = (dir, depth) => {
        if (depth > 3) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, depth + 1);
            else if (e.name === 'package.json') out.push(full);
        }
    };
    for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), 0);
    return out;
}

function buildVersionMap() {
    const map = new Map();
    for (const pj of findAllPackageJsons()) {
        try {
            const { name, version } = JSON.parse(fs.readFileSync(pj, 'utf8'));
            if (name && version) map.set(name, version);
        } catch { /* skip unreadable */ }
    }
    return map;
}

function rewriteWorkspaceDeps(deps, versionMap) {
    if (!deps) return deps;
    const out = {};
    for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec === 'string' && spec.startsWith('workspace:')) {
            const v = versionMap.get(name);
            if (!v) throw new Error(`No workspace version found for ${name} (referenced via ${spec})`);
            out[name] = `^${v}`;
        } else {
            out[name] = spec;
        }
    }
    return out;
}

function makeFilter(entry) {
    const skipDirs = new Set([
        'node_modules', '.crossbind', 'dist', '.gradle', '.cxx', 'Pods', 'build',
        '.expo', '.wrangler', '.next', '.svelte-kit', 'playwright-report', 'test-results', 'coverage',
        'xcuserdata',
    ]);
    // Podfile.lock is a generated lock pinned to a specific react-native version; shipping it makes
    // a fresh `pod install` fail when it drifts. The official RN template ships only the Podfile.
    // .xcode.env.local pins an absolute NODE_BINARY from the author's machine; shipping it breaks
    // every consumer's Xcode build and leaks the author's home path — the portable .xcode.env stays.
    const skipFiles = new Set(['.DS_Store', '.xcode.env.local', 'pnpm-lock.yaml', 'Podfile.lock']);
    if (!entry.keepLockfile) skipFiles.add('package-lock.json');
    return (src) => {
        const base = path.basename(src);
        if (skipDirs.has(base)) return false;
        if (skipFiles.has(base)) return false;
        if (base.endsWith('.xcframework')) return false;
        if (base.endsWith('.profraw')) return false;
        if (base.endsWith('.xcuserstate')) return false;
        if (entry.nativeFolders === false) {
            // The Expo template asks users to run `expo prebuild`; ship no native dirs.
            const rel = path.relative(path.join(REPO_ROOT, entry.source), src);
            if (rel === 'android' || rel === 'ios' || rel.startsWith('android/') || rel.startsWith('ios/')) {
                return false;
            }
        }
        return true;
    };
}

async function rewriteTemplate(dst, versionMap) {
    const pjPath = path.join(dst, 'package.json');
    if (fs.existsSync(pjPath)) {
        const pkg = JSON.parse(await fsp.readFile(pjPath, 'utf8'));
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            pkg[field] = rewriteWorkspaceDeps(pkg[field], versionMap);
        }
        await fsp.writeFile(pjPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    for (const f of ['crossbind.config.js', 'crossbind.config.mjs', 'metro.config.js']) {
        const p = path.join(dst, f);
        if (fs.existsSync(p)) {
            const before = await fsp.readFile(p, 'utf8');
            const after = before.replace(STRIP_MARKER, '');
            if (after !== before) await fsp.writeFile(p, after);
        }
    }
}

// pnpm refuses dependency build scripts unless the project's own pnpm-workspace.yaml allows them;
// a scaffolded project has no workspace, so templates whose tooling needs them (wrangler: workerd,
// esbuild) ship the allowance. The samples themselves inherit the monorepo's list.
export function renderPnpmWorkspace(allowBuilds) {
    return `allowBuilds:\n${allowBuilds.map((name) => `  ${name}: true\n`).join('')}`;
}

async function buildOne(entry, versionMap) {
    const src = path.join(REPO_ROOT, entry.source);
    const dst = path.join(TEMPLATES_DIR, entry.key);
    if (!fs.existsSync(src)) throw new Error(`Source missing for ${entry.key}: ${src}`);
    await fsp.rm(dst, { recursive: true, force: true });
    await fsp.cp(src, dst, { recursive: true, filter: makeFilter(entry) });
    await rewriteTemplate(dst, versionMap);
    if (entry.allowBuilds?.length) {
        await fsp.writeFile(path.join(dst, 'pnpm-workspace.yaml'), renderPnpmWorkspace(entry.allowBuilds));
    }
}

async function main() {
    await fsp.rm(TEMPLATES_DIR, { recursive: true, force: true });
    await fsp.mkdir(TEMPLATES_DIR, { recursive: true });
    const versionMap = buildVersionMap();
    for (const entry of MANIFEST) {
        process.stdout.write(`  building ${entry.key} ... `);
        await buildOne(entry, versionMap);
        process.stdout.write('ok\n');
    }
    process.stdout.write(`templates built: ${MANIFEST.length} (${TEMPLATES_DIR})\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        process.stderr.write(`build-templates failed: ${err.stack || err}\n`);
        process.exit(1);
    });
}
