import fs from 'node:fs';

// Every package's loader bundles its own embind runtime, which keeps its state, and the functions its addon calls by
// name, on globalThis and Module. Shadowing both gives each bundle a scope of its own with the real global as its
// prototype, which the loader hands to its addon: addons of several packages then run in one process.
export default function scopedEmbind(embindFile) {
    const realPath = (file) => {
        try {
            return fs.realpathSync(file);
        } catch (e) {
            return file;
        }
    };
    const embind = realPath(embindFile);
    return {
        name: 'crossbind-scoped-embind',
        transform(code, id) {
            if (realPath(id) !== embind) return null;
            return `const globalThis = Object.create(global);\nconst Module = (globalThis.Module = {});\n${code}\nexport { globalThis as crossbindScope };\n`;
        },
    };
}
