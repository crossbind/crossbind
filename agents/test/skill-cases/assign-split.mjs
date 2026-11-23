#!/usr/bin/env node
// Gives each case without a `split` one, at random within its group, so that about two cases in five of each group
// are held out: the improvement rounds read the `train` cases alone, and the score reported comes from `test`.
// A case that has a split keeps it, as moving one would show the rounds a case they are measured on.
//
//   node agents/test/skill-cases/assign-split.mjs [more case files]

import fs from 'node:fs';

import { readCaseFiles } from './load.mjs';

const TEST_SHARE = 0.4;
const SEED = 20261117;

function hash(text) {
    let value = 2166136261;
    for (const character of text) value = Math.imul(value ^ character.codePointAt(0), 16777619);
    return value >>> 0;
}

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), state | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(items, random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
}

const files = readCaseFiles(process.argv.slice(2));
const byGroup = Map.groupBy(files.flatMap(({ cases }) => cases), (entry) => entry.tags[0]);
let assigned = 0;

for (const [group, cases] of byGroup) {
    const waiting = cases.filter((entry) => !entry.split).sort((a, b) => a.id.localeCompare(b.id));
    let total = cases.length - waiting.length;
    let held = cases.filter((entry) => entry.split === 'test').length;
    for (const entry of shuffled(waiting, mulberry32(SEED ^ hash(group)))) {
        total += 1;
        entry.split = held < Math.round(total * TEST_SHARE) ? 'test' : 'train';
        if (entry.split === 'test') held += 1;
        assigned += 1;
    }
}

for (const { file, cases } of files) fs.writeFileSync(file, `${JSON.stringify(cases, null, 4)}\n`);
process.stdout.write(`${assigned} cases took a split; ${files.length} files written.\n`);
