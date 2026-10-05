import fs from 'node:fs';
import loadJson from '../utils/loadJson.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import { parseCppSurface, emitCppDts } from '../utils/cppDts.js';
import { headerAliases } from '../utils/boundHeaders.js';
import { runtimeEntryModule, uniqueBindings } from '../utils/runtimeEntries.js';

function namesOf({ file, bridge }) {
    const names = loadJson(`${bridge}.exports.json`);
    if (!names) throw new Error(`crossbind: ${file} left no export list beside its bridge (${bridge}.exports.json).`);
    return [...names, ...headerAliases(fs.readFileSync(file, 'utf8'), names)];
}

function surfaceOf(headers) {
    const classes = new Map();
    headers.filter(({ file }) => !file.endsWith('.i')).forEach(({ file }) => {
        parseCppSurface(fs.readFileSync(file, 'utf8'), () => {}).classes
            .forEach((cls) => { if (!classes.has(cls.name)) classes.set(cls.name, cls); });
    });
    return { classes: [...classes.values()] };
}

// Writes the entry module of one runtime binary and its declarations, from the headers bound into it,
// each { file, bridge }.
export default function writeRuntimeEntry(entry, headers, runtime) {
    const names = headers.flatMap(namesOf);
    writeIfChanged(entry, runtimeEntryModule(names, runtime));
    writeIfChanged(entry.replace(/\.mjs$/, '.d.mts'), emitCppDts(surfaceOf(headers), uniqueBindings(names).map(({ local }) => local), 'sync'));
}
