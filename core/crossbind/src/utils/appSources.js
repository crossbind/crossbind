import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.html', '.astro', '.mdx']);
// Skip root outputs, while allowing source folders named e.g. src/build or src/android.
const ROOT_OUTPUTS = new Set(['dist', 'build', 'ios', 'android', 'Pods', 'target']);
const IMPORT = /\b(?:from|import\s*\(?|require\s*\()\s*(['"])([^'"\n]+)\1/g;
const packageName = (specifier) => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

function sourceFile(file) {
    const candidates = [file, ...[...SOURCE_EXTENSIONS].map((ext) => `${file}${ext}`), ...[...SOURCE_EXTENSIONS].map((ext) => path.join(file, `index${ext}`))];
    return candidates.find((candidate) => {
        if (!SOURCE_EXTENSIONS.has(path.extname(candidate))) return false;
        try { return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(); } catch { return false; }
    });
}

// require.resolve selects CommonJS conditions. Also read runtime export branches: a bundler may
// choose an import/browser entry whose header imports are absent from the CommonJS entry.
function dependencySources(specifier, importer) {
    const name = packageName(specifier);
    const subpath = specifier.slice(name.length);
    for (let dir = path.dirname(importer); ; dir = path.dirname(dir)) {
        const root = path.join(dir, 'node_modules', name);
        const manifest = path.join(root, 'package.json');
        if (fs.existsSync(manifest)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
                let entry = pkg.exports;
                let wildcard;
                if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).some((key) => key.startsWith('.'))) {
                    const key = `.${subpath}`;
                    entry = entry[key];
                    if (entry === undefined) {
                        for (const pattern of Object.keys(pkg.exports).filter((key) => key.includes('*')).sort((a, b) => b.length - a.length)) {
                            const [before, after] = pattern.split('*');
                            if (key.startsWith(before) && key.endsWith(after) && key.length >= before.length + after.length) {
                                wildcard = key.slice(before.length, key.length - after.length);
                                entry = pkg.exports[pattern];
                                break;
                            }
                        }
                    }
                } else if (subpath) entry = undefined;
                const targets = (value) => typeof value === 'string' ? [value]
                    : Array.isArray(value) ? value.flatMap(targets)
                    : value && typeof value === 'object' ? Object.entries(value).filter(([condition]) => condition !== 'types').flatMap(([, branch]) => targets(branch)) : [];
                const entries = pkg.exports ? targets(entry)
                    : subpath ? [`.${subpath}`] : [pkg.module, typeof pkg.browser === 'string' ? pkg.browser : null, pkg.main ?? 'index.js'];
                return entries.filter(Boolean).flatMap((target) => {
                    const file = path.resolve(root, wildcard === undefined ? target : target.replaceAll('*', wildcard));
                    if (path.relative(root, file).startsWith('..')) return [];
                    return sourceFile(file) ?? [];
                });
            } catch { return []; }
        }
        if (path.dirname(dir) === dir) return [];
    }
}

// Own sources and the dependency modules they reach. Follow imports rather than walking every installed package.
export default function appSourceFiles(projectDir) {
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || (dir === projectDir && ROOT_OUTPUTS.has(entry.name))) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
        }
    };
    if (projectDir && fs.existsSync(projectDir)) walk(projectDir);
    let dependencies = {};
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
        dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
    } catch { /* A source-only project has no package manifest. */ }
    const ownFiles = new Set(files);
    const visited = new Set(files.map((file) => fs.realpathSync(file)));
    for (let i = 0; i < files.length; i += 1) {
        const importer = files[i];
        const require = createRequire(importer);
        const text = fs.readFileSync(importer, 'utf8');
        for (const [, , specifier] of text.matchAll(IMPORT)) {
            const relative = specifier.startsWith('.');
            if (!relative && ownFiles.has(importer) && !Object.hasOwn(dependencies, packageName(specifier))) continue;
            const resolvedFiles = relative ? [] : dependencySources(specifier, importer);
            try { resolvedFiles.push(require.resolve(specifier)); } catch {
                if (relative) resolvedFiles.push(sourceFile(path.resolve(path.dirname(importer), specifier)));
            }
            for (const resolved of resolvedFiles) {
                if (!resolved || !SOURCE_EXTENSIONS.has(path.extname(resolved)) || !fs.existsSync(resolved)) continue;
                const real = fs.realpathSync(resolved);
                if (visited.has(real)) continue;
                visited.add(real);
                files.push(resolved);
            }
        }
    }
    return files;
}

// Whether a changed file is one of those sources.
export function isAppSource(projectDir, file) {
    const relative = path.relative(projectDir, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    const parts = relative.split(path.sep);
    return SOURCE_EXTENSIONS.has(path.extname(file))
        && parts.every((part) => !part.startsWith('.'))
        && !ROOT_OUTPUTS.has(parts[0]);
}
