import catalog from '../../generated/ports-catalog.js';

// The Libraries catalog, generated before every build by scripts/site/build-ports-catalog.mjs
// from ports/catalog.json, the port manifests and what npm serves on the release channel's
// dist-tag. Only a published variant counts as supported.
export const PORTS_CATALOG = catalog;

export const PORTS = [...catalog.ports].sort((left, right) => left.name.localeCompare(right.name, 'en'));

export const BIN_TARGET = 'bin-wasi';

export const CATEGORY_LABELS = {
    geo: 'Geospatial',
    image: 'Imaging',
    database: 'Database',
    crypto: 'Crypto and TLS',
    network: 'Networking',
    text: 'Text',
    compression: 'Compression',
};

export const TARGET_LABELS = {
    wasm: 'Web and Node.js',
    wasi: 'WASI library',
    android: 'Android',
    ios: 'iOS',
    'bin-wasi': 'WASI commands',
};

export const publishedTarget = (port, target) => port.targets.find((entry) => entry.target === target && entry.published) ?? null;

export const publishedLibraryTargets = (port) => port.targets.filter((entry) => entry.target !== BIN_TARGET && entry.published);

// Command tools are the published -bin-wasi packages only; a web or library build never counts.
export const WASI_TOOL_PORTS = PORTS.filter((port) => port.binCommands.length > 0 && publishedTarget(port, BIN_TARGET));
