#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CLOUDFLARE_CONFIG_FILES = ['wrangler.toml', 'wrangler.jsonc', 'wrangler.json'];
const VITE_CONFIG_FILES = ['vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.ts'];
const FRAMEWORK_RULES = [
    {
        framework: 'react-native-expo',
        dependencies: ['expo', '@expo/cli'],
        requiredDependencies: ['react-native'],
        files: ['app.json', 'app.config.js', 'app.config.ts'],
        targets: ['react-native'],
    },
    {
        framework: 'react-native-cli',
        dependencies: ['react-native'],
        forbiddenDependencies: ['expo', '@expo/cli'],
        files: ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'],
        targets: ['react-native'],
    },
    {
        framework: 'nextjs',
        dependencies: ['next'],
        files: ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts'],
        targets: ['browser', 'node'],
    },
    {
        framework: 'cloudflare-worker',
        dependencies: ['wrangler', '@cloudflare/workers-types'],
        files: CLOUDFLARE_CONFIG_FILES,
        targets: ['edge'],
    },
    {
        framework: 'rspack',
        dependencies: ['@rspack/core', '@rspack/cli'],
        files: ['rspack.config.js', 'rspack.config.mjs', 'rspack.config.cjs', 'rspack.config.ts'],
        targets: ['browser'],
    },
    {
        framework: 'webpack',
        dependencies: ['webpack', 'webpack-cli'],
        files: ['webpack.config.js', 'webpack.config.mjs', 'webpack.config.cjs', 'webpack.config.ts'],
        targets: ['browser'],
    },
    {
        framework: 'vite',
        dependencies: ['vite'],
        files: VITE_CONFIG_FILES,
        targets: ['browser'],
    },
    {
        framework: 'rollup',
        dependencies: ['rollup'],
        files: ['rollup.config.js', 'rollup.config.mjs', 'rollup.config.cjs', 'rollup.config.ts'],
        targets: ['browser'],
    },
];

const REFERENCE_BY_FRAMEWORK = {
    'react-native-expo': 'integration/react-native-expo.md',
    'react-native-cli': 'integration/react-native-cli.md',
    nextjs: 'integration/nextjs.md',
    'cloudflare-worker': 'integration/cloudflare-worker.md',
    'cloudflare-vite': 'integration/README.md',
    rspack: 'integration/webpack-rspack.md',
    webpack: 'integration/webpack-rspack.md',
    vite: 'integration/vite.md',
    rollup: 'integration/rollup.md',
    nodejs: 'integration/nodejs.md',
    vanilla: 'integration/vanilla.md',
    unknown: 'integration/README.md',
};

const NATIVE_FILE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|rs)$/i;
const SKIP_DIRECTORIES = new Set([
    '.crossbind', '.git', '.next', '.turbo', 'build', 'coverage', 'dist',
    'node_modules', 'Pods',
]);
const SKIP_RELATIVE_DIRECTORIES = new Set(['vendor/bundle']);

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function dependencySet(pkg) {
    return new Set([
        ...Object.keys(pkg?.dependencies ?? {}),
        ...Object.keys(pkg?.devDependencies ?? {}),
        ...Object.keys(pkg?.peerDependencies ?? {}),
        ...Object.keys(pkg?.optionalDependencies ?? {}),
    ]);
}

function firstExistingFile(root, candidates) {
    return candidates.find((candidate) => fs.existsSync(path.join(root, candidate))) ?? null;
}

function detectPackageManager(root, pkg) {
    const lockfiles = [
        ['pnpm', 'pnpm-lock.yaml'],
        ['yarn', 'yarn.lock'],
        ['bun', 'bun.lock'],
        ['bun', 'bun.lockb'],
        ['npm', 'package-lock.json'],
    ];
    const lock = lockfiles.find(([, file]) => fs.existsSync(path.join(root, file)));
    if (lock) return { name: lock[0], evidence: lock[1] };
    const declared = String(pkg?.packageManager ?? '').split('@')[0];
    return declared ? { name: declared, evidence: 'package.json#packageManager' } : { name: 'unknown', evidence: null };
}

function detectFramework(root, pkg, dependencies) {
    const cloudflareDependency = ['wrangler', '@cloudflare/workers-types']
        .find((dependency) => dependencies.has(dependency));
    const cloudflareConfig = firstExistingFile(root, CLOUDFLARE_CONFIG_FILES);
    const viteConfig = firstExistingFile(root, VITE_CONFIG_FILES);
    if (cloudflareDependency && cloudflareConfig && dependencies.has('vite') && viteConfig) {
        return {
            framework: 'cloudflare-vite',
            confidence: 'low',
            evidence: [
                { kind: 'dependency', value: cloudflareDependency },
                { kind: 'dependency', value: 'vite' },
                { kind: 'file', value: cloudflareConfig },
                { kind: 'file', value: viteConfig },
            ],
            targets: ['browser', 'edge'],
            conflicts: ['vite', 'cloudflare-worker'],
        };
    }

    for (const rule of FRAMEWORK_RULES) {
        if (rule.forbiddenDependencies?.some((dependency) => dependencies.has(dependency))) continue;
        if (!(rule.requiredDependencies ?? []).every((dependency) => dependencies.has(dependency))) continue;
        const dependency = rule.dependencies.find((candidate) => dependencies.has(candidate));
        if (!dependency) continue;
        const file = firstExistingFile(root, rule.files);
        return {
            framework: rule.framework,
            confidence: file ? 'high' : 'medium',
            evidence: [
                { kind: 'dependency', value: dependency },
                ...(file ? [{ kind: 'file', value: file }] : []),
            ],
            targets: rule.targets,
        };
    }

    const buildScript = String(pkg?.scripts?.build ?? '');
    const runtimeMatch = buildScript.match(/(?:-e|--runtime-env)\s+(browser|edge|node)\b/);
    if (runtimeMatch) {
        const runtime = runtimeMatch[1];
        const framework = runtime === 'node' ? 'nodejs' : runtime === 'edge' ? 'cloudflare-worker' : 'vanilla';
        return {
            framework,
            confidence: runtime === 'edge' ? 'medium' : 'high',
            evidence: [{ kind: 'script', value: `crossbind build -e ${runtime}` }],
            targets: [runtime],
        };
    }

    if (pkg && (pkg.main || pkg.module || pkg.bin)) {
        return {
            framework: 'nodejs',
            confidence: 'medium',
            evidence: [{ kind: 'file', value: 'package.json' }],
            targets: ['node'],
        };
    }
    if (fs.existsSync(path.join(root, 'index.html'))) {
        return {
            framework: 'vanilla',
            confidence: 'medium',
            evidence: [{ kind: 'file', value: 'index.html' }],
            targets: ['browser'],
        };
    }
    return {
        framework: 'unknown',
        confidence: 'low',
        evidence: pkg ? [{ kind: 'file', value: 'package.json' }] : [],
        targets: [],
    };
}

function findNativeSources(root, maxDepth = 4) {
    const found = new Set();
    function visit(directory, depth) {
        if (depth > maxDepth || found.size >= 20) return;
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        let containsNativeSource = false;
        for (const entry of entries) {
            if (entry.isFile() && (NATIVE_FILE.test(entry.name) || entry.name === 'CMakeLists.txt' || entry.name === 'Cargo.toml')) {
                containsNativeSource = true;
            }
        }
        if (containsNativeSource) found.add(path.relative(root, directory) || '.');
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const child = path.join(directory, entry.name);
            const relativeChild = path.relative(root, child).split(path.sep).join('/');
            if (SKIP_DIRECTORIES.has(entry.name) || SKIP_RELATIVE_DIRECTORIES.has(relativeChild)) continue;
            visit(child, depth + 1);
        }
    }
    visit(root, 0);
    return [...found].sort();
}

export function inspectProject(projectPath = process.cwd()) {
    const root = path.resolve(projectPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`Project directory does not exist: ${root}`);
    }

    const pkg = readJsonSafe(path.join(root, 'package.json'));
    const dependencies = dependencySet(pkg);
    const detection = detectFramework(root, pkg, dependencies);
    const packageManager = detectPackageManager(root, pkg);
    const plugins = [...dependencies].filter((name) => name.startsWith('@crossbind/plugin-')).sort();
    const ports = [...dependencies].filter((name) => name.startsWith('@crossbind/port-')).sort();
    const configFile = firstExistingFile(root, [
        'crossbind.config.js', 'crossbind.config.mjs', 'crossbind.config.cjs', 'crossbind.config.ts',
    ]);
    const nativeSources = findNativeSources(root);
    const language = [
        ...(nativeSources.length ? ['native'] : []),
        ...(nativeSources.some((source) => {
            try {
                return fs.readdirSync(path.join(root, source)).some((file) => file.endsWith('.rs') || file === 'Cargo.toml');
            } catch {
                return false;
            }
        }) ? ['rust'] : []),
    ];

    const isEdge = detection.targets.includes('edge');
    const isReactNative = detection.targets.includes('react-native');
    const isBrowser = detection.targets.includes('browser');
    const requiresRuntimeSelection = isBrowser && isEdge;

    return {
        projectPath: root,
        packageManager,
        framework: detection.framework,
        confidence: detection.confidence,
        evidence: detection.evidence,
        targets: detection.targets,
        conflicts: detection.conflicts ?? [],
        language: language.length ? language : ['javascript-or-typescript'],
        nativeSources,
        existingCrossbind: {
            installed: dependencies.has('crossbind'),
            config: configFile,
            plugins,
            ports,
        },
        constraints: {
            requiresRuntimeSelection,
            threadingSupported: requiresRuntimeSelection ? null : !isEdge,
            coopCoepRequiredForMt: requiresRuntimeSelection ? null : isBrowser && !isReactNative,
            workerModeSupported: requiresRuntimeSelection ? null : !isEdge,
            opfsSupported: requiresRuntimeSelection ? null : isBrowser && !isReactNative,
        },
        recommendedReference: REFERENCE_BY_FRAMEWORK[detection.framework] ?? REFERENCE_BY_FRAMEWORK.unknown,
    };
}

function prettyPrint(result) {
    return [
        `Framework:       ${result.framework} (${result.confidence})`,
        `Package manager: ${result.packageManager.name}`,
        `Targets:         ${result.targets.join(', ') || '(unknown)'}`,
        ...(result.conflicts.length ? [`Conflicts:       ${result.conflicts.join(', ')}`] : []),
        `Native sources:  ${result.nativeSources.join(', ') || '(none found)'}`,
        `Crossbind:       ${result.existingCrossbind.installed ? 'installed' : 'not installed'}`,
        `Reference:       ${result.recommendedReference}`,
    ].join('\n');
}

async function main(argv) {
    const pretty = argv.includes('--pretty');
    const projectPath = argv.find((arg) => !arg.startsWith('--')) ?? process.cwd();
    try {
        const result = inspectProject(projectPath);
        process.stdout.write(`${pretty ? prettyPrint(result) : JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`crossbind inspector: ${error.message}\n`);
        process.exitCode = 2;
    }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    await main(process.argv.slice(2));
}
