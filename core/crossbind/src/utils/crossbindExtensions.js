import path from 'node:path';
import { createRequire } from 'node:module';
import { broughtExtension, ownPackages } from './appExtensions.js';

// crossbind's own folder, whose dependencies name the extensions it brings.
const CORE_ROOT = path.join(import.meta.dirname, '..', '..');

// The extension packages crossbind itself brings, which a project neither installs nor lists.
export const packagesOfCrossbind = () => ownPackages(CORE_ROOT);

let own = null;

// crossbind's own extensions, which every project has by having crossbind: its package sources, and the integrations
// that teach crossbind() each tool. Loaded once, as an extension may keep what it asked its tool.
export function crossbindExtensions() {
    if (!own) {
        const load = createRequire(path.join(CORE_ROOT, 'package.json'));
        own = packagesOfCrossbind().map((name) => broughtExtension(load, name, `update ${name} to match crossbind`));
    }
    return own;
}
