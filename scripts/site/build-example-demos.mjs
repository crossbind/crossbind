import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { channelDistTag, distTagSuffix } from '../release/resolve-site-release.mjs';

// Builds the live demos the Examples page embeds: each web example is scaffolded with the same
// `npm create crossbind@<tag>` command the page shows, installed from npm, built for its subpath
// and copied under landing/public/examples/<id>/. Every demo is then loaded in a browser from
// that subpath before it is accepted. Needs the network, Docker (the toolchain image) and the
// workspace's Playwright. The output directory is generated, not committed.

const execFileAsync = promisify(execFile);
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMOS_ROOT = path.join(REPOSITORY_ROOT, 'landing', 'public', 'examples');
export const MANIFEST_NAME = 'demos.json';

// The web templates and how each one hosts under /examples/<id>/. `vite` builds with --base and
// `rspack` already emits relative asset URLs; both get the two patches the generated loader needs
// (its script import and its worker/wasm path are root-absolute). `vanilla` loads everything
// relative to its own index.html.
export const DEMOS = [
    { id: 'web-react-vite', args: ['Web', 'React', 'Vite'], kind: 'vite' },
    { id: 'web-vue-vite', args: ['Web', 'Vue', 'Vite'], kind: 'vite' },
    { id: 'web-svelte-vite', args: ['Web', 'Svelte', 'Vite'], kind: 'vite' },
    { id: 'web-vanilla', args: ['Web', 'Vanilla'], kind: 'vanilla' },
    { id: 'web-react-rspack', args: ['Web', 'React', 'Rspack'], kind: 'rspack' },
];

const log = (message) => process.stderr.write(`${message}\n`);

async function run(command, args, cwd) {
    try {
        return await execFileAsync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1' } });
    } catch (error) {
        throw new Error(`${command} ${args.join(' ')} failed in ${cwd}:\n${(error.stderr || error.stdout || error.message).slice(-2000)}`, {
            cause: error,
        });
    }
}

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true });
}

// Replaces every occurrence and refuses to continue when a patch finds nothing: a silent miss
// would ship a demo that requests /crossbind.js from the site root.
function patchFile(file, replacements) {
    let text = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const [from, to] of replacements) {
        if (text.includes(from)) {
            text = text.split(from).join(to);
            changed = true;
        }
    }
    if (changed) fs.writeFileSync(file, text);
    return changed;
}

function listJs(directory) {
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory() ? listJs(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))
        .filter((file) => file.endsWith('.js') && path.basename(file) !== 'crossbind.js');
}

// The generated boot code imports `/crossbind.js` and lets the runtime default `path` to the
// site root; both are rewritten to the demo's subpath. Vite emits a template literal, Rspack a
// plain string.
function patchBundles(out, id) {
    const base = `/examples/${id}/`;
    const patched = listJs(out)
        .map((file) =>
            patchFile(file, [
                ['import(`/crossbind.js`)', `import(\`${base}crossbind.js\`)`],
                ['import("/crossbind.js")', `import("${base}crossbind.js")`],
                ['window.Crossbind.initNative({...e,', `window.Crossbind.initNative({path:'${base.slice(0, -1)}',...e,`],
            ]),
        )
        .filter(Boolean).length;
    if (!patched) throw new Error(`${id}: no bundle needed the subpath patch; the generated loader changed shape.`);
}

async function buildVite(project, id, out) {
    await run('npx', ['vite', 'build', '--base', `/examples/${id}/`], project);
    copyDir(path.join(project, 'dist'), out);
    patchBundles(out, id);
}

async function buildRspack(project, id, out) {
    await run('npm', ['run', 'build'], project);
    copyDir(path.join(project, 'dist'), out);
    patchBundles(out, id);
}

async function buildVanilla(project, id, out) {
    await run('npm', ['run', 'build'], project);
    fs.mkdirSync(path.join(out, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(project, 'index.html'), path.join(out, 'index.html'));
    // The template boots with `path: './dist'`; the runtime turns any non-absolute path into a
    // root-relative one, so under a subpath it must be spelled out.
    if (!patchFile(path.join(out, 'index.html'), [["path: './dist'", `path: '/examples/${id}/dist'`]])) {
        throw new Error(`${id}: index.html no longer passes path: './dist'; the template changed shape.`);
    }
    const dist = path.join(project, 'dist');
    for (const name of fs.readdirSync(dist)) {
        if (/\.(js|wasm|txt)$/.test(name)) fs.copyFileSync(path.join(dist, name), path.join(out, 'dist', name));
    }
}

const BUILDERS = { vite: buildVite, vanilla: buildVanilla, rspack: buildRspack };

// Loads the demo from its subpath on a throwaway static server; a failed request or an empty
// page fails the build.
async function verifyDemo(id) {
    // The workspace carries Playwright through the e2e packages, not at the root.
    const { createRequire } = await import('node:module');
    const require = createRequire(path.join(REPOSITORY_ROOT, 'e2e', 'web-vite', 'package.json'));
    const { chromium } = require('@playwright/test');
    const http = await import('node:http');
    const root = path.join(REPOSITORY_ROOT, 'landing', 'public');
    const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.wasm': 'application/wasm',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.txt': 'text/plain',
    };
    const server = http.createServer((request, response) => {
        let file = path.join(root, decodeURIComponent(request.url.split('?')[0]));
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!fs.existsSync(file)) {
            response.writeHead(404);
            response.end('404');
            return;
        }
        response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
        fs.createReadStream(file).pipe(response);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        const failed = [];
        page.on('requestfailed', (request) => failed.push(request.url()));
        page.on('response', (response) => {
            if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
        });
        await page.goto(`http://localhost:${port}/examples/${id}/`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.body.innerText.includes('=>'), null, { timeout: 30000 }).catch(() => {});
        const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
        if (failed.length) throw new Error(`${id}: requests failed under the subpath: ${failed.join(', ')}`);
        if (!text.includes('=>')) throw new Error(`${id}: the page did not render its C++ result; saw "${text.slice(0, 120)}"`);
        return text;
    } finally {
        await browser.close();
        server.close();
    }
}

// Deploy-time check: the page's live frames must be the same crossbind version the site says it
// is, and every demo the builder knows must be present, so a partial `--only` run or a stale
// public/examples/ never ships. `distRoot` is the built site; the demo pages live under it.
export function assertDemosMatchSnapshot(manifest, snapshot, { distRoot = null } = {}) {
    const demos = Array.isArray(manifest?.demos) ? manifest.demos : null;
    if (!demos) throw new Error(`no live demos manifest; run \`pnpm --filter @crossbind/landing demos\` before deploying.`);
    const byId = new Map(demos.map((demo) => [demo.id, demo]));
    const missing = DEMOS.map((demo) => demo.id).filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`live demos missing: ${missing.join(', ')}; rerun the demo build.`);
    const stale = DEMOS.map((demo) => byId.get(demo.id)).filter((demo) => demo.crossbind !== snapshot.version);
    if (stale.length) {
        throw new Error(
            `live demos built with crossbind ${stale.map((demo) => `${demo.id}@${demo.crossbind}`).join(', ')} but the site resolved ${snapshot.version}; rerun the demo build.`,
        );
    }
    if (distRoot) {
        const absent = DEMOS.map((demo) => demo.id).filter((id) => !fs.existsSync(path.join(distRoot, 'examples', id, 'index.html')));
        if (absent.length) throw new Error(`live demos not in the build: ${absent.join(', ')}; rebuild the site.`);
    }
    return manifest;
}

export async function buildExampleDemos({ channel, only = null } = {}) {
    const distTag = channelDistTag(channel);
    const suffix = distTagSuffix(channel);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-demos-'));
    const built = [];
    for (const demo of DEMOS.filter((entry) => !only || only.includes(entry.id))) {
        const project = path.join(workspace, demo.id);
        log(`${demo.id}: npm create crossbind${suffix} -- ${demo.id} ${demo.args.join(' ')}`);
        await run('npm', ['create', `crossbind${suffix}`, '--', demo.id, ...demo.args], workspace);
        await run('npm', ['install', '--no-audit', '--no-fund'], project);
        // crossbind is usually a transitive dependency (through the bundler plugin), so read the
        // installed package directly instead of asking npm ls, which exits non-zero for those.
        const installed = path.join(project, 'node_modules', 'crossbind', 'package.json');
        const crossbindVersion = fs.existsSync(installed) ? JSON.parse(fs.readFileSync(installed, 'utf8')).version : null;
        const out = path.join(DEMOS_ROOT, demo.id);
        fs.rmSync(out, { recursive: true, force: true });
        await BUILDERS[demo.kind](project, demo.id, out);
        const onScreen = await verifyDemo(demo.id);
        log(`${demo.id}: ok - "${onScreen.slice(0, 80)}"`);
        built.push({ id: demo.id, href: `/examples/${demo.id}/`, crossbind: crossbindVersion, onScreen });
    }
    // A partial run (--only) keeps the other demos already on disk in the manifest.
    const manifestFile = path.join(DEMOS_ROOT, MANIFEST_NAME);
    const previous = fs.existsSync(manifestFile) ? (JSON.parse(fs.readFileSync(manifestFile, 'utf8')).demos ?? []) : [];
    const kept = previous.filter(
        (demo) => !built.some((entry) => entry.id === demo.id) && fs.existsSync(path.join(DEMOS_ROOT, demo.id, 'index.html')),
    );
    const order = DEMOS.map((demo) => demo.id);
    const demos = [...kept, ...built].sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
    const manifest = { builtAt: new Date().toISOString(), distTag, demos };
    fs.mkdirSync(DEMOS_ROOT, { recursive: true });
    fs.writeFileSync(path.join(DEMOS_ROOT, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

async function main(argv) {
    const valueOf = (flag) => {
        const index = argv.indexOf(flag);
        return index === -1 ? undefined : argv[index + 1];
    };
    const configFile = valueOf('--config');
    let channel = valueOf('--channel');
    if (!channel && configFile) channel = (await import(pathToFileURL(path.resolve(configFile)).href)).default.channel;
    if (!channel) throw new Error('Pass --channel <beta|rc|stable> or --config <release.config.js>.');
    const only = valueOf('--only')?.split(',');
    const manifest = await buildExampleDemos({ channel, only });
    log(`Wrote ${path.join(DEMOS_ROOT, MANIFEST_NAME)}: ${manifest.demos.length} demos.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    });
}
