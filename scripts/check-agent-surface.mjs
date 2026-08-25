#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const requiredFiles = [
    'agents/skills/crossbind/SKILL.md',
    'agents/skills/crossbind/scripts/inspect-project.mjs',
    'agents/skills/crossbind/references/manifest.json',
    'agents/skills/crossbind/references/ports.json',
    'agents/contributor-context.md',
];
const forbiddenPaths = [
    'tooling/mcp',
    'agents/commands',
    'agents/evals',
    'agents/.mcp.json',
    'agents/.claude-plugin',
    'agents/.codex-plugin',
    'agents/.cursor-plugin',
    'agents/.github',
    'agents/gemini-extension.json',
    '.claude-plugin',
    '.cursor-plugin',
    '.agents/plugins',
    '.github/plugin',
    '.gitnexusrc',
    '.gitnexusignore',
    '.gitnexus',
    '.mcp.json',
    '.claude/skills/gitnexus',
    '.claude/skills/generated',
    // These retired entrypoints must not return as parallel sources of agent guidance or tests.
    'docs/playbooks/new-package.md',
    'agents/skills/crossbind/references/package.md',
    'agents/test/routing-evals.test.mjs',
];

for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(ROOT, file))) failures.push(`missing ${file}`);
}
for (const file of forbiddenPaths) {
    if (fs.existsSync(path.join(ROOT, file))) failures.push(`forbidden path exists: ${file}`);
}

const skillRoots = fs.readdirSync(path.join(ROOT, 'agents', 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
if (JSON.stringify(skillRoots) !== JSON.stringify(['crossbind'])) {
    failures.push(`expected one skill named crossbind; found [${skillRoots.join(', ')}]`);
}

const currentSurface = [
    'agents',
    'docs',
    'CONTRIBUTING.md',
    'README.md',
    'core/crossbind/README.md',
    'landing/src',
    'AGENTS.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
];
// Architecture decision records keep the superseded MCP wording on purpose; research notes are untracked.
const excludedDirectories = new Set(['docs/adr', 'docs/research']);
const forbiddenContent = /@crossbind\/mcp|mcpServers|crossbind_(?:recommend|list_ports|detect_framework|get_api_reference|scaffold_port|build_port|check_native_versions|doctor|cloud_build_port)|9 MCP tools/i;
const removedDocumentationRoutes = /crossbind\.dev\/docs\/agent|crossbind\.dev\/llms/i;
const obsoleteRepositoryLanguage = /sub-arches?|coming via MCP|Sprint \d+|build:(?:packages|samples|playgrounds)|ports\/<[^>]+>-(?:wasm|android|ios|wasi|bin-wasi)/i;

function textFiles(target) {
    if (!fs.existsSync(target)) return [];
    if (fs.statSync(target).isFile()) return [target];
    const files = [];
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const absolute = path.join(target, entry.name);
        if (entry.isDirectory()) {
            if (excludedDirectories.has(path.relative(ROOT, absolute))) continue;
            files.push(...textFiles(absolute));
        }
        else if (entry.isFile() && /\.(?:js|jsx|json|md|mjs|toml|yaml|yml)$/.test(entry.name)) files.push(absolute);
    }
    return files;
}

for (const surface of currentSurface) {
    for (const file of textFiles(path.join(ROOT, surface))) {
        const content = fs.readFileSync(file, 'utf8');
        if (forbiddenContent.test(content)) failures.push(`removed MCP surface remains in ${path.relative(ROOT, file)}`);
        if (removedDocumentationRoutes.test(content)) failures.push(`dead documentation route referenced in ${path.relative(ROOT, file)}`);
        if (obsoleteRepositoryLanguage.test(content)) failures.push(`obsolete repository terminology remains in ${path.relative(ROOT, file)}`);
    }
}

const context = fs.existsSync(path.join(ROOT, 'AGENTS.md')) ? fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8') : '';
for (const heading of ['## What crossbind is', '## Repository map', '## Validation matrix', '## Repository safety']) {
    if (!context.includes(heading)) failures.push(`AGENTS.md missing ${heading}`);
}
for (const repositoryTerm of ['ports/<name>/base', '@crossbind/example-*', '@crossbind/e2e-*', '`tooling/`']) {
    if (!context.includes(repositoryTerm)) failures.push(`AGENTS.md missing current repository term: ${repositoryTerm}`);
}

if (failures.length) {
    process.stderr.write(`Agent surface check failed:\n- ${failures.join('\n- ')}\n`);
    process.exit(1);
}
process.stdout.write('Agent surface is single-skill, generated and aligned with the current repository layout.\n');
