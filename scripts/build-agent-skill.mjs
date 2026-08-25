#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_ROOT = path.join(ROOT, 'agents', 'skills', 'crossbind', 'references');
const CHECK = process.argv.includes('--check');
const GENERATED_BANNER = (source) => `<!-- GENERATED from ${source} by scripts/build-agent-skill.mjs. Do not edit. -->\n\n`;

function normalize(content) {
    return content.replaceAll('\r\n', '\n').replace(/\s+$/, '') + '\n';
}

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function read(relativePath) {
    return normalize(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function documentationSources() {
    const entries = [
        ['docs/playbooks/recommend-crossbind.md', 'recommend.md'],
        ['docs/playbooks/new-port.md', 'port.md'],
    ];
    for (const [sourceDirectory, outputDirectory] of [
        ['docs/api', 'api'],
        ['docs/playbooks/integration', 'integration'],
    ]) {
        const directory = path.join(ROOT, sourceDirectory);
        for (const name of fs.readdirSync(directory).filter((file) => file.endsWith('.md')).sort()) {
            entries.push([`${sourceDirectory}/${name}`, `${outputDirectory}/${name}`]);
        }
    }
    return entries;
}

function portCatalog() {
    const curated = JSON.parse(read('ports/catalog.json'));
    const portDirectories = fs.readdirSync(path.join(ROOT, 'ports'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const curatedNames = Object.keys(curated).sort();
    if (JSON.stringify(portDirectories) !== JSON.stringify(curatedNames)) {
        const missing = portDirectories.filter((name) => !curated[name]);
        const stale = curatedNames.filter((name) => !portDirectories.includes(name));
        throw new Error(`ports/catalog.json mismatch; missing=[${missing.join(', ')}] stale=[${stale.join(', ')}]`);
    }

    const targets = ['wasm', 'android', 'ios', 'wasi', 'bin-wasi'];
    return portDirectories.map((name) => {
        const familyRoot = path.join(ROOT, 'ports', name);
        const pkg = JSON.parse(fs.readFileSync(path.join(familyRoot, 'base', 'package.json'), 'utf8'));
        const supportedTargets = targets.filter((target) => fs.existsSync(path.join(familyRoot, target, 'package.json')));
        const binManifest = path.join(familyRoot, 'bin-wasi', 'package.json');
        const binCommands = fs.existsSync(binManifest)
            ? Object.keys(JSON.parse(fs.readFileSync(binManifest, 'utf8')).bin ?? {}).sort()
            : [];
        return {
            name,
            npm: pkg.name,
            category: curated[name].category,
            summary: curated[name].summary,
            nativeVersion: pkg.nativeVersion ?? null,
            license: pkg.crossbind?.upstream?.license?.declared ?? pkg.license ?? null,
            homepage: pkg.homepage ?? null,
            targets: supportedTargets,
            binCommands,
        };
    });
}

function desiredFiles() {
    const desired = new Map();
    const manifest = [];
    for (const [source, output] of documentationSources()) {
        const sourceContent = read(source);
        const content = GENERATED_BANNER(source) + sourceContent;
        desired.set(output, content);
        manifest.push({ source, output, sha256: sha256(sourceContent) });
    }
    const catalogContent = `${JSON.stringify({ ports: portCatalog() }, null, 2)}\n`;
    desired.set('ports.json', catalogContent);
    manifest.push({ source: 'ports/catalog.json + ports/*/package.json', output: 'ports.json', sha256: sha256(catalogContent) });
    desired.set('manifest.json', `${JSON.stringify({ generatedBy: 'scripts/build-agent-skill.mjs', references: manifest }, null, 2)}\n`);
    return desired;
}

function existingFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    const files = [];
    function visit(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) visit(absolute);
            else if (entry.isFile()) files.push(path.relative(directory, absolute));
        }
    }
    visit(directory);
    return files.sort();
}

const desired = desiredFiles();
if (CHECK) {
    const failures = [];
    for (const [relativePath, content] of desired) {
        const absolute = path.join(REFERENCE_ROOT, relativePath);
        if (!fs.existsSync(absolute)) failures.push(`missing ${relativePath}`);
        else if (fs.readFileSync(absolute, 'utf8') !== content) failures.push(`stale ${relativePath}`);
    }
    for (const file of existingFiles(REFERENCE_ROOT)) {
        if (!desired.has(file)) failures.push(`unexpected ${file}`);
    }
    if (failures.length) {
        process.stderr.write(`Agent reference bundle is not current:\n- ${failures.join('\n- ')}\nRun: pnpm build:agents\n`);
        process.exit(1);
    }
    process.stdout.write(`Agent reference bundle is current (${desired.size} files).\n`);
} else {
    fs.rmSync(REFERENCE_ROOT, { recursive: true, force: true });
    for (const [relativePath, content] of desired) {
        const absolute = path.join(REFERENCE_ROOT, relativePath);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
    }
    process.stdout.write(`Generated ${desired.size} agent reference files.\n`);
}
