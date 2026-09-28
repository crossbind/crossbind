import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import state from '../state/index.js';

// The binding runtimes ship as their own packages and the ENGINE never depends on them: the
// consumer declares one - directly, or transitively through a platform plugin - and the engine
// only resolves it. pnpm keeps transitive deps unhoisted, so resolution may need to hop through
// the declaring plugin; inside this monorepo the package sits next to the engine under core/.
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
        if (!root && project) {
            for (const anchor of anchors) {
                try {
                    const req = createRequire(path.join(project, 'package.json'));
                    const anchorDir = path.dirname(fs.realpathSync(req.resolve(`${anchor}/package.json`)));
                    root = resolveFrom(anchorDir);
                    if (root) break;
                } catch (e) { /* this plugin is not installed - try the next anchor */ }
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
