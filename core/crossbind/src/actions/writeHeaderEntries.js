import fs from 'node:fs';
import upath from 'upath';
import loadJson from '../utils/loadJson.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import { parseCppSurface, emitCppDts } from '../utils/cppDts.js';
import { headerAliases, headerEntryPath, headerEntryModule } from '../utils/boundHeaders.js';

const localName = (name) => (typeof name === 'string' ? name : name.local);

// Each bound header gets an entry module at its include path in the output, so `<package>/<header>`
// resolves through one `./*.h` export pattern, with the header's declarations beside it.
export default function writeHeaderEntries(headers, { outputDir, loaderName }) {
    headers.forEach(({ specifier, file, bridge }) => {
        const entry = `${outputDir}/${headerEntryPath(specifier)}`;
        const names = loadJson(`${bridge}.exports.json`);
        if (!names) throw new Error(`crossbind: ${specifier} left no export list beside its bridge (${bridge}.exports.json).`);
        const loader = upath.relative(upath.dirname(entry), `${outputDir}/${loaderName}`);
        const headerText = fs.readFileSync(file, 'utf8');
        const exported = [...names, ...headerAliases(headerText, names)];
        writeIfChanged(`${entry}.cjs`, headerEntryModule(exported, loader.startsWith('.') ? loader : `./${loader}`));
        writeIfChanged(`${entry}.d.cts`, emitCppDts(parseCppSurface(headerText, () => {}), exported.map(localName), 'sync'));
    });
}
