#!/usr/bin/env node
/**
 * Scans every package.json under ports/ for the `nativeVersion` field,
 * resolves the latest upstream version of each native library, and writes a
 * report file comparing the two.
 *
 * Usage:
 *   node check-native-versions.js            # Write native-versions.md
 *   node check-native-versions.js --check    # Also exit non-zero if any
 *                                            # package is outdated (exit 1)
 *                                            # or could not be checked (exit 2)
 *   node check-native-versions.js --update   # Rewrite `nativeVersion` in every
 *                                            # outdated package.json to the
 *                                            # latest upstream version
 *   node check-native-versions.js --family zlib --json /tmp/native.json
 *                                            # Limit the scan and emit a stable,
 *                                            # machine-readable report
 *
 * Set GITHUB_TOKEN in the environment to avoid GitHub API rate limits.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'ports');
const REPORT_PATH = (() => {
    const i = process.argv.indexOf('--report');
    return i !== -1 ? process.argv[i + 1] : null;
})();
const JSON_PATH = (() => {
    const i = process.argv.indexOf('--json');
    return i !== -1 ? process.argv[i + 1] : null;
})();

function optionValues(name) {
    const values = [];
    for (let i = 0; i < process.argv.length; i += 1) {
        if (process.argv[i] !== name || !process.argv[i + 1]) continue;
        values.push(
            ...process.argv[i + 1]
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
        );
    }
    return values;
}

const FAMILY_FILTER = new Set(optionValues('--family'));

function pad(s, n) {
    return String(s).padEnd(n);
}
function printTable(headers, rows, stream = process.stdout) {
    if (rows.length === 0) return;
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
    const fmt = (cells) => cells.map((c, i) => pad(c, widths[i])).join('  ');
    stream.write(`${fmt(headers)}\n`);
    stream.write(`${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
    rows.forEach((r) => stream.write(`${fmt(r)}\n`));
}

const BASE_HEADERS = {
    'User-Agent': 'crossbind-native-version-check',
};

// GitHub-only headers. MUST NOT be sent to any other host: GitLab (and other
// APIs) will reject a GitHub-shaped Authorization header with HTTP 401.
const GH_HEADERS = {
    ...BASE_HEADERS,
    Accept: 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

// ---------------------------------------------------------------------------
// Version comparison (zero-dep, semver-lite).
// Returns 1 if a > b, -1 if a < b, 0 if equal.
// Treats a non-prerelease as newer than any prerelease sharing the same core.
// ---------------------------------------------------------------------------
function splitVersion(v) {
    const [mainStr, ...preParts] = String(v).split('-');
    const main = mainStr.split('.').map((x) => {
        const n = parseInt(x, 10);
        return Number.isNaN(n) ? x : n;
    });
    return { main, pre: preParts.join('-') || null };
}

function compareVersions(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const pa = splitVersion(a);
    const pb = splitVersion(b);
    const len = Math.max(pa.main.length, pb.main.length);
    for (let i = 0; i < len; i++) {
        const av = pa.main[i] ?? 0;
        const bv = pb.main[i] ?? 0;
        if (av === bv) continue;
        if (typeof av === 'number' && typeof bv === 'number') return av > bv ? 1 : -1;
        return String(av) > String(bv) ? 1 : -1;
    }
    if (!pa.pre && pb.pre) return 1;
    if (pa.pre && !pb.pre) return -1;
    if (!pa.pre && !pb.pre) return 0;
    return pa.pre.localeCompare(pb.pre);
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------
async function fetchJson(url) {
    const isGitHub = url.startsWith('https://api.github.com/');
    const res = await fetch(url, { headers: isGitHub ? GH_HEADERS : BASE_HEADERS });
    if (!res.ok) {
        if (res.status === 403 && isGitHub && !process.env.GITHUB_TOKEN) {
            throw new Error('GitHub API rate limit hit (HTTP 403). Export GITHUB_TOKEN (e.g. `export GITHUB_TOKEN=$(gh auth token)`) and retry.');
        }
        throw new Error(`GET ${url} -> HTTP ${res.status}`);
    }
    return res.json();
}

async function fetchText(url) {
    const res = await fetch(url, { headers: BASE_HEADERS });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    return res.text();
}

// Given a stream of candidate version strings, return
// { stable, any } where `any` is the highest version overall and
// `stable` is the highest version without a prerelease suffix. A prerelease
// is detected by the presence of a "-" in the normalized version string
// (e.g. "4.0.0-alpha1").
function pickMaxVersions(candidates) {
    let maxStable = null;
    let maxAny = null;
    for (const v of candidates) {
        if (!v) continue;
        if (!maxAny || compareVersions(v, maxAny) > 0) maxAny = v;
        if (!v.includes('-')) {
            if (!maxStable || compareVersions(v, maxStable) > 0) maxStable = v;
        }
    }
    return { stable: maxStable, any: maxAny };
}

// Pick both the highest stable tag and the highest tag overall from a GitHub
// repo. `filter` is applied against the raw tag name; `normalize` converts it
// into a plain version string. To include prereleases in `any`, the filter
// must accept those tag names too.
//
// Walks at most TAG_PAGES pages (per_page=100 each). Tags on GitHub come
// back in roughly reverse-chronological order, so 200 tags is plenty to find
// the newest version without paging through history.
const TAG_PAGES = 2;
const TAG_PAGE_SIZE = 100;

// GitHub release "prerelease" detection: a tag name on its own can't tell us
// whether the project considers the release a prerelease (e.g. libjpeg-turbo's
// `3.1.90` looks like a stable semver string, but the GitHub release is
// flagged `prerelease: true`). We fetch the releases endpoint and merge that
// flag back onto matching tags. Tags with no corresponding release fall back
// to dash-suffix inference inside pickMaxVersions().
async function ghPrereleaseTagSet(repo) {
    const set = new Set();
    try {
        for (let page = 1; page <= TAG_PAGES; page++) {
            const releases = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=${TAG_PAGE_SIZE}&page=${page}`);
            if (!Array.isArray(releases) || releases.length === 0) break;
            for (const r of releases) {
                if (r.prerelease && r.tag_name) set.add(r.tag_name);
            }
            if (releases.length < TAG_PAGE_SIZE) break;
        }
    } catch {
        // Releases endpoint is best-effort; some repos (e.g. mirrors) don't
        // publish through it. Caller falls back to dash detection.
    }
    return set;
}

async function ghMaxTag(repo, normalize, filter) {
    const prereleaseTags = await ghPrereleaseTagSet(repo);
    const versions = [];
    for (let page = 1; page <= TAG_PAGES; page++) {
        const tags = await fetchJson(`https://api.github.com/repos/${repo}/tags?per_page=${TAG_PAGE_SIZE}&page=${page}`);
        if (!Array.isArray(tags) || tags.length === 0) break;
        for (const t of tags) {
            if (filter && !filter(t.name)) continue;
            let v = normalize(t.name);
            if (!v) continue;
            if (prereleaseTags.has(t.name) && !v.includes('-')) {
                v = `${v}-prerelease`;
            }
            versions.push(v);
        }
        if (tags.length < TAG_PAGE_SIZE) break;
    }
    return pickMaxVersions(versions);
}

// Parse an Apache-style HTML directory listing and return both the highest
// stable version and the highest version overall whose filename matches the
// provided regex (must have one capture group for the version).
async function scrapeLatestFromDir(url, regex) {
    const html = await fetchText(url);
    const versions = [];
    for (const match of html.matchAll(regex)) versions.push(match[1]);
    return pickMaxVersions(versions);
}

// ---------------------------------------------------------------------------
// Library sources are derived dynamically from each package's
// `crossbind.build.js`. Two probe versions are passed to `getURL(version)` and
// the returned URLs are diffed to determine: source kind (GitHub releases,
// GitHub archive tag, or HTTP directory listing), repo/dir, and the
// transform applied to the version (verbatim, dots-to-underscores, etc).
//
// Adding a new library? Drop a `crossbind.build.js` with a `getURL(version)`
// arrow function (template literal) into the new package — no edits to
// this file are needed.
//
// OVERRIDES is the escape hatch for libraries whose latest version cannot
// be derived from the download URL alone (sqlite3 encodes 3.46.0 as the
// integer 3460000 in its URL, so we look at GitHub tags instead).
// ---------------------------------------------------------------------------
const { pathToFileURL } = require('url');

const OVERRIDES = {
    // sqlite3 download URL encodes 3.46.0 as `3460000`, not recoverable.
    sqlite3: {
        kind: 'github_tags',
        repo: 'sqlite/sqlite',
        tagPrefix: 'version-',
        tagSuffix: '',
        tagSep: '.',
        homepage: 'https://github.com/sqlite/sqlite',
    },
    // webp downloads from a Google Cloud Storage bucket that doesn't expose
    // a public listing, so we fall back to GitHub release tags.
    webp: {
        kind: 'github_tags',
        repo: 'webmproject/libwebp',
        tagPrefix: 'v',
        tagSuffix: '',
        tagSep: '.',
        homepage: 'https://github.com/webmproject/libwebp',
    },
};

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Given two URL segments produced by getURL(vA) and getURL(vB), figure out
// the literal prefix/suffix and the separator used between version components.
// Returns null when the segment isn't a clean transform of the input version
// (e.g. sqlite3's integer encoding) — the caller falls back to OVERRIDES.
function analyzeSegment(segA, segB, vA = '1.2.3', vB = '4.5.6') {
    let i = 0;
    while (i < segA.length && i < segB.length && segA[i] === segB[i]) i++;
    let j = 0;
    while (j < segA.length - i && j < segB.length - i && segA[segA.length - 1 - j] === segB[segB.length - 1 - j]) j++;
    const prefix = segA.slice(0, i);
    const suffix = segA.slice(segA.length - j);
    const midA = segA.slice(i, segA.length - j);
    const midB = segB.slice(i, segB.length - j);

    const candidates = [
        { sep: '.', a: vA, b: vB },
        { sep: '_', a: vA.replaceAll('.', '_'), b: vB.replaceAll('.', '_') },
        { sep: '-', a: vA.replaceAll('.', '-'), b: vB.replaceAll('.', '-') },
    ];
    for (const c of candidates) {
        if (midA === c.a && midB === c.b) return { prefix, suffix, sep: c.sep };
    }
    return null;
}

// Build a regex that matches a tag/filename of the inferred shape. Allows
// 2-4 numeric components and an optional prerelease suffix like "-alpha1".
function buildShapeRegex({ prefix, suffix, sep }) {
    const escSep = escapeRegex(sep);
    return new RegExp(`^${escapeRegex(prefix)}(\\d+${escSep}\\d+(?:${escSep}\\d+){0,2})(?:-([A-Za-z0-9.]+))?${escapeRegex(suffix)}$`);
}

const GITHUB_RELEASE_RE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\//;
const GITHUB_ARCHIVE_RE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/refs\/tags\/(.+?)(\.tar\.gz|\.tgz|\.zip|\.tar\.bz2)$/;

function deriveSourceFromURLs(urlA, urlB) {
    const releaseA = urlA.match(GITHUB_RELEASE_RE);
    const releaseB = urlB.match(GITHUB_RELEASE_RE);
    if (releaseA && releaseB && releaseA[1] === releaseB[1]) {
        const shape = analyzeSegment(releaseA[2], releaseB[2]);
        if (!shape) return null;
        return {
            kind: 'github_tags',
            repo: releaseA[1],
            tagPrefix: shape.prefix,
            tagSuffix: shape.suffix,
            tagSep: shape.sep,
            homepage: `https://github.com/${releaseA[1]}`,
        };
    }

    const archiveA = urlA.match(GITHUB_ARCHIVE_RE);
    const archiveB = urlB.match(GITHUB_ARCHIVE_RE);
    if (archiveA && archiveB && archiveA[1] === archiveB[1] && archiveA[3] === archiveB[3]) {
        const shape = analyzeSegment(archiveA[2], archiveB[2]);
        if (!shape) return null;
        return {
            kind: 'github_tags',
            repo: archiveA[1],
            tagPrefix: shape.prefix,
            tagSuffix: shape.suffix,
            tagSep: shape.sep,
            homepage: `https://github.com/${archiveA[1]}`,
        };
    }

    // Directory listing fallback.
    const dirURL = urlA.replace(/\/[^/]+$/, '/');
    if (dirURL === urlB.replace(/\/[^/]+$/, '/')) {
        const fileA = urlA.split('/').pop();
        const fileB = urlB.split('/').pop();
        const shape = analyzeSegment(fileA, fileB);
        if (!shape) return null;
        return {
            kind: 'dir',
            dirURL,
            filePrefix: shape.prefix,
            fileSuffix: shape.suffix,
            fileSep: shape.sep,
            homepage: dirURL,
        };
    }

    return null;
}

async function fetchLatestFromSource(source) {
    if (source.kind === 'github_tags') {
        const re = buildShapeRegex({
            prefix: source.tagPrefix,
            suffix: source.tagSuffix,
            sep: source.tagSep,
        });
        const sep = source.tagSep;
        return ghMaxTag(
            source.repo,
            (t) => {
                const m = t.match(re);
                if (!m) return null;
                const core = m[1].replaceAll(sep, '.');
                return m[2] ? `${core}-${m[2]}` : core;
            },
            (t) => re.test(t),
        );
    }

    if (source.kind === 'dir') {
        const escSep = escapeRegex(source.fileSep);
        const fileRe = new RegExp(`${escapeRegex(source.filePrefix)}(\\d+${escSep}\\d+(?:${escSep}\\d+){0,2})${escapeRegex(source.fileSuffix)}`, 'g');
        const html = await fetchText(source.dirURL);
        const versions = [];
        for (const m of html.matchAll(fileRe)) {
            versions.push(m[1].replaceAll(source.fileSep, '.'));
        }
        return pickMaxVersions(versions);
    }

    throw new Error(`Unknown source kind: ${source.kind}`);
}

// Walks ports/ and dynamic-imports each library's canonical base `build.mjs`.
// This keeps the inventory runnable before pnpm has created workspace links.
// Returns { libKey -> source } where `source` is
// consumable by fetchLatestFromSource().
async function buildLibraryMap() {
    const groups = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());

    const libs = {};
    for (const group of groups) {
        const libKey = group.name;
        if (OVERRIDES[libKey]) {
            libs[libKey] = OVERRIDES[libKey];
            continue;
        }

        const buildPath = path.join(PACKAGES_DIR, group.name, 'base', 'build.mjs');
        if (!fs.existsSync(buildPath)) continue;

        let getURL;
        try {
            const mod = await import(pathToFileURL(buildPath).href);
            getURL = mod?.default?.getURL;
        } catch (e) {
            console.error(`  ${libKey}: failed to import base/build.mjs (${e.message})`);
            continue;
        }
        if (typeof getURL !== 'function') {
            console.error(`  ${libKey}: base/build.mjs has no default.getURL function`);
            continue;
        }

        let urlA, urlB;
        try {
            urlA = getURL('1.2.3');
            urlB = getURL('4.5.6');
        } catch (e) {
            console.error(`  ${libKey}: getURL() threw (${e.message})`);
            continue;
        }

        const source = deriveSourceFromURLs(urlA, urlB);
        if (!source) {
            console.error(`  ${libKey}: could not derive upstream from ${urlA}`);
            continue;
        }
        libs[libKey] = source;
    }
    return libs;
}

// ---------------------------------------------------------------------------
// Filesystem walk
// ---------------------------------------------------------------------------
function walkPackageJsons(dir) {
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkPackageJsons(full));
        } else if (entry.name === 'package.json') {
            out.push(full);
        }
    }
    return out;
}

function deriveLibraryKey(pkgPath) {
    // .../ports/<family>/<target>/package.json - the family dir is the library key.
    return path.basename(path.dirname(path.dirname(pkgPath)));
}

// Rewrite the `"nativeVersion": "X"` line in-place, preserving all other
// formatting (indentation, key order, trailing newline).
function rewriteNativeVersion(pkgPath, newVersion) {
    const original = fs.readFileSync(pkgPath, 'utf8');
    // bin-wasi manifests also contain a generated source component entry. Keep
    // every nativeVersion occurrence in one package internally consistent.
    const re = /("nativeVersion"\s*:\s*")([^"]*)(")/g;
    if (!re.test(original)) {
        throw new Error(`nativeVersion field not found in ${pkgPath}`);
    }
    const updated = original.replace(re, (_, pre, _old, post) => `${pre}${newVersion}${post}`);
    if (updated === original) return false;
    fs.writeFileSync(pkgPath, updated);
    return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const args = process.argv.slice(2);
    const checkMode = args.includes('--check') || args.includes('--ci');
    const updateMode = args.includes('--update');

    const pkgPaths = walkPackageJsons(PACKAGES_DIR);
    const packages = [];
    for (const p of pkgPaths) {
        try {
            const json = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!json.nativeVersion) continue;
            const library = deriveLibraryKey(p);
            if (FAMILY_FILTER.size > 0 && !FAMILY_FILTER.has(library)) continue;
            packages.push({
                name: json.name,
                nativeVersion: json.nativeVersion,
                library,
                absPath: p,
                relativePath: path.relative(ROOT, p),
            });
        } catch (e) {
            console.error(`Failed to parse ${p}: ${e.message}`);
        }
    }

    const libraryKeys = [...new Set(packages.map((p) => p.library))].sort();
    console.error(`Found ${packages.length} package(s) across ${libraryKeys.length} libraries. Resolving upstream sources from base/build.mjs...`);

    const sources = await buildLibraryMap();

    console.error(`Resolving latest upstream versions...`);
    const latestByLibrary = {};
    await Promise.all(
        libraryKeys.map(async (key) => {
            const src = sources[key];
            if (!src) {
                latestByLibrary[key] = {
                    stable: null,
                    any: null,
                    error: `No upstream source derived for '${key}' (missing or unparseable base/build.mjs)`,
                    homepage: null,
                    source: null,
                };
                return;
            }
            try {
                const { stable, any } = await fetchLatestFromSource(src);
                if (!stable && !any) throw new Error('No matching tag/version found');
                latestByLibrary[key] = { stable, any, error: null, homepage: src.homepage, source: src };
                if (stable && any && stable !== any) {
                    console.error(`  ${key}: ${stable} (stable) / ${any} (incl. prerelease)`);
                } else {
                    console.error(`  ${key}: ${stable || any}`);
                }
            } catch (e) {
                latestByLibrary[key] = { stable: null, any: null, error: e.message, homepage: src.homepage, source: src };
                console.error(`  ${key}: FAILED (${e.message})`);
            }
        }),
    );

    const rows = packages.map((pkg) => {
        const info = latestByLibrary[pkg.library] || {};
        const isPrerelease = String(pkg.nativeVersion).includes('-');
        // Prerelease packages compare against the highest version overall
        // (which may itself be a prerelease). Stable packages compare against
        // the highest stable release only, so we never suggest downgrading to
        // or "upgrading" onto a prerelease.
        const latest = isPrerelease ? (info.any ?? info.stable ?? null) : (info.stable ?? info.any ?? null);
        let status;
        if (info.error || !latest) {
            status = 'unknown';
        } else {
            status = compareVersions(pkg.nativeVersion, latest) >= 0 ? 'up-to-date' : 'outdated';
        }
        return {
            package: pkg.name,
            library: pkg.library,
            nativeVersion: pkg.nativeVersion,
            latestVersion: latest || null,
            latestChannel: isPrerelease ? 'prerelease' : 'stable',
            status,
            error: info.error || null,
            homepage: info.homepage || null,
            source: info.source || null,
            absPath: pkg.absPath,
            path: pkg.relativePath,
        };
    });

    rows.sort((a, b) => a.package.localeCompare(b.package));

    if (updateMode) {
        const toUpdate = rows.filter((r) => r.status === 'outdated');
        if (toUpdate.length === 0) {
            console.error('\nNothing to update — no outdated packages.');
        } else {
            console.error(`\nUpdating nativeVersion in ${toUpdate.length} package.json file(s)...`);
            for (const r of toUpdate) {
                try {
                    rewriteNativeVersion(r.absPath, r.latestVersion);
                    console.error(`  ${r.package}: ${r.nativeVersion} -> ${r.latestVersion}`);
                    r.previousNativeVersion = r.nativeVersion;
                    r.nativeVersion = r.latestVersion;
                    r.status = 'updated';
                } catch (e) {
                    console.error(`  ${r.package}: update failed (${e.message})`);
                    r.updateError = e.message;
                }
            }
        }
    }

    const outdated = rows.filter((r) => r.status === 'outdated');
    const upToDate = rows.filter((r) => r.status === 'up-to-date');
    const unknown = rows.filter((r) => r.status === 'unknown');
    const updated = rows.filter((r) => r.status === 'updated');

    const renderTable = (list) => {
        let s = '| Package | Library | nativeVersion | Latest | Status |\n';
        s += '|---|---|---|---|---|\n';
        for (const r of list) {
            const libCell = r.homepage ? `[${r.library}](${r.homepage})` : r.library;
            let statusCell;
            if (r.status === 'updated') statusCell = `updated (was ${r.previousNativeVersion})`;
            else if (r.status === 'up-to-date') statusCell = 'up-to-date';
            else if (r.status === 'outdated') statusCell = 'outdated';
            else statusCell = 'unknown';
            const latestCell = r.latestVersion ? (r.latestChannel === 'prerelease' ? `${r.latestVersion} (incl. prerelease)` : r.latestVersion) : '—';
            s += `| ${r.package} | ${libCell} | ${r.nativeVersion} | ${latestCell} | ${statusCell} |\n`;
        }
        return s;
    };

    const toRow = (r) => {
        let statusCell;
        if (r.status === 'updated') statusCell = `updated (was ${r.previousNativeVersion})`;
        else statusCell = r.status;
        const latestCell = r.latestVersion ? (r.latestChannel === 'prerelease' ? `${r.latestVersion} (incl. prerelease)` : r.latestVersion) : '—';
        return [r.package, r.library, r.nativeVersion, latestCell, statusCell];
    };
    const cols = ['Package', 'Library', 'nativeVersion', 'Latest', 'Status'];

    process.stdout.write('\n');
    if (updated.length > 0) {
        process.stdout.write(`Updated (${updated.length})\n`);
        printTable(cols, updated.map(toRow));
        process.stdout.write('\n');
    }
    if (outdated.length > 0) {
        process.stdout.write(`Outdated (${outdated.length})\n`);
        printTable(cols, outdated.map(toRow));
        process.stdout.write('\n');
    }
    if (unknown.length > 0) {
        process.stdout.write(`Unknown (${unknown.length})\n`);
        printTable(cols, unknown.map(toRow));
        for (const r of unknown) {
            if (r.error) process.stdout.write(`  - ${r.package}: ${r.error}\n`);
        }
        process.stdout.write('\n');
    }
    process.stdout.write(`Up to date (${upToDate.length})\n`);
    printTable(cols, upToDate.map(toRow));

    if (REPORT_PATH) {
        let md = '# Native Library Versions\n\n';
        md += `Generated on: ${new Date().toISOString()}\n\n`;
        md += `- Total packages: ${rows.length}\n`;
        md += `- Up to date: ${upToDate.length}\n`;
        md += `- Outdated: ${outdated.length}\n`;
        if (updated.length > 0) md += `- Updated: ${updated.length}\n`;
        md += `- Unknown: ${unknown.length}\n\n`;
        if (updated.length > 0) {
            md += `## Updated (${updated.length})\n\n` + renderTable(updated) + '\n';
        }
        if (outdated.length > 0) {
            md += `## Outdated (${outdated.length})\n\n` + renderTable(outdated) + '\n';
        }
        if (unknown.length > 0) {
            md += `## Unknown (${unknown.length})\n\n` + renderTable(unknown) + '\n';
            for (const r of unknown) {
                if (r.error) md += `- ${r.package}: ${r.error}\n`;
            }
            md += '\n';
        }
        md += `## Up to date (${upToDate.length})\n\n` + renderTable(upToDate) + '\n';
        fs.writeFileSync(REPORT_PATH, md);
        process.stderr.write(`\nReport written to ${REPORT_PATH}\n`);
    }
    if (JSON_PATH) {
        const result = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            families: libraryKeys,
            rows: rows.map(({ absPath: _absPath, ...row }) => row),
            summary: {
                total: rows.length,
                upToDate: upToDate.length,
                outdated: outdated.length,
                unknown: unknown.length,
                updated: updated.length,
            },
        };
        fs.writeFileSync(JSON_PATH, `${JSON.stringify(result, null, 2)}\n`);
        process.stderr.write(`Machine-readable report written to ${JSON_PATH}\n`);
    }
    process.stderr.write(
        `\nSummary: ${upToDate.length} up-to-date, ${outdated.length} outdated, ${unknown.length} unknown${updated.length ? `, ${updated.length} updated` : ''}\n`,
    );

    if (checkMode) {
        if (outdated.length > 0) {
            console.error(`\n${outdated.length} package(s) are outdated:`);
            for (const r of outdated) {
                console.error(`  - ${r.package}: ${r.nativeVersion} -> ${r.latestVersion}`);
            }
            process.exit(1);
        }
        if (unknown.length > 0) {
            console.error(`\n${unknown.length} package(s) could not be checked:`);
            for (const r of unknown) {
                console.error(`  - ${r.package}: ${r.error || 'no latest version resolved'}`);
            }
            process.exit(2);
        }
        console.error('\nAll packages are up to date.');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
