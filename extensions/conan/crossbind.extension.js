import fs from 'node:fs';
import path from 'node:path';
import { hostProfile, settingsUser, BUILD_PROFILE } from './src/profile.js';
import {
    normalizeConanDependencies, conanRequires, conanOptionArgs, assertRecipeOptions,
} from './src/dependencies.js';
import { conanPackagesOf } from './src/graph.js';

// The JSON graph carries conandata, the source URL and SHA-256 of the license rows, from 2.19 on.
const MIN_CONAN_VERSION = [2, 19];
// Raised when what an install runs, or leaves in the home it runs with, changes: packages an older one staged
// are then made again.
const INSTALL_FORMAT = 1;
const APPLE_PLATFORM_NAMES = { ios: 'iOS', darwin: 'macOS' };
// conan takes its home from the first .conanrc at or above its working directory, ahead of CONAN_HOME;
// one in the working directory itself is always that first one.
const CONANRC = 'conan_home=./home\n';

// A Conan home holds code conan runs (plugins, hooks) and settings every recipe obeys (global.conf,
// remotes), and the recipes it builds can write to it. So every run gets a home of its own, in the run's
// work directory; only the package store outlives a run.
function writeHome(api) {
    fs.writeFileSync(path.join(api.work.dir, '.conanrc'), CONANRC);
    fs.mkdirSync(path.join(api.work.dir, 'home'), { recursive: true });
    fs.writeFileSync(path.join(api.work.dir, 'home', 'global.conf'), [
        `core.cache:storage_path=${api.store.path()}`,
        'core:non_interactive=True',
        '',
    ].join('\n'));
}

// The first line conan prints for --version, or nothing where no conan runs. conan migrates the home it
// starts in, even for --version, so it starts in one of the run's instead of the user's ~/.conan2.
function conanVersionOf(api) {
    fs.writeFileSync(path.join(api.work.dir, '.conanrc'), CONANRC);
    try {
        return api.run(['conan', '--version']).stdout.split('\n')[0].trim();
    } catch {
        return '';
    }
}

function assertConanVersion(version, platform) {
    const [major, minor] = (version.match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
    const [needMajor, needMinor] = MIN_CONAN_VERSION;
    if (major > needMajor || (major === needMajor && minor >= needMinor)) return;
    const need = `Conan ${MIN_CONAN_VERSION.join('.')} or later; found ${version || 'none'}.`;
    throw new Error(APPLE_PLATFORM_NAMES[platform]
        ? `crossbind: Conan packages for ${APPLE_PLATFORM_NAMES[platform]} build on this Mac, with the conan on the PATH, which must be ${need} Install or upgrade it with \`brew install conan\` (\`brew upgrade conan\`) or \`pipx install conan\`.`
        : `crossbind: RUNNER=LOCAL runs conan from the PATH and needs ${need}`);
}

// A file conan left in the work directory, parsed, or null. Recipes write there too: the api's read follows no
// link one planted, and the parse error is left out, as it quotes the text.
function readJson(api, name) {
    const text = api.work.read(name);
    try {
        return text === null ? null : JSON.parse(text);
    } catch {
        return null;
    }
}

// The lockfile comes back from where the recipes ran, so only a lockfile goes into the project.
function lockfileText(api) {
    const lock = readJson(api, 'resolution.lock');
    if (typeof lock?.version !== 'string') {
        throw new Error('crossbind: conan wrote no lockfile crossbind can read, so conan.lock is left as it was.');
    }
    return `${JSON.stringify(lock, null, 4)}\n`;
}

// Conan as a crossbind package source: the packages of `packages.conan`, installed with `conan install`
// for each target and built with the toolchain crossbind builds that target with.
export default function conan() {
    // The conan on this machine's PATH, asked until it answers, then kept: a machine without one may get it while a
    // build server runs.
    let version = '';
    const conanVersion = (api) => {
        version ||= conanVersionOf(api);
        return version;
    };

    return {
        name: 'conan',
        contract: 2,
        root: import.meta.dirname,
        packageSource: {
            // The package folders conan reports: downloaded binaries sit in p/<ref>/p of the store, ones
            // conan built in b/<ref>/p. Sources and build folders stay where conan ran.
            storeUnits: ['p/*/p', 'b/*/p'],
            check: normalizeConanDependencies,
            // An image says which conan it runs; on this machine only conan itself does.
            inputs(api, { toolchain }) {
                return {
                    format: INSTALL_FORMAT, host: hostProfile(toolchain), build: BUILD_PROFILE, conan: api.isLocal ? conanVersion(api) : null,
                };
            },
            install(api, { dependencies, toolchain, lock }) {
                writeHome(api);
                if (api.isLocal) assertConanVersion(conanVersion(api), toolchain.platform);
                const file = (...segments) => path.join(api.work.dir, ...segments);
                fs.writeFileSync(file('host.profile'), hostProfile(toolchain));
                fs.writeFileSync(file('build.profile'), BUILD_PROFILE);
                const settings = settingsUser(toolchain);
                if (settings) fs.writeFileSync(file('home', 'settings_user.yml'), settings);
                if (lock !== null) fs.writeFileSync(file('input.lock'), lock);
                api.run([
                    'conan', 'install',
                    ...conanRequires(dependencies).flatMap((reference) => ['--requires', reference]),
                    ...conanOptionArgs(dependencies),
                    '-pr:h', api.work.path('host.profile'),
                    '-pr:b', api.work.path('build.profile'),
                    '--output-folder', api.work.path('output'),
                    '--build=missing',
                    '--format=json',
                    // A file, since a build tool writing to stdout would end up inside the JSON.
                    '--out-file', api.work.path('graph.json'),
                    // Unless told which lockfile to use, conan takes any conan.lock in its working directory.
                    ...(lock !== null ? ['--lockfile', api.work.path('input.lock'), '--lockfile-partial'] : ['--lockfile=']),
                    '--lockfile-out', api.work.path('resolution.lock'),
                ], { env: { CONAN_HOME: api.work.path('home') } });

                const graph = readJson(api, 'graph.json')?.graph;
                if (!graph) throw new Error(`crossbind: conan install wrote no graph crossbind can read. Its log is in ${api.logFile}.`);
                const packages = conanPackagesOf(graph);
                assertRecipeOptions(dependencies, graph.nodes);
                return { packages, lock: lockfileText(api) };
            },
        },
    };
}
