import fs from 'node:fs';
import path from 'node:path';
import appSourceFiles from './appSources.js';

const PREFIX = 'cargo:';
const RUST_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MODULE_IMPORT = /['"`]cargo:([A-Za-z0-9_-]+)((?:\/[A-Za-z_][A-Za-z0-9_]*)+)['"`]/g;

export function parseCargoImport(source) {
    const [crateName, ...modulePath] = source.slice(PREFIX.length).split('/');
    const bad = modulePath.find((segment) => !RUST_IDENT.test(segment));
    if (bad !== undefined) {
        throw new Error(`crossbind: '${source}' - '${bad}' is not a Rust module name; write the path as cargo:<crate>/<module>/<submodule>.`);
    }
    return { crateName, modulePath };
}

// The marker's file name carries the module path after dots, which crate and module names cannot contain.
export function cargoMarkerName({ crateName, modulePath }) {
    return [crateName, ...modulePath].join('.');
}

export function parseCargoMarkerName(name) {
    const [crateName, ...modulePath] = name.split('.');
    return { crateName, modulePath };
}

export function writeCargoMarker(cacheDir, cargoImport) {
    const marker = path.join(cacheDir, 'rust-crates', `${cargoMarkerName(cargoImport)}.rs`);
    if (!fs.existsSync(marker)) {
        fs.mkdirSync(path.dirname(marker), { recursive: true });
        fs.writeFileSync(marker, `// crossbind cargo crate import marker: ${[cargoImport.crateName, ...cargoImport.modulePath].join('/')}\n`);
    }
    return marker;
}

// A specifier built at run time is not found.
export function findCargoModuleImports(text) {
    return [...text.matchAll(MODULE_IMPORT)].map((m) => ({ crateName: m[1], modulePath: m[2].slice(1).split('/') }));
}

export function findCargoModuleImportsIn(projectDir) {
    return appSourceFiles(projectDir).flatMap((file) => findCargoModuleImports(fs.readFileSync(file, 'utf8')));
}
