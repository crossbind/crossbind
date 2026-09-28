import fs from 'node:fs';
import createCompanionResolver from './resolveCompanionPackage.js';

// The Rust producer crate + adapters ship in @crossbind/core-embind-rust (same direction rule as
// core-embind-jsi: the consumer declares it, the engine only resolves it).
const PKG = '@crossbind/core-embind-rust';

const resolveEmbindRustRoot = createCompanionResolver({
    pkg: PKG,
    anchors: [
        '@crossbind/plugin-react-native',
        '@crossbind/plugin-vite',
        '@crossbind/plugin-rollup',
        '@crossbind/plugin-metro',
        '@crossbind/plugin-webpack',
    ],
    siblingDir: 'embind-rust',
    siblingMarker: 'crate/Cargo.toml',
    missingMessage: `crossbind: Rust bindings need ${PKG} - add it to your (dev)dependencies.`,
});

export default resolveEmbindRustRoot;

// The package version, stamped into generated bridge manifests for debuggability.
export function embindRustVersion() {
    try {
        return JSON.parse(fs.readFileSync(`${resolveEmbindRustRoot()}/package.json`, 'utf8')).version ?? 'unknown';
    } catch (e) {
        return 'unknown';
    }
}
