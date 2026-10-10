// Deploys the playground Worker with its compiler container, or runs it with `wrangler dev`: assembles the image
// context first (linux/amd64 for Cloudflare, this machine's architecture for dev) and passes the context's hash as
// COMPILER_VERSION, so cached compiles never outlive the compiler that made them. The accounts database follows
// migrations/: the first deploy creates it under its database_name, by which wrangler finds it afterwards, and every
// deploy applies the migrations it lacks right after. A migration only ever adds, so the code deployed a moment earlier
// runs on the schema before it too.
// usage: node scripts/deploy.mjs [--env staging] [--dev]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPTS_DIR, '..');
const isDev = process.argv.includes('--dev');
const envAt = process.argv.indexOf('--env');
// wrangler asks for the environment by name; an empty one is the top level, production.
const envArgs = ['--env', envAt === -1 ? '' : process.argv[envAt + 1]];
const isStaging = envArgs[1] === 'staging';

// Production ships exactly what is committed: crossbind and the compiler as in git, with the dependencies the lockfile
// pins. Staging is where changes are tried before they are committed, so it takes the working tree and says so. Both
// run on the image crossbind pins.
if (!isDev) {
    const committed = ['core/crossbind', 'tooling/cloud', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...committed], { cwd: path.resolve(PACKAGE_DIR, '../..'), encoding: 'utf8' }).trim();
    if (dirty && !isStaging) throw new Error(`commit or stash these changes before deploying:\n${dirty}`);
    if (dirty) process.stdout.write(`staging takes the working tree, uncommitted changes included:\n${dirty}\n`);
    const overrides = Object.keys(process.env).filter((name) => name.startsWith('CROSSBIND_IMAGE_'));
    if (overrides.length > 0) throw new Error(`unset ${overrides.join(', ')} before deploying: the compiler must run on the pinned image`);
}

execFileSync(process.execPath, [path.join(SCRIPTS_DIR, 'build-image.mjs'), ...(isDev ? [] : ['--amd64']), '--context-only'], { stdio: 'inherit' });
const version = fs.readFileSync(path.join(PACKAGE_DIR, '.build', 'version'), 'utf8').trim();
const wrangler = (args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { cwd: PACKAGE_DIR, stdio: 'inherit' });
const location = isDev ? '--local' : '--remote';
if (isDev) wrangler(['d1', 'migrations', 'apply', 'DB', location, ...envArgs]);
wrangler([isDev ? 'dev' : 'deploy', '--var', `COMPILER_VERSION:${version}`, ...envArgs]);
if (!isDev) wrangler(['d1', 'migrations', 'apply', 'DB', location, ...envArgs]);
