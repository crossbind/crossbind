import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverPublishablePackages, WORKSPACE_REPOSITORY } from '../../release/workspace-release.mjs';
import { buildPackagesCatalog, renderPackagesModule } from '../build-packages-catalog.mjs';

// The machine's git settings play no part: commits take this identity, no hook and no signature.
const GIT = [
    '-c',
    'user.name=crossbind',
    '-c',
    'user.email=site@crossbind.dev',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'tag.gpgsign=false',
];
const DAY = 24 * 60 * 60;

const manifestOf = (name, version) => JSON.stringify({ name, version, repository: WORKSPACE_REPOSITORY });
const registryOf = (tags) => ({ distTags: async (name) => tags[name] ?? null });

// A repository whose first commit holds the packages given, each at its folder; every later commit is a day after the one
// before, and a file given null is removed.
function repositoryOf(t, packages) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-packages-catalog-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const git = (args, env) => execFileSync('git', [...GIT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
    let clock = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const commit = (subject, files) => {
        for (const [file, text] of Object.entries(files)) {
            if (text === null) {
                fs.rmSync(path.join(root, file));
                continue;
            }
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), text);
        }
        clock += DAY;
        git(['add', '--all']);
        git(['commit', '--quiet', '-m', subject], { GIT_AUTHOR_DATE: `@${clock} +0000`, GIT_COMMITTER_DATE: `@${clock} +0000` });
        return git(['rev-parse', 'HEAD']).slice(0, 10);
    };
    const tag = (version, ...names) => names.forEach((name) => git(['tag', `${name}@${version}`]));
    git(['init', '--quiet']);
    commit(
        'chore: start',
        Object.fromEntries(
            Object.entries(packages).map(([folder, { name, ...rest }]) => [
                `${folder}/package.json`,
                JSON.stringify({ name, version: '2.0.0-beta.1', repository: WORKSPACE_REPOSITORY, ...rest }),
            ]),
        ),
    );
    return { root, commit, tag };
}

test('every package the release train publishes takes the version npm serves on the dist-tag, or null where it serves none', async (t) => {
    const { root, tag } = repositoryOf(t, {
        'core/crossbind': { name: 'crossbind' },
        'plugins/vite': { name: '@crossbind/plugin-vite' },
        'ports/demo/base': { name: '@crossbind/port-demo' },
        'ports/demo/wasm': { name: '@crossbind/port-demo-wasm' },
        'extensions/dialog': { name: '@crossbind/extension-dialog' },
        'examples/sample': { name: '@crossbind/example-sample', private: true },
    });
    tag('2.0.0-beta.68', 'crossbind', '@crossbind/plugin-vite', '@crossbind/port-demo');
    tag('2.0.0-beta.67', '@crossbind/port-demo-wasm');
    const log = [];

    const catalog = await buildPackagesCatalog({
        root,
        distTag: 'beta',
        registry: registryOf({
            crossbind: { beta: '2.0.0-beta.68', latest: '0.0.1' },
            '@crossbind/plugin-vite': { beta: '2.0.0-beta.68' },
            '@crossbind/port-demo': { beta: '2.0.0-beta.68' },
            '@crossbind/port-demo-wasm': { beta: '2.0.0-beta.67' },
            '@crossbind/extension-dialog': { latest: '0.0.0-bootstrap.0' },
        }),
        log: (line) => log.push(line),
    });

    assert.deepEqual([catalog.schemaVersion, catalog.source, catalog.distTag], [2, 'live', 'beta']);
    assert.deepEqual(catalog.packages, [
        { name: '@crossbind/extension-dialog', path: 'extensions/dialog', version: null, history: 'extensions/dialog' },
        { name: '@crossbind/plugin-vite', path: 'plugins/vite', version: '2.0.0-beta.68', history: 'plugins/vite' },
        { name: '@crossbind/port-demo', path: 'ports/demo/base', version: '2.0.0-beta.68', history: 'ports/demo' },
        { name: '@crossbind/port-demo-wasm', path: 'ports/demo/wasm', version: '2.0.0-beta.67', history: 'ports/demo' },
        { name: 'crossbind', path: 'core/crossbind', version: '2.0.0-beta.68', history: 'core/crossbind' },
    ]);
    assert.deepEqual(catalog.histories['extensions/dialog'], []);
    assert.deepEqual(log, ['Not on npm beta: @crossbind/extension-dialog']);
});

test('a version npm serves that no tag of the clone names stops the build, naming the fix', async (t) => {
    const { root, tag } = repositoryOf(t, { 'core/crossbind': { name: 'crossbind' } });
    tag('2.0.0-beta.1', 'crossbind');

    await assert.rejects(
        () => buildPackagesCatalog({ root, distTag: 'beta', registry: registryOf({ crossbind: { beta: '2.0.0-beta.2' } }) }),
        /crossbind@2\.0\.0-beta\.2.*git fetch --unshallow --tags/,
    );
});

test('a commit that moves a file out of a folder, or names one in any script, counts for that folder', async (t) => {
    const { root, commit, tag } = repositoryOf(t, { 'core/crossbind': { name: 'crossbind' }, 'plugins/vite': { name: '@crossbind/plugin-vite' } });
    commit('feat(crossbind): a helper', { 'plugins/vite/helper.js': 'helper' });
    tag('2.0.0-beta.1', 'crossbind', '@crossbind/plugin-vite');
    const moved = commit('refactor(crossbind): keep the helper in the core', {
        'plugins/vite/helper.js': null,
        'core/crossbind/helper.js': 'helper',
    });
    const named = commit('docs(crossbind): the template', { 'plugins/vite/şablon.md': 'şablon' });
    commit('chore(release): prepare the beta 2 train', {
        'core/crossbind/package.json': manifestOf('crossbind', '2.0.0-beta.2'),
        'plugins/vite/package.json': manifestOf('@crossbind/plugin-vite', '2.0.0-beta.2'),
    });
    tag('2.0.0-beta.2', 'crossbind', '@crossbind/plugin-vite');

    const { histories } = await buildPackagesCatalog({ root, distTag: 'beta', registry: registryOf({}) });

    assert.deepEqual(
        histories['plugins/vite'][0].changes.map(({ commit: hash }) => hash),
        [named, moved],
    );
    assert.deepEqual(
        histories['core/crossbind'][0].changes.map(({ commit: hash }) => hash),
        [moved],
    );
});

test("a package's releases are its tags, newest first, each with the commits that changed its folder since the one before", async (t) => {
    const { root, commit, tag } = repositoryOf(t, {
        'core/crossbind': { name: 'crossbind' },
        'plugins/vite': { name: '@crossbind/plugin-vite' },
        'ports/demo/base': { name: '@crossbind/port-demo' },
        'ports/demo/wasm': { name: '@crossbind/port-demo-wasm' },
    });
    tag('2.0.0-beta.1', 'crossbind', '@crossbind/plugin-vite', '@crossbind/port-demo', '@crossbind/port-demo-wasm');
    const served = commit("feat(crossbind): serve the plugin's pages", { 'plugins/vite/index.js': 'serve' });
    commit('chore(release): prepare the beta 2 train', {
        'core/crossbind/package.json': manifestOf('crossbind', '2.0.0-beta.2'),
        'plugins/vite/package.json': manifestOf('@crossbind/plugin-vite', '2.0.0-beta.2'),
    });
    tag('2.0.0-beta.2', 'crossbind', '@crossbind/plugin-vite');
    const linked = commit('fix(port-demo): link it on windows', { 'ports/demo/base/build.mjs': 'link' });
    commit('chore(release): prepare the beta 3 train', { 'ports/demo/base/package.json': manifestOf('@crossbind/port-demo', '2.0.0-beta.3') });
    tag('2.0.0-beta.3', '@crossbind/port-demo');

    const { histories } = await buildPackagesCatalog({ root, distTag: 'beta', registry: registryOf({}) });

    assert.deepEqual(histories['plugins/vite'], [
        {
            version: '2.0.0-beta.2',
            date: '2026-10-04',
            packages: ['@crossbind/plugin-vite'],
            changes: [{ commit: served, subject: "feat(crossbind): serve the plugin's pages" }],
        },
        { version: '2.0.0-beta.1', date: '2026-10-02', packages: ['@crossbind/plugin-vite'], changes: null },
    ]);
    assert.deepEqual(histories['core/crossbind'][0].changes, []);
    assert.deepEqual(histories['ports/demo'], [
        {
            version: '2.0.0-beta.3',
            date: '2026-10-06',
            packages: ['@crossbind/port-demo'],
            changes: [{ commit: linked, subject: 'fix(port-demo): link it on windows' }],
        },
        { version: '2.0.0-beta.1', date: '2026-10-02', packages: ['@crossbind/port-demo', '@crossbind/port-demo-wasm'], changes: null },
    ]);
});

function shallowCloneOf(t, root, depth) {
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-packages-shallow-'));
    t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
    execFileSync('git', ['clone', '--quiet', '--depth', String(depth), `file://${root}`, clone]);
    return clone;
}

test('a shallow clone without the tags of what npm serves stops the build, naming the fix', async (t) => {
    const { root, commit, tag } = repositoryOf(t, { 'core/crossbind': { name: 'crossbind' } });
    tag('2.0.0-beta.1', 'crossbind');
    commit('feat(crossbind): more', { 'core/crossbind/index.js': 'more' });
    const shallow = shallowCloneOf(t, root, 1);

    await assert.rejects(
        () => buildPackagesCatalog({ root: shallow, distTag: 'beta', registry: registryOf({ crossbind: { beta: '2.0.0-beta.1' } }) }),
        /fetch-depth: 0/,
    );
});

test('a shallow clone whose history stops between two releases stops the build, naming the fix', async (t) => {
    const { root, commit, tag } = repositoryOf(t, { 'core/crossbind': { name: 'crossbind' } });
    tag('2.0.0-beta.1', 'crossbind');
    commit('feat(crossbind): more', { 'core/crossbind/index.js': 'more' });
    commit('chore(release): prepare the beta 2 train', { 'core/crossbind/package.json': manifestOf('crossbind', '2.0.0-beta.2') });
    tag('2.0.0-beta.2', 'crossbind');
    const shallow = shallowCloneOf(t, root, 2);
    execFileSync('git', ['fetch', '--quiet', '--depth', '1', 'origin', 'tag', 'crossbind@2.0.0-beta.1'], { cwd: shallow });

    await assert.rejects(() => buildPackagesCatalog({ root: shallow, distTag: 'beta', registry: registryOf({}) }), /stops inside .*fetch-depth: 0/);
});

test("the repository's catalog has every package the release train publishes, with the releases its tags record", async () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const catalog = await buildPackagesCatalog({ distTag: 'beta', registry: registryOf({}) });
    const tagged = execFileSync('git', ['tag', '-l', 'crossbind@*'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter((name) => /^crossbind@\d+\.\d+\.\d+/.test(name));

    assert.deepEqual(
        catalog.packages.map(({ name }) => name),
        discoverPublishablePackages(root).map(({ name }) => name),
    );
    assert.ok(catalog.packages.some(({ name, path: folder }) => name === 'crossbind' && folder === 'core/crossbind'));
    assert.equal(catalog.histories['core/crossbind'].length, tagged.length);
});

test('a fixture build is marked as such, and its module is the catalog', async (t) => {
    const { root, tag } = repositoryOf(t, { 'core/crossbind': { name: 'crossbind' } });
    tag('2.0.0-beta.68', 'crossbind');
    const fixture = { npm: { packages: { crossbind: { distTags: { beta: '2.0.0-beta.68' } } } } };

    const catalog = await buildPackagesCatalog({ root, distTag: 'beta', fixture });

    assert.equal(catalog.source, 'fixture');
    assert.equal(catalog.packages[0].version, '2.0.0-beta.68');
    assert.match(renderPackagesModule(catalog), /^\/\/ Generated by scripts\/site\/build-packages-catalog\.mjs[^\n]*\nexport default \{/);
});

test('the catalog needs the dist-tag it reads', async () => {
    await assert.rejects(() => buildPackagesCatalog({ registry: registryOf({}) }), /A dist-tag is required/);
});
