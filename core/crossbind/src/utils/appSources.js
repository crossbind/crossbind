import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte']);
// Native projects and build outputs: large, and never the app's JavaScript.
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'ios', 'android', 'Pods', 'target']);

// The app's own JavaScript and TypeScript sources, whose import statements say what the app uses.
export default function appSourceFiles(projectDir) {
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
        }
    };
    walk(projectDir);
    return files;
}
