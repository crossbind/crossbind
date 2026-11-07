import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { discoverPublishablePackages } from '../release/workspace-release.mjs';
import {
    createFixtureRegistryClient,
    createRegistryClient,
    mapWithConcurrency,
    REGISTRY_CONCURRENCY,
    REPOSITORY_ROOT,
} from './build-ports-catalog.mjs';

// Every package the release train publishes, with the version npm serves on the site's dist-tag, or null where it
// serves none, and the releases its tags record, for /packages/ and the page of each package there. A release lists
// the commits that changed the package's folder since the release before it, but for those that prepared a train.

const TRAIN_COMMIT = /^chore\(release\)/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COMMIT_LENGTH = 10;
const FETCH_HINT = 'fetch its history and tags (fetch-depth: 0 in CI, git fetch --unshallow --tags here)';

// A library's packages share the history of ports/<family>; every other package has its own folder's.
const historyFolderOf = (folder) => (folder.startsWith('ports/') ? folder.split('/').slice(0, 2).join('/') : folder);

const gitIn =
    (root) =>
    (...args) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// Every tag `<package>@<version>` of the packages named, with the commit it names, when it was made and that day.
function releaseTags(git, names) {
    return git('for-each-ref', '--format=%(refname:strip=2)%09%(*objectname)%09%(objectname)%09%(creatordate:iso-strict)', 'refs/tags')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const [tag, peeled, object, created] = line.split('\t');
            const split = tag.lastIndexOf('@');
            return { name: tag.slice(0, split), version: tag.slice(split + 1), commit: peeled || object, created };
        })
        .filter(({ name, version }) => names.has(name) && VERSION.test(version))
        .map(({ created, ...tag }) => ({ ...tag, time: Date.parse(created), date: new Date(created).toISOString().slice(0, 10) }));
}

// Each file a commit touched, a moved one under both of its folders and a name in any script as it is.
function readLog(git, range) {
    return git('-c', 'core.quotePath=false', 'log', '--no-renames', '--format=%x1e%H%x09%s', '--name-only', range)
        .split('\x1e')
        .filter((entry) => entry.trim())
        .map((entry) => {
            const [head, ...files] = entry.split('\n').filter(Boolean);
            return { commit: head.slice(0, head.indexOf('\t')), subject: head.slice(head.indexOf('\t') + 1), files };
        });
}

// The commits where a shallow clone's history stops, which a range between two releases must not reach.
function shallowBoundaryOf(root, git) {
    const file = path.resolve(root, git('rev-parse', '--git-path', 'shallow').trim());
    return new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
}

// One folder's releases, newest first, in the order they were tagged; the oldest has no release before it to compare with.
function releasesOf(folder, tags, changesBetween) {
    const versions = [...new Set(tags.toSorted((left, right) => left.time - right.time).map(({ version }) => version))];
    return versions
        .map((version, index) => {
            const tagged = tags.filter((tag) => tag.version === version);
            const before = index ? tags.find((tag) => tag.version === versions[index - 1]) : null;
            return {
                version,
                date: tagged[0].date,
                packages: tagged.map(({ name }) => name).sort((left, right) => left.localeCompare(right, 'en')),
                changes: before ? changesBetween(before.commit, tagged[0].commit, folder) : null,
            };
        })
        .reverse();
}

function readHistories(root, git, candidates, tags) {
    const boundary = shallowBoundaryOf(root, git);
    const logs = new Map();
    const changesBetween = (from, to, folder) => {
        const range = `${from}..${to}`;
        if (!logs.has(range)) {
            const entries = readLog(git, range);
            if (entries.some(({ commit }) => boundary.has(commit))) {
                throw new Error(`${root} is a shallow clone whose history stops inside ${range}, which /packages/ needs whole: ${FETCH_HINT}.`);
            }
            logs.set(range, entries);
        }
        return logs
            .get(range)
            .filter(({ subject, files }) => !TRAIN_COMMIT.test(subject) && files.some((file) => file.startsWith(`${folder}/`)))
            .map(({ commit, subject }) => ({ commit: commit.slice(0, COMMIT_LENGTH), subject }));
    };
    const folders = Map.groupBy(candidates, ({ path: folder }) => historyFolderOf(folder));
    return Object.fromEntries(
        [...folders].map(([folder, members]) => {
            const names = new Set(members.map(({ name }) => name));
            return [
                folder,
                releasesOf(
                    folder,
                    tags.filter(({ name }) => names.has(name)),
                    changesBetween,
                ),
            ];
        }),
    );
}

// A train tags what it publishes once it is done, so a version npm serves without its tag means a clone without the
// tags, or a build while a train is still publishing.
function assertTagged(packages, tags, distTag) {
    const tagged = new Set(tags.map(({ name, version }) => `${name}@${version}`));
    const untagged = packages
        .filter(({ name, version }) => version && !tagged.has(`${name}@${version}`))
        .map(({ name, version }) => `${name}@${version}`);
    if (!untagged.length) return;
    const named = untagged.length > 3 ? `${untagged.slice(0, 3).join(', ')} and ${untagged.length - 3} more` : untagged.join(', ');
    throw new Error(
        `npm ${distTag} serves ${named}, which no tag of this clone names: ${FETCH_HINT}, or let a running release train tag what it published.`,
    );
}

export async function buildPackagesCatalog({ root = REPOSITORY_ROOT, distTag, fixture, registry, log = () => {} } = {}) {
    if (!distTag) throw new Error('A dist-tag is required to read publication state.');
    const client = registry ?? (fixture ? createFixtureRegistryClient(fixture) : createRegistryClient());
    const candidates = discoverPublishablePackages(root);
    const git = gitIn(root);
    const tags = releaseTags(git, new Set(candidates.map(({ name }) => name)));
    const histories = readHistories(root, git, candidates, tags);
    const packages = await mapWithConcurrency(candidates, REGISTRY_CONCURRENCY, async (candidate) => ({
        name: candidate.name,
        path: candidate.path,
        version: (await client.distTags(candidate.name))?.[distTag] ?? null,
        history: historyFolderOf(candidate.path),
    }));
    assertTagged(packages, tags, distTag);
    const unpublished = packages.filter(({ version }) => !version).map(({ name }) => name);
    if (unpublished.length) log(`Not on npm ${distTag}: ${unpublished.join(', ')}`);
    return { schemaVersion: 2, source: fixture ? 'fixture' : 'live', distTag, packages, histories };
}

export function renderPackagesModule(catalog) {
    return `// Generated by scripts/site/build-packages-catalog.mjs before every site build. Do not edit.\nexport default ${JSON.stringify(catalog, null, 4)};\n`;
}
