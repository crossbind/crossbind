const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execAsync = util.promisify(exec);

const BUMP_MODE = process.argv.slice(2).includes('--bump');
if (BUMP_MODE) {
    throw new Error('Legacy --bump is disabled. Use release:version with --package selectors or explicit --all.');
}
const REPORT_PATH = (() => {
    const i = process.argv.indexOf('--report');
    return i !== -1 ? process.argv[i + 1] : null;
})();

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

// Semver-lite comparator for "X.Y.Z-beta.N" shaped versions. Returns
//   1  if a > b
//  -1  if a < b
//   0  if equal / unparseable
// A stable "X.Y.Z" version is considered greater than any beta of the same
// core, and "beta.12" is correctly greater than "beta.5" (numeric, not
// lexicographic).
function compareBetaVersions(a, b) {
    const parse = (v) => {
        const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(v));
        if (!m) return null;
        return { major: +m[1], minor: +m[2], patch: +m[3], beta: m[4] != null ? +m[4] : null };
    };
    const pa = parse(a);
    const pb = parse(b);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;
    if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
    if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
    if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
    if (pa.beta == null && pb.beta != null) return 1;
    if (pa.beta != null && pb.beta == null) return -1;
    if (pa.beta == null && pb.beta == null) return 0;
    return pa.beta < pb.beta ? -1 : pa.beta > pb.beta ? 1 : 0;
}

// Increment the beta counter: "2.0.0-beta.5" -> "2.0.0-beta.6".
function bumpBetaVersion(version) {
    const m = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(version);
    if (!m) throw new Error(`Cannot bump ${version}: not in X.Y.Z-beta.N format`);
    return `${m[1]}-beta.${parseInt(m[2], 10) + 1}`;
}

// Rewrite the top-level "version" field in place, preserving existing
// formatting (indentation, key order, trailing newline). Anchored with ^ + m
// flag so nested "version" keys (if any) are not touched.
function rewriteVersionField(pkgPath, newVersion) {
    const original = fs.readFileSync(pkgPath, 'utf8');
    const re = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
    if (!re.test(original)) throw new Error(`version field not found in ${pkgPath}`);
    const updated = original.replace(re, (_, pre, _old, post) => `${pre}${newVersion}${post}`);
    if (updated === original) return false;
    fs.writeFileSync(pkgPath, updated);
    return true;
}

async function checkPackages() {
    const findCmd = 'find . -name "package.json" -maxdepth 4';
    const { stdout } = await execAsync(findCmd);
    const packagePaths = stdout.split('\n').filter((p) => p.trim());

    console.log(`Found ${packagePaths.length} packages. Checking status...`);

    const results = [];
    const limit = 20; // Increase concurrency for speed
    let active = 0;
    let index = 0;

    const next = async () => {
        if (index >= packagePaths.length) return;
        const i = index++;
        const pkgPath = packagePaths[i];

        try {
            const content = fs.readFileSync(pkgPath, 'utf8');
            const pkg = JSON.parse(content);
            const name = pkg.name;

            if (name && !name.startsWith('@crossbind/playground')) {
                try {
                    const { stdout: betaVersion } = await execAsync(`npm view ${name} dist-tags.beta`, { timeout: 10000 });
                    const version = betaVersion.trim();

                    if (version) {
                        const { stdout: sizeBytes } = await execAsync(`npm view ${name}@${version} dist.unpackedSize`, { timeout: 10000 });
                        const sizeMB = (parseInt(sizeBytes.trim()) / 1024 / 1024).toFixed(2) + ' MB';
                        results.push({ name, version, size: sizeMB, published: true, path: pkgPath });
                    } else {
                        results.push({ name, published: false, reason: 'No beta tag' });
                    }
                } catch (e) {
                    results.push({ name, published: false, reason: 'Not found or error' });
                }
            }
        } catch (e) {
            // Ignore read errors
        }

        process.stdout.write('.');
        await next();
    };

    const workers = [];
    for (let i = 0; i < limit; i++) {
        workers.push(next());
    }
    await Promise.all(workers);

    const notPublished = results.filter((r) => !r.published);
    const released = results.filter((r) => r.published);

    process.stdout.write('\n');
    if (notPublished.length > 0) {
        process.stdout.write(`Unreleased / Missing Beta Tag (${notPublished.length})\n`);
        printTable(
            ['Package', 'Reason'],
            notPublished.map((r) => [r.name, r.reason]),
        );
        process.stdout.write('\n');
    } else {
        process.stdout.write('All packages have a beta release.\n\n');
    }

    const releasedAlpha = [...released].sort((a, b) => a.name.localeCompare(b.name));
    process.stdout.write(`Released — alphabetical (${released.length})\n`);
    printTable(
        ['Package', 'Version', 'Size'],
        releasedAlpha.map((r) => [r.name, r.version, r.size]),
    );
    process.stdout.write('\n');

    const releasedBySize = [...released].sort((a, b) => parseFloat(b.size) - parseFloat(a.size));
    process.stdout.write(`Released — by size (${released.length})\n`);
    printTable(
        ['Package', 'Version', 'Size'],
        releasedBySize.map((r) => [r.name, r.version, r.size]),
    );

    if (REPORT_PATH) {
        let md = '# Beta Release Status\n\n';
        md += `Generated on: ${new Date().toISOString()}\n\n`;
        if (notPublished.length > 0) {
            md += '## ⚠️ Unreleased / Missing Beta Tag\n\n';
            md += '| Package Name | Reason |\n|---|---|\n';
            notPublished.forEach((r) => {
                md += `| ${r.name} | ${r.reason} |\n`;
            });
            md += '\n';
        } else {
            md += '## ✅ All packages have a beta release\n\n';
        }
        md += `## Released Packages (Alphabetical Order) (${released.length})\n\n`;
        md += '| Package Name | Version | Size |\n|---|---|---|\n';
        releasedAlpha.forEach((r) => {
            md += `| ${r.name} | ${r.version} | ${r.size} |\n`;
        });
        md += `\n## Released Packages (Size Order) (${released.length})\n\n`;
        md += '| Package Name | Version | Size |\n|---|---|---|\n';
        releasedBySize.forEach((r) => {
            md += `| ${r.name} | ${r.version} | ${r.size} |\n`;
        });
        fs.writeFileSync(REPORT_PATH, md);
        process.stderr.write(`\nReport saved to ${REPORT_PATH}\n`);
    }

    if (BUMP_MODE) {
        if (released.length === 0) {
            console.log('\n[--bump] No released packages found — nothing to bump.');
            return;
        }
        const maxVersion = released.reduce((max, r) => (compareBetaVersions(r.version, max) > 0 ? r.version : max), released[0].version);
        let nextVersion;
        try {
            nextVersion = bumpBetaVersion(maxVersion);
        } catch (e) {
            console.error(`\n[--bump] ${e.message}`);
            process.exitCode = 1;
            return;
        }
        console.log(`\n[--bump] Highest published version: ${maxVersion}`);
        console.log(`[--bump] Writing ${nextVersion} to ${released.length} local package.json file(s):`);
        let failures = 0;
        for (const r of released) {
            try {
                rewriteVersionField(r.path, nextVersion);
                console.log(`  ${r.name}: ${r.version} -> ${nextVersion}`);
            } catch (e) {
                failures++;
                console.error(`  ${r.name}: FAILED (${e.message})`);
            }
        }
        if (failures > 0) process.exitCode = 1;
    }
}

checkPackages();
