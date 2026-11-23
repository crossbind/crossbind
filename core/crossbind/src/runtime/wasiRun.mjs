// Runtime behind the generated `<tool>-wasi` shims in -bin packages. Everything resolves
// from crossbind's own sources of truth at call time: the target matrix (utils/targets.js)
// and the package's crossbind.config.js graph (data/env targetSpecs) - no baked paths.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGETS, targetPathOf, filterTargetSpecs } from '../utils/targets.js';
import { configFileOf } from '../utils/configFile.js';

const DATA_ROOT = '/data';
const FORWARDED_ENV = /^(GDAL_|PROJ_|CPL_|OGR_|VSI|CURL_|SSL_)/;

function walkConfigGraph(config) {
    const nodes = [];
    const seen = new Set();
    const visit = (node) => {
        if (!node?.general?.name || seen.has(node.general.name)) return;
        seen.add(node.general.name);
        nodes.push(node);
        (node.dependencies ?? []).forEach(visit);
    };
    visit(config);
    return nodes;
}

function prebuiltOf(node, targetPath) {
    const nodeDir = dirname(fileURLToPath(node.paths.config));
    return join(nodeDir, node.paths?.output ?? 'dist', 'prebuilt', targetPath);
}

// Blocks layer onto each other: a wasi-only env block adds to the platform-agnostic one
// instead of replacing it, which a plain Object.assign of the blocks would do.
export function mergeSpecs(targetSpecs, target) {
    const matched = filterTargetSpecs(targetSpecs, target);
    return {
        ...Object.assign({}, ...matched),
        data: Object.assign({}, ...matched.map((s) => s.data ?? {})),
        env: Object.assign({}, ...matched.map((s) => s.env ?? {})),
    };
}

export async function run(stubUrl, tool) {
    const pkgDir = join(dirname(fileURLToPath(stubUrl)), '..');

    const probe = spawnSync('wasmtime', ['--version'], { stdio: 'ignore' });
    if (probe.error) {
        console.error(`${tool}-wasi: wasmtime not found on PATH - install it first (https://wasmtime.dev or \`brew install wasmtime\`).`);
        process.exit(127);
    }

    const configFile = configFileOf(pkgDir);
    if (!configFile) {
        console.error(`${tool}-wasi: no crossbind.config.js, .mjs or .cjs in ${pkgDir} - the package has to ship its crossbind config.`);
        process.exit(1);
    }
    const config = (await import(pathToFileURL(configFile).href)).default;
    const wasiTargets = TARGETS.filter((candidate) => candidate.platform === 'wasi');
    const target = wasiTargets.find((candidate) => existsSync(join(pkgDir, config.paths?.output ?? 'dist', 'prebuilt', targetPathOf(candidate))))
        ?? wasiTargets[0];
    const targetPath = targetPathOf(target);
    const own = prebuiltOf(config, targetPath);

    // Three states from the single-source bin map (recipe-derived crossbind-bin.json).
    const binJson = join(own, 'crossbind-bin.json');
    if (!existsSync(binJson)) {
        console.error(`${tool}-wasi: no prebuilt found under ${own} - build it first: pnpm --dir ${pkgDir} build`);
        process.exit(1);
    }
    const tools = JSON.parse(readFileSync(binJson, 'utf8')).tools ?? {};
    if (!(tool in tools)) {
        console.error(`${tool}-wasi: '${tool}' is not in this package's tool map.`);
        console.error(`known tools: ${Object.keys(tools).join(', ') || '(none)'}`);
        process.exit(1);
    }
    // multicall-entry tools live inside the single kind:"binary" host; its dispatcher reads argv[1].
    const isMulticall = tools[tool].kind === 'multicall-entry';
    const hostTool = Object.keys(tools).find((name) => tools[name].kind === 'binary');
    const wasmFile = join(own, 'bin', isMulticall ? hostTool : tool);
    if (!existsSync(wasmFile)) {
        const shipped = Object.entries(tools).filter(([, entry]) => entry.publish).map(([name]) => name);
        console.error(`${tool}-wasi: '${tool}' is known but not part of this install.`);
        console.error(`the npm build ships: ${shipped.join(', ') || '(none)'}`);
        console.error(`to get the full set, build from source: pnpm --dir ${pkgDir} build  (needs docker or a wasi-sdk)`);
        process.exit(1);
    }

    // Declared data/env from the config graph - the same targetSpecs the build consumes.
    const mounts = [];
    const mounted = new Set();
    const guestEnv = {};
    for (const node of walkConfigGraph(config)) {
        const prebuilt = prebuiltOf(node, targetPath);
        const specs = mergeSpecs(node.targetSpecs, target);
        for (const [source, name] of Object.entries(specs.data ?? {})) {
            const hostDir = join(prebuilt, source);
            if (mounted.has(name) || !existsSync(hostDir)) continue;
            mounted.add(name);
            mounts.push(`--dir=${hostDir}::${DATA_ROOT}/${name}`);
        }
        for (const [key, value] of Object.entries(specs.env ?? {})) {
            // Function-valued env entries need CLI state (wasm loaders evaluate them); skip here.
            if (typeof value === 'function' || key in process.env || key in guestEnv) continue;
            guestEnv[key] = String(value).replaceAll('_CROSSBIND_DATA_PATH_', DATA_ROOT);
        }
    }
    for (const [key, value] of Object.entries(process.env)) {
        if (FORWARDED_ENV.test(key)) guestEnv[key] = value;
    }

    // Only the host cwd is preopened; absolute host paths stay invisible by design.
    const args = [
        'run',
        '-S', 'inherit-network=y', '-S', 'allow-ip-name-lookup=y', '-S', 'tcp=y',
        '--dir=.',
        ...mounts,
        ...Object.entries(guestEnv).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
        wasmFile,
        ...(isMulticall ? [tool] : []),
        ...process.argv.slice(2),
    ];
    const result = spawnSync('wasmtime', args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}
