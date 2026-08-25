#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'agents/contributor-context.md';
const CHECK = process.argv.includes('--check');
const sourceContent = fs.readFileSync(path.join(ROOT, SOURCE), 'utf8').replaceAll('\r\n', '\n').replace(/\s+$/, '') + '\n';
const banner = `<!-- GENERATED from ${SOURCE} by scripts/build-agent-context.mjs. Do not edit. -->\n\n`;
const outputs = [
    ['AGENTS.md', banner + sourceContent],
    ['GEMINI.md', banner + sourceContent],
    ['.github/copilot-instructions.md', banner + sourceContent],
];

if (CHECK) {
    const stale = outputs.filter(([file, content]) => {
        const absolute = path.join(ROOT, file);
        return !fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content;
    }).map(([file]) => file);
    if (stale.length) {
        process.stderr.write(`Generated contributor context is stale: ${stale.join(', ')}\nRun: pnpm build:agents\n`);
        process.exit(1);
    }
    process.stdout.write('Generated contributor context is current.\n');
} else {
    for (const [file, content] of outputs) {
        const absolute = path.join(ROOT, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
    }
    process.stdout.write(`Generated ${outputs.length} contributor context files.\n`);
}
