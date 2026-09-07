#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeProposal } from './dependency-lib.mjs';

function option(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
    return process.argv[index + 1];
}

export function pullRequestMetadata(proposal) {
    const unit = proposal.kind === 'native' ? proposal.unit : proposal.component;
    const scope = proposal.kind === 'native' ? `port-${proposal.unit}` : 'toolchain';
    const description = `update-${unit}-to-${proposal.target}`.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
    const title = `chore(${scope}): update ${unit} to ${proposal.target}`;
    const source = proposal.sourceUrl ? `[upstream](${proposal.sourceUrl})` : 'not provided';
    const affected =
        proposal.kind === 'native'
            ? `all published @crossbind/port-${proposal.unit} platform variants`
            : 'the owned Crossbind toolchain image family';
    const body =
        `## Dependency update\n\n` +
        `| Field | Value |\n|---|---|\n` +
        `| Unit | \`${unit}\` |\n` +
        `| Current | \`${proposal.current}\` |\n` +
        `| Proposed | \`${proposal.target}\` |\n` +
        `| Risk class | \`${proposal.risk}\` |\n` +
        `| Reason | \`${proposal.reason}\` |\n` +
        `| Source | ${source} |\n` +
        `| Affected surface | ${affected} |\n\n` +
        `The bot recomputed source/image integrity data before creating this PR. Linux${proposal.macos ? ' and macOS' : ''} update gates passed on the exact patch. ` +
        `The ordinary PR workflows run again on the bot branch.\n\n` +
        `This PR does not publish packages or images. Native/toolchain changes are never auto-merged. Public package versions must be chosen explicitly before the npm release train is dispatched.\n\n` +
        `<!-- crossbind-dependency-update:${proposal.id} -->\n`;
    return {
        branch: `chore/${scope}/${description}`.slice(0, 220),
        title,
        commit: title,
        body,
    };
}

function main() {
    const proposal = decodeProposal(option('--proposal'));
    const output = option('--output');
    fs.writeFileSync(output, `${JSON.stringify(pullRequestMetadata(proposal), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
