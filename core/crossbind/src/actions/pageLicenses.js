import fs from 'node:fs';
import path from 'node:path';
import state from '../state/index.js';
import collectLicenseRows, { repositoryUrl } from './licenses.js';

const FILE = 'crossbind-licenses.json';
// crossbind/licenses, from whichever copy of crossbind the page has.
const HELPER = /[\\/]crossbind[\\/]src[\\/]licenses[\\/]index\.js$/;
const TEXT_FILE = /^(licen[cs]e|copying|notice|ofl)([._-].*)?$/i;

// What a bundle holds: its chunks' modules, and the files its assets came from, as the font a stylesheet's url() takes.
function bundledFiles(bundle, root) {
    return Object.values(bundle)
        .flatMap((output) => (output.type === 'chunk'
            ? output.moduleIds
            : (output.originalFileNames ?? []).map((name) => path.resolve(root, name))))
        .map((id) => id.split('?')[0]);
}

function manifestIn(dir, manifests) {
    const file = path.join(dir, 'package.json');
    if (!manifests.has(file)) {
        try {
            manifests.set(file, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
        } catch (error) {
            throw new Error(`crossbind: ${file} holds no JSON: ${error.message}`, { cause: error });
        }
    }
    return manifests.get(file);
}

// The package a file is in: the nearest folder up from it whose package.json names one, as a package's subfolder can
// hold one that names none.
function packageOf(file, manifests) {
    if (!path.isAbsolute(file)) return null;
    for (let dir = path.dirname(path.resolve(file)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
        const manifest = manifestIn(dir, manifests);
        if (manifest?.name) return { dir, manifest };
    }
    return null;
}

function npmEntry({ dir, manifest }) {
    const texts = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .map((file) => `=== ${file} ===\n\n${fs.readFileSync(path.join(dir, file), 'utf8').trim()}`);
    return {
        name: manifest.name,
        version: manifest.version ?? null,
        license: typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? null,
        source: repositoryUrl(manifest) ?? manifest.homepage ?? null,
        text: texts.length > 0 ? texts.join('\n\n') : null,
    };
}

// The npm packages the page carries, but for the project's own code: its package and private ones.
function npmEntriesOf(files) {
    const manifests = new Map();
    const project = path.resolve(state.config.paths.project);
    const packages = new Map(files
        .map((file) => packageOf(file, manifests))
        .filter((found) => found && found.dir !== project && !found.manifest.private)
        .map((found) => [found.dir, found]));
    return [...packages.values()].map(npmEntry);
}

const nativeEntry = (row) => ({
    name: row.name,
    version: row.nativeVersion ?? row.version ?? null,
    license: row.license ?? null,
    source: row.sourceUrl ?? null,
    text: row.licenseText ?? null,
});

// The list a page reads with crossbind/licenses, which its build writes beside it if it does: what the module links and
// an app carries, as `crossbind licenses` lists them, and the npm packages the page's bundle holds, each once. bundle is
// what Rollup or Vite hands generateBundle, root what its assets' original file names are relative to.
export default async function pageLicensesAsset(bundle, { root, platform, runtimeEnv = null }) {
    const files = bundledFiles(bundle, root);
    if (!files.some((file) => HELPER.test(file))) return null;
    const native = (await collectLicenseRows(platform, { runtimeEnv })).map(nativeEntry);
    const listed = new Set();
    const entries = [...native, ...npmEntriesOf(files)]
        .filter(({ name, version }) => !listed.has(`${name}@${version}`) && listed.add(`${name}@${version}`))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { fileName: FILE, source: JSON.stringify(entries) };
}
