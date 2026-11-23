import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CASES_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases');

// A case's first tag is its group, which the split and the reports go by.
export const GROUPS = [
    'site-to-app', 'new-app', 'native-to-js', 'publish', 'ask', 'existing-project', 'outputs', 'runtime',
    'app-feature', 'ship', 'debug', 'explore', 'no-port', 'pushback', 'brief', 'negative', 'boundary',
];
export const TRIGGERS = ['must', 'must-not', 'either'];
export const EXPECTATIONS = ['do', 'object'];
export const SPLITS = ['train', 'test'];

export function readCaseFiles(extraFiles = []) {
    const tracked = fs.readdirSync(CASES_DIRECTORY)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => path.join(CASES_DIRECTORY, name));
    return [...tracked, ...extraFiles].map((file) => ({ file, cases: JSON.parse(fs.readFileSync(file, 'utf8')) }));
}

// The cases of the repository's table, then those of any file given besides, as one kept out of the repository is.
export function loadCases(extraFiles = []) {
    return readCaseFiles(extraFiles).flatMap(({ cases }) => cases);
}
