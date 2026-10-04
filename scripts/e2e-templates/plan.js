/**
 * Turns src/manifest.json (the same file create-crossbind ships) into an ordered
 * list of template "plan items": how to scaffold each one non-interactively and
 * which host capabilities its build needs. Step selection (which npm scripts to
 * actually run) is decided in runner.js once the project is scaffolded, because
 * only then is the real package.json available.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'tooling/create-app/src/manifest.json');

function loadManifest() {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    if (!Array.isArray(manifest) || manifest.length === 0) {
        throw new Error(`Manifest is empty or not an array: ${MANIFEST_PATH}`);
    }
    return manifest;
}

function classify(entry) {
    if (entry.group === 'Mobile') return 'mobile';
    if (entry.kind === 'lib') return 'lib';
    return entry.group.toLowerCase(); // 'web' | 'cloud' | 'backend'
}

/**
 * Mirrors create-crossbind's prompt flow as positional CLI args:
 *   [name, group, framework ?? label, label?]
 * The 4th arg (label) is only needed when more than one entry shares the same
 * "first" choice in the group (e.g. Web/React -> Rspack | Vite).
 */
function scaffoldArgs(entry, manifest, name) {
    const inGroup = manifest.filter((m) => m.group === entry.group);
    const first = entry.framework ?? entry.label;
    const siblings = inGroup.filter((m) => (m.framework ?? m.label) === first);
    const args = [name, entry.group, first];
    if (siblings.length > 1) args.push(entry.label);
    return args;
}

// Capabilities required to attempt the build step. The Wasm/native build runs
// inside the crossbind Docker image; lib-source/lib-cmake ship no build script.
function buildCaps(klass, entry) {
    if (klass === 'web' || klass === 'cloud' || klass === 'backend' || klass === 'native') return ['docker'];
    if (klass === 'lib') return entry.key === 'lib-prebuilt' ? ['docker'] : [];
    return []; // mobile builds are driven by the e2e:* scripts themselves
}

function buildPlan({ namePrefix = '' } = {}) {
    const manifest = loadManifest();
    return manifest.map((entry) => {
        const klass = classify(entry);
        const name = `${namePrefix}${entry.key}`;
        return {
            key: entry.key,
            entry,
            klass,
            name,
            scaffoldArgs: scaffoldArgs(entry, manifest, name),
            buildCaps: buildCaps(klass, entry),
        };
    });
}

module.exports = {
    buildPlan,
    loadManifest,
    classify,
    scaffoldArgs,
    buildCaps,
    MANIFEST_PATH,
    REPO_ROOT,
};
