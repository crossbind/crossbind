#!/usr/bin/env node
/**
 * e2e-templates — scaffold every create-crossbind template and run its real
 * build + e2e suite, the way an end user would after `npm create crossbind`.
 *
 * It pulls the scaffolder either from npm (the published beta) or from a local
 * pack of the working tree, generates each template into tmp/e2e-templates/,
 * installs, builds (Wasm/native via the crossbind Docker image), and runs the
 * template's own Playwright / Maestro e2e suite. Anything the host can't do
 * (no Docker, no emulator) is reported as SKIPPED rather than failing the run.
 *
 * Usage:
 *   node scripts/e2e-templates.js [options]
 *
 * Options:
 *   --source npm|local   Scaffolder origin (default: npm)
 *   --tag <tag>          npm dist-tag for --source npm (default: beta)
 *   --pm pnpm|npm        Package manager for scaffolded projects (default: pnpm)
 *   --only a,b,c         Only these template keys (manifest "key" values)
 *   --filter <substr>    Only templates whose key contains <substr>
 *   --skip-build         Scaffold + install only (skip build)
 *   --skip-e2e           Skip the e2e/browser/device step
 *   --skip-npm-check     Skip the `npm install --dry-run` peer-conflict probe
 *   --clean              Wipe tmp/e2e-templates before starting
 *   --list               Print the plan + host capability gating, then exit
 *   --json               Also write tmp/e2e-templates/summary.json
 *   -h, --help           Show this help
 *
 * Exit code is non-zero if any template FAILS (skips do not fail the run).
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildPlan, REPO_ROOT } = require('./e2e-templates/plan');
const { detectEnv, missingCaps } = require('./e2e-templates/env');
const { resolveSource } = require('./e2e-templates/source');
const { runTemplate, pickE2e } = require('./e2e-templates/runner');

const BASE_DIR = path.join(REPO_ROOT, 'tmp/e2e-templates');
const LOG_DIR = path.join(BASE_DIR, 'logs');
const SUMMARY_PATH = path.join(BASE_DIR, 'summary.json');

const STATUS_ICON = { pass: '✓', fail: '✗', skip: '–' };

const DEFAULT_FLAGS = {
    source: 'npm',
    tag: 'beta',
    pm: 'pnpm',
    only: null,
    filter: null,
    skipBuild: false,
    skipE2e: false,
    skipNpmCheck: false,
    clean: false,
    list: false,
    json: false,
    help: false,
};

function parseArgs(argv) {
    const flags = { ...DEFAULT_FLAGS };
    const rest = argv.slice(2);
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        const eq = arg.indexOf('=');
        const name = eq === -1 ? arg : arg.slice(0, eq);
        const take = () => (eq === -1 ? rest[(i += 1)] : arg.slice(eq + 1));
        switch (name) {
            case '--':
                break; // args separator (pnpm forwards it verbatim) — ignore
            case '-h':
            case '--help':
                flags.help = true;
                break;
            case '--source':
                flags.source = take();
                break;
            case '--tag':
                flags.tag = take();
                break;
            case '--pm':
                flags.pm = take();
                break;
            case '--only':
                flags.only = take()
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                break;
            case '--filter':
                flags.filter = take();
                break;
            case '--skip-build':
                flags.skipBuild = true;
                break;
            case '--skip-e2e':
                flags.skipE2e = true;
                break;
            case '--skip-npm-check':
                flags.skipNpmCheck = true;
                break;
            case '--clean':
                flags.clean = true;
                break;
            case '--list':
                flags.list = true;
                break;
            case '--json':
                flags.json = true;
                break;
            default:
                throw new Error(`Unknown option: ${arg} (try --help)`);
        }
    }
    return flags;
}

function selectPlan(plan, flags) {
    let selected = plan;
    if (flags.only) selected = selected.filter((i) => flags.only.includes(i.key));
    if (flags.filter) selected = selected.filter((i) => i.key.includes(flags.filter));
    return selected;
}

function printTable(headers, rows) {
    if (rows.length === 0) return;
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
    const fmt = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
    process.stdout.write(`\n${fmt(headers)}\n${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
    rows.forEach((r) => process.stdout.write(`${fmt(r)}\n`));
    process.stdout.write('\n');
}

// Human-readable preview of what would run for an item, given host caps.
function previewAction(item, caps, flags) {
    if (item.klass === 'mobile') {
        const e2e = pickE2e({ 'e2e:ios': 1, 'e2e:android': 1 }, 'mobile', caps);
        if (e2e) return `e2e (${e2e.script})`;
        return item.key === 'mobile-reactnative-expo' ? 'install + expo prebuild (no device)' : 'SKIP e2e (no device/maestro)';
    }
    const buildMiss = item.buildCaps.length ? missingCaps(item.buildCaps, caps) : [];
    const hasE2e = ['web', 'cloud', 'native', 'desktop'].includes(item.klass);
    if (buildMiss.length && hasE2e) {
        return `SKIP (missing ${buildMiss.join(', ')})`;
    }
    const parts = ['install'];
    if (!flags.skipBuild && item.buildCaps.length) parts.push(buildMiss.length ? 'build:SKIP' : 'build');
    if (!flags.skipE2e && hasE2e) parts.push(item.klass === 'desktop' && !caps.display ? 'e2e:SKIP' : 'e2e');
    return parts.join(' + ');
}

function printList(plan, caps, flags) {
    process.stdout.write(`\nHost capabilities: ${JSON.stringify(caps)}\n`);
    const rows = plan.map((i) => [
        i.key,
        i.klass,
        `crossbind ${i.scaffoldArgs.slice(1).join(' ')}`,
        i.buildCaps.join(',') || '—',
        previewAction(i, caps, flags),
    ]);
    printTable(['TEMPLATE', 'CLASS', 'SCAFFOLD', 'BUILD NEEDS', 'WOULD RUN'], rows);
}

function stepSummary(steps) {
    return steps.map((s) => `${s.name}:${STATUS_ICON[s.status] || '?'}`).join(' ');
}

function printResults(results) {
    const rows = results.map((r) => [STATUS_ICON[r.status], r.key, r.klass, stepSummary(r.steps), r.reason || '']);
    printTable(['', 'TEMPLATE', 'CLASS', 'STEPS', 'NOTE'], rows);

    const failed = results.filter((r) => r.status === 'fail');
    if (failed.length) {
        process.stdout.write('Failures (see logs):\n');
        failed.forEach((r) => process.stdout.write(`  ✗ ${r.key} — ${r.reason}\n    ${r.logFile}\n`));
        process.stdout.write('\n');
    }
    const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    process.stdout.write(`Summary: ${counts.pass || 0} passed, ${counts.fail || 0} failed, ${counts.skip || 0} skipped (of ${results.length}).\n`);
    return failed.length === 0;
}

function printHelp() {
    const header = fs.readFileSync(__filename, 'utf8');
    const doc = header.slice(header.indexOf('Usage:'), header.indexOf('*/')).replace(/^ \* ?/gm, '');
    process.stdout.write(`\n${doc}\n`);
}

async function main() {
    const flags = parseArgs(process.argv);
    if (flags.help) {
        printHelp();
        return;
    }

    const caps = detectEnv();
    const plan = selectPlan(buildPlan(), flags);
    if (plan.length === 0) throw new Error('No templates matched the selection (--only / --filter).');

    if (flags.list) {
        printList(plan, caps, flags);
        return;
    }

    if (flags.clean) fs.rmSync(BASE_DIR, { recursive: true, force: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });

    if (!caps.docker) {
        process.stdout.write('⚠ Docker not available — Wasm/native builds (and the web/cloud e2e that depend on them) will be SKIPPED.\n');
    }

    const rootLog = fs.createWriteStream(path.join(LOG_DIR, '_setup.log'), { flags: 'w' });
    const source = await resolveSource({ source: flags.source, tag: flags.tag, logStream: rootLog });
    rootLog.end();
    process.stdout.write(`\nScaffolder: ${source.describe}\nPackage manager: ${flags.pm}\nWorkdir: ${BASE_DIR}\n`);

    const ctx = {
        baseDir: BASE_DIR,
        logDir: LOG_DIR,
        source,
        caps,
        pm: flags.pm,
        flags,
    };

    const results = [];
    // Sequential: web/cloud e2e bind fixed preview ports and Docker builds are heavy.
    for (const item of plan) {
        process.stdout.write(`\n▶ ${item.key} (${item.klass}) ...\n`);
        const result = await runTemplate(item, ctx);
        process.stdout.write(
            `  ${STATUS_ICON[result.status]} ${result.status}${result.reason ? ` — ${result.reason}` : ''}  (log: ${path.relative(REPO_ROOT, result.logFile)})\n`,
        );
        results.push(result);
    }

    if (typeof source.cleanup === 'function') source.cleanup();

    const ok = printResults(results);

    if (flags.json) {
        const summary = {
            source: flags.source,
            tag: flags.tag,
            pm: flags.pm,
            platform: caps.platform,
            finishedAt: new Date().toISOString(),
            results: results.map((r) => ({
                key: r.key,
                klass: r.klass,
                status: r.status,
                reason: r.reason,
                steps: r.steps,
                logFile: r.logFile,
            })),
        };
        fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
        process.stdout.write(`Wrote ${path.relative(REPO_ROOT, SUMMARY_PATH)}\n`);
    }

    process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
    process.stderr.write(`\ne2e-templates failed: ${err.stack || err}\n`);
    process.exit(2);
});
