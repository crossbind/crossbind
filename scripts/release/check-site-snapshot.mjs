import fs from 'node:fs';
import path from 'node:path';
import { assertDemosMatchSnapshot, MANIFEST_NAME } from '../site/build-example-demos.mjs';
import { assertDeployableSnapshot } from './resolve-site-release.mjs';

// Deploy gate for the landing site: the build writes dist/release-snapshot.json, and only a
// snapshot resolved from live npm and GitHub data may reach Cloudflare Pages, together with the
// live example demos built from that same version.
const file = path.resolve(process.argv[2] ?? 'dist/release-snapshot.json');
const dist = path.dirname(file);
const readJson = (name) => (fs.existsSync(name) ? JSON.parse(fs.readFileSync(name, 'utf8')) : null);
try {
    const snapshot = assertDeployableSnapshot(readJson(file));
    const demos = assertDemosMatchSnapshot(readJson(path.join(dist, 'examples', MANIFEST_NAME)), snapshot, { distRoot: dist });
    process.stdout.write(
        `Deploying the site built from crossbind@${snapshot.version} (${snapshot.channel}, ${snapshot.gitCommit}) with ${demos.demos.length} live demos.\n`,
    );
} catch (error) {
    process.stderr.write(`${file}: ${error.message}\n`);
    process.exit(1);
}
