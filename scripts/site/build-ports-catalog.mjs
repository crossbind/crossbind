import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, listFamilies, PLATFORMS, portDir, portName } from '../lib/ports.js';

// The Libraries catalog for the site, read from the same canonical sources the agent bundle uses
// (ports/catalog.json for category and summary, every port's package.json and build.mjs for
// versions, licenses and the upstream source) plus what npm actually serves on the site's
// dist-tag. Nothing here is a second hand-maintained list: a variant directory in the tree is
// "defined", a dist-tag on npm is "published", and only the latter is shown as supported.

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPOSITORY_URL = 'https://github.com/crossbind/crossbind';
export const REGISTRY_URL = 'https://registry.npmjs.org';
export const REGISTRY_TIMEOUT_MS = 30 * 1000;
export const REGISTRY_CONCURRENCY = 8;
// WASI command tools are the `-bin-wasi` packages and nothing else; an Emscripten web build or a
// `-wasi` library package is never listed as a command tool.
export const BIN_TARGET = 'bin-wasi';
export const LIBRARY_TARGETS = PLATFORMS.filter((target) => target !== BIN_TARGET);

// How upstream spells its own name; the family slug is the fallback for a port not listed here.
const DISPLAY_NAMES = {
    curl: 'cURL',
    expat: 'Expat',
    gdal: 'GDAL',
    geos: 'GEOS',
    geotiff: 'GeoTIFF',
    iconv: 'iconv',
    jpegturbo: 'libjpeg-turbo',
    lerc: 'LERC',
    openssl: 'OpenSSL',
    proj: 'PROJ',
    spatialite: 'SpatiaLite',
    sqlite3: 'SQLite',
    tiff: 'libTIFF',
    webp: 'WebP',
    zlib: 'zlib',
    zstd: 'Zstandard',
};

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function upstreamSource(root, family, nativeVersion) {
    const recipe = path.join(portDir(root, family), 'build.mjs');
    if (!fs.existsSync(recipe)) return null;
    const { default: build } = await import(pathToFileURL(recipe).href);
    const url = build?.getURL?.(nativeVersion);
    return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
}

// Everything the repository knows about its ports, before asking npm anything.
export async function readPortsTree(root = REPOSITORY_ROOT) {
    const curated = readJson(path.join(root, 'ports', 'catalog.json'));
    const families = listFamilies(root);
    const entries = [];
    for (const family of families) {
        const base = readJson(path.join(portDir(root, family), 'package.json'));
        const meta = curated[family];
        if (!meta?.category || !meta?.summary) throw new Error(`ports/catalog.json has no category/summary for ${family}.`);
        if (typeof base.nativeVersion !== 'string') throw new Error(`${portName(family)} declares no nativeVersion.`);
        const targets = PLATFORMS.filter((target) => fs.existsSync(path.join(portDir(root, family, target), 'package.json'))).map((target) => ({
            target,
            package: portName(family, target),
        }));
        const binManifest = path.join(portDir(root, family, BIN_TARGET), 'package.json');
        const binCommands = fs.existsSync(binManifest) ? Object.keys(readJson(binManifest).bin ?? {}).sort() : [];
        entries.push({
            family,
            name: DISPLAY_NAMES[family] ?? family,
            npm: portName(family),
            category: meta.category,
            summary: meta.summary,
            nativeVersion: base.nativeVersion,
            license: base.license ?? null,
            upstreamLicense: base.crossbind?.upstream?.license?.declared ?? null,
            upstreamSource: await upstreamSource(root, family, base.nativeVersion),
            repositoryUrl: `${REPOSITORY_URL}/tree/main/ports/${family}`,
            targets,
            binCommands,
        });
    }
    return entries;
}

export function createRegistryClient({ fetchImplementation = fetch, registry = REGISTRY_URL, timeoutMs = REGISTRY_TIMEOUT_MS } = {}) {
    return {
        async distTags(packageName) {
            const response = await fetchImplementation(`${registry}/${packageName.replaceAll('/', '%2f')}`, {
                headers: { accept: 'application/vnd.npm.install-v1+json' },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`npm registry answered HTTP ${response.status} for ${packageName}.`);
            const body = await response.json();
            return body['dist-tags'] ?? {};
        },
    };
}

// Reads publication facts from the same fixture document the release resolver uses
// (npm.packages[name].distTags), so one CROSSBIND_SITE_RELEASE_FIXTURE covers the whole site.
export function createFixtureRegistryClient(fixture) {
    const packages = fixture?.npm?.packages ?? {};
    return {
        async distTags(packageName) {
            const entry = packages[packageName];
            return entry ? (entry.distTags ?? {}) : null;
        },
    };
}

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(lanes);
    return results;
}

// Marks every variant with the version npm serves on the dist-tag, or null when it is not
// published there. The base (meta) package is checked too, since the install commands use it.
export async function resolvePublication(entries, { distTag, registry, concurrency = REGISTRY_CONCURRENCY, log = () => {} }) {
    const names = entries.flatMap((entry) => [entry.npm, ...entry.targets.map((target) => target.package)]);
    const versions = new Map();
    await mapWithConcurrency(names, concurrency, async (name) => {
        const tags = await registry.distTags(name);
        versions.set(name, tags?.[distTag] ?? null);
    });
    return entries.map((entry) => {
        const published = versions.get(entry.npm);
        const targets = entry.targets.map((target) => ({ ...target, published: versions.get(target.package) }));
        const unpublished = [entry.npm, ...entry.targets.map((target) => target.package)].filter((name) => !versions.get(name));
        if (unpublished.length) log(`${entry.family}: not on npm ${distTag}: ${unpublished.join(', ')}`);
        return { ...entry, published, targets };
    });
}

export async function buildPortsCatalog({ root = REPOSITORY_ROOT, distTag, fixture, registry, log } = {}) {
    if (!distTag) throw new Error('A dist-tag is required to read publication state.');
    const client = registry ?? (fixture ? createFixtureRegistryClient(fixture) : createRegistryClient());
    const entries = await readPortsTree(root);
    const ports = await resolvePublication(entries, { distTag, registry: client, log });
    return {
        schemaVersion: 1,
        source: fixture ? 'fixture' : 'live',
        distTag,
        ports,
    };
}

export function renderCatalogModule(catalog) {
    return `// Generated by scripts/site/build-ports-catalog.mjs before every site build. Do not edit.\nexport default ${JSON.stringify(catalog, null, 4)};\n`;
}
