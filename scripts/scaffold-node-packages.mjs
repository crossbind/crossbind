#!/usr/bin/env node
// Writes the standalone Node-API packages of a port family: ports/<family>/standalone-napi, which binds
// the family's public headers and exports them from its root, and ports/<family>/standalone-napi-<platform>-<arch>,
// the packages npm installs the addons from. Each builds itself: an addon package links its own addon, and
// the package of the bindings writes the loader and entry that load it.
//
//   node scripts/scaffold-node-packages.mjs zlib [geos ...] [--force]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { familyDir, portDir, portName } from './lib/ports.js';
import { SBOM_FILE } from './release/node-packages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The platform packages the addons link, in the order crossbind builds them.
const SOURCE_PLATFORMS = ['darwin', 'linux', 'linuxmusl', 'win32'];
const ADDON_TARGETS = [
    { platform: 'darwin', arch: 'arm64', os: 'darwin', label: 'macOS arm64' },
    { platform: 'darwin', arch: 'x64', os: 'darwin', label: 'macOS x64' },
    { platform: 'linux', arch: 'arm64', os: 'linux', libc: 'glibc', label: 'Linux arm64 (glibc)' },
    { platform: 'linux', arch: 'x64', os: 'linux', libc: 'glibc', label: 'Linux x64 (glibc)' },
    { platform: 'linuxmusl', arch: 'arm64', os: 'linux', libc: 'musl', label: 'Linux arm64 (musl)' },
    { platform: 'linuxmusl', arch: 'x64', os: 'linux', libc: 'musl', label: 'Linux x64 (musl)' },
    { platform: 'win32', arch: 'arm64', os: 'win32', label: 'Windows arm64' },
    { platform: 'win32', arch: 'x64', os: 'win32', label: 'Windows x64' },
];
const PLATFORM_KEYWORDS = new Set(['webassembly', 'wasm', 'android', 'ios', 'react-native']);
const NODE_TARGET = 'standalone-napi';
// Refuses to pack a package the build did not fill.
const PREPACK = 'node ../../../scripts/check-node-package.mjs';
// The oldest Node.js the release train verifies the packages with (releases/npm/node-22.version) that
// require()s their ES module entry.
const NODE_ENGINE = '>=22.12';

const targetOf = ({ platform, arch }) => `${NODE_TARGET}-${platform}-${arch}`;
const addonFileOf = (family, { platform, arch }) => `dist/${family}-${NODE_TARGET}.${platform}-${arch}.node`;
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`);

function common(base) {
    return {
        version: base.version,
        nativeVersion: base.nativeVersion,
        homepage: base.homepage,
        repository: base.repository,
        license: base.license,
    };
}

// The platform packages every package of the family reads: its own platform's archives, and the linux headers
// its bridges come from.
const devDependenciesOf = (family) => ({
    crossbind: 'workspace:^',
    ...Object.fromEntries(SOURCE_PLATFORMS.map((platform) => [portName(family, platform), 'workspace:^'])),
});

function nodeManifest(family, base) {
    const name = portName(family, NODE_TARGET);
    return {
        name,
        ...common(base),
        description: `${family} for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux and Windows, built with crossbind.`,
        type: 'module',
        engines: { node: NODE_ENGINE },
        exports: {
            '.': { types: './dist/node/napi.d.mts', default: './dist/node/napi.mjs' },
            './package.json': './package.json',
        },
        files: ['dist/**/*.cjs', 'dist/node', 'dist/data', SBOM_FILE],
        scripts: {
            build: 'crossbind build -p darwin,linux,linuxmusl,win32 -e node -b release && crossbind licenses -e node --package',
            clear: 'rm -rf .crossbind dist',
            e2e: 'node ../../../scripts/e2e-node-package.mjs',
            prepack: PREPACK,
        },
        optionalDependencies: Object.fromEntries(ADDON_TARGETS.map((target) => [portName(family, targetOf(target)), 'workspace:*'])),
        devDependencies: devDependenciesOf(family),
        keywords: [...(base.keywords ?? []).filter((keyword) => !PLATFORM_KEYWORDS.has(keyword)), 'node', 'node-api', 'prebuilt'],
    };
}

function addonManifest(family, base, target) {
    const main = addonFileOf(family, target);
    return {
        name: portName(family, targetOf(target)),
        ...common(base),
        description: `${target.label} addon of ${portName(family, NODE_TARGET)}, which npm installs on a matching machine.`,
        os: [target.os],
        cpu: [target.arch],
        ...(target.libc ? { libc: [target.libc] } : {}),
        main,
        files: [main, SBOM_FILE],
        scripts: {
            build: `crossbind build -p ${target.platform} -a ${target.arch} -e node -b release && crossbind licenses --platform ${target.platform} -e node --package`,
            clear: 'rm -rf .crossbind dist',
            prepack: PREPACK,
        },
        devDependencies: devDependenciesOf(family),
    };
}

// An addon binds what the package of the bindings binds, so the hand-picked headers stay in one config.
function addonConfig() {
    return `import bindings from '../${NODE_TARGET}/crossbind.config.js';

export default { ...bindings, paths: { ...bindings.paths, config: import.meta.url } };
`;
}

function nodeConfig(family) {
    const imports = SOURCE_PLATFORMS.map((platform) => `import ${platform} from '${portName(family, platform)}/crossbind.config.js';`);
    return `${imports.join('\n')}

export default {
    general: { name: '${family}-${NODE_TARGET}' },
    dependencies: [${SOURCE_PLATFORMS.join(', ')}],
    export: {
        bindings: { headers: ['${portName(family)}'] },
    },
    paths: {
        config: import.meta.url,
        base: '../../..',
        output: 'dist',
    },
};
`;
}

function nodeReadme(family, base, headers) {
    const name = portName(family, NODE_TARGET);
    const module = family.replace(/\W/g, '_');
    return `# ${name}

${family} for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

\`\`\`bash
npm install ${name}
\`\`\`

The package root exports every function, class and constant of the public headers, ready once \`initNative()\` resolves:

\`\`\`js
import * as ${module} from '${name}';

await ${module}.initNative();
\`\`\`

Headers: ${headers.map((header) => `\`${header}\``).join(', ')}.

Built with [crossbind](https://crossbind.dev) from [${portName(family)}](${base.homepage}).
`;
}

async function publicHeadersOf(family) {
    const { default: mergeConfig } = await import(pathToFileURL(path.join(portDir(ROOT, family), 'mergeConfig.mjs')).href);
    const headers = mergeConfig().export?.publicHeaders ?? [];
    if (headers.length === 0) throw new Error(`${family}: base/mergeConfig.mjs lists no export.publicHeaders`);
    return headers;
}

function writePackage(dir, files, force) {
    if (fs.existsSync(dir) && !force) throw new Error(`${path.relative(ROOT, dir)} exists; pass --force to rewrite it`);
    fs.mkdirSync(dir, { recursive: true });
    Object.entries(files).forEach(([file, content]) => {
        if (typeof content === 'string') fs.writeFileSync(path.join(dir, file), content);
        else writeJson(path.join(dir, file), content);
    });
}

export async function scaffoldNodePackages(family, { force = false } = {}) {
    if (!fs.existsSync(familyDir(ROOT, family))) throw new Error(`unknown port family: ${family}`);
    const base = JSON.parse(fs.readFileSync(path.join(portDir(ROOT, family), 'package.json'), 'utf8'));
    const headers = await publicHeadersOf(family);
    // LICENSE and the SBOM come from each build: `crossbind licenses --package` derives them.
    writePackage(portDir(ROOT, family, NODE_TARGET), {
        'package.json': nodeManifest(family, base),
        'crossbind.config.js': nodeConfig(family),
        'README.md': nodeReadme(family, base, headers),
    }, force);
    ADDON_TARGETS.forEach((target) => writePackage(portDir(ROOT, family, targetOf(target)), {
        'package.json': addonManifest(family, base, target),
        'crossbind.config.mjs': addonConfig(),
    }, force));
}

async function main(args) {
    const force = args.includes('--force');
    const families = args.filter((arg) => !arg.startsWith('--'));
    if (families.length === 0) throw new Error('usage: scaffold-node-packages.mjs <family>... [--force]');
    for (const family of families) {
        await scaffoldNodePackages(family, { force });
        console.log(`scaffold-node-packages: ${portName(family, NODE_TARGET)} and its ${ADDON_TARGETS.length} addon packages`);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`scaffold-node-packages: ${error.message}`);
        process.exit(1);
    });
}
