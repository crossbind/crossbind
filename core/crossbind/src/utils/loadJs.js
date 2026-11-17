import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// The reads of a module again so far, each of which names its module apart from those before.
let freshReads = 0;

// A file's module, which isFresh reads again, as the file may have changed since this process read it: Node keeps an ES
// module by its URL and a CommonJS one by its path.
function importOf(filePath, isFresh) {
    const href = pathToFileURL(filePath).href;
    if (!isFresh) return import(href);
    delete require.cache[require.resolve(filePath)];
    freshReads += 1;
    return import(`${href}?fresh=${freshReads}`);
}

export default async function loadJs(path, fileName, fileExt = ['json', 'js', 'mjs', 'cjs', 'ts'], { isFresh = false } = {}) {
    let filePath;
    fileExt.some((e) => {
        filePath = `${path}/${fileName}.${e}`;
        if (!fs.existsSync(filePath)) {
            filePath = null;
            return false;
        }
        return true;
    });

    if (filePath) {
        let file = filePath.endsWith('.json')
            ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
            : await importOf(filePath, isFresh);

        if (file && file.default) file = file.default;

        if (typeof file === 'function') {
            return file();
        }
        if (typeof file === 'object') {
            return file;
        }
    }

    return null;
}
