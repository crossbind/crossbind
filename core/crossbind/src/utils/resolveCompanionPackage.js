import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import state from '../state/index.js';

// crossbind's own folder, whose own extensions may declare a companion as well.
const CORE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The binding runtimes ship as their own packages and the ENGINE never depends on them: the
// consumer declares one - directly, or transitively through a platform package or one of
// crossbind's own extensions - and the engine only resolves it. pnpm keeps transitive deps
// unhoisted, so resolution may need to hop through the declaring package, found from the project
// or from crossbind itself; inside this monorepo the package sits next to the engine under core/.
export default function createCompanionResolver({
    pkg, anchors = [], siblingDir, siblingMarker, missingMessage,
}) {
    let cached = null;

    const resolveFrom = (baseDir) => {
        try {
            const req = createRequire(path.join(baseDir, 'package.json'));
            return path.dirname(fs.realpathSync(req.resolve(`${pkg}/package.json`)));
        } catch (e) {
            return null;
        }
    };

    return function resolveCompanionRoot() {
        if (cached) return cached;

        const project = state.config?.paths?.project;
        let root = project ? resolveFrom(project) : null;
        for (const base of [project, CORE_ROOT].filter(Boolean)) {
            for (const anchor of anchors) {
                if (root) break;
                try {
                    const req = createRequire(path.join(base, 'package.json'));
                    const anchorDir = path.dirname(fs.realpathSync(req.resolve(`${anchor}/package.json`)));
                    root = resolveFrom(anchorDir);
                } catch (e) { /* this package is not installed - try the next anchor */ }
            }
        }
        if (!root) {
            const here = path.dirname(fileURLToPath(import.meta.url));
            const sibling = path.resolve(here, '../../..', siblingDir);
            if (fs.existsSync(`${sibling}/${siblingMarker}`)) root = sibling;
        }
        if (!root) {
            throw new Error(missingMessage);
        }
        cached = root;
        return root;
    };
}
