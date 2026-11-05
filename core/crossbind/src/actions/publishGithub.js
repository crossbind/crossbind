import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import state from '../state/index.js';
import { DESKTOP_PLATFORMS } from './buildApp.js';
import { UPDATER_KEY } from './appUpdate.js';
import {
    githubCaller, githubRepository, githubToken, newRelease, publishRelease, releaseOf, uploadAsset,
} from './githubReleases.js';
import publish from './publish.js';
import { appUpdater } from '../utils/appOptions.js';

const NO_REPOSITORY = 'crossbind: GitHub Releases takes the app to a repository of GitHub\'s, which neither CROSSBIND_GITHUB_REPOSITORY, GITHUB_REPOSITORY nor package.json\'s repository names: set repository to owner/name.';
const NO_TOKEN = 'crossbind: GitHub takes a release from a token with write access to the repository\'s contents: set GH_TOKEN or GITHUB_TOKEN, as a workflow does with its own, or sign in with `gh auth login`.';
const NO_UPDATE_KEY = `crossbind: app.updater has the app update from where it says, so its release takes the update ${UPDATER_KEY} signs: set it, as app.md's Updates says.`;
// A desktop platform's name in the files of its update, as the build writes them.
const UPDATE_PLATFORMS = Object.fromEntries(Object.entries(DESKTOP_PLATFORMS).map(([platform, name]) => [name, platform]));

const isSame = (one, other) => typeof one === 'string' && one.toLowerCase() === other.toLowerCase();
const git = (args) => {
    const result = spawnSync('git', args, { cwd: state.config.paths.project, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
};

// The commit a new release's tag is made at where the repository has no such tag yet: the one a workflow of that
// repository runs for, else the project's own where its origin is that repository; else none, and GitHub makes it at its
// default branch.
function releaseCommit(repository) {
    if (process.env.GITHUB_SHA) return isSame(process.env.GITHUB_REPOSITORY, repository) ? process.env.GITHUB_SHA : null;
    const origin = git(['remote', 'get-url', 'origin']);
    return origin && isSame(githubRepository({ repository: origin }, {}), repository) ? git(['rev-parse', 'HEAD']) : null;
}

// The files of an app's release, as `crossbind app build` writes them beside the app, under the names the release gives
// them: what installs it and, with app.updater, the update's manifest and the file it names. A macOS disk image takes
// its platform and arch into its name, as one release holds both arches'.
function releaseFiles(platform, { app, arch }, hasUpdate) {
    const { name } = state.config.general;
    const folder = path.dirname(app);
    const installer = {
        macos: { file: app.replace(/\.app$/, '.dmg'), name: `${name}-darwin-${arch}.dmg` },
        linux: { file: `${app}.deb`, name: `${path.basename(app)}.deb` },
        windows: { file: `${app}-setup.exe`, name: `${path.basename(app)}-setup.exe` },
    }[platform];
    if (!fs.existsSync(installer.file)) throw new Error(`crossbind: the build made no installer at ${installer.file}, so nothing went to GitHub Releases.`);
    if (!hasUpdate) return [installer];
    const manifest = path.join(folder, `${name}-${UPDATE_PLATFORMS[platform]}-${arch}.update.json`);
    if (!fs.existsSync(manifest)) throw new Error(`crossbind: the build made no update at ${manifest}, which app.updater takes, so nothing went to GitHub Releases.`);
    const { file } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (typeof file !== 'string' || path.basename(file) !== file) throw new Error(`crossbind: ${manifest} names no file beside it, which the update is.`);
    const update = [{ file: path.join(folder, file), name: file }, { file: manifest, name: path.basename(manifest) }];
    return [installer, ...update.filter((one) => one.name !== installer.name)];
}

// What an app updates from the release misses: its manifest at the address of the newest release's, a version that
// release can be, and an address it can fetch with no token.
async function warnUpdates(call, repository, updater, version) {
    const latest = `https://github.com/${repository}/releases/latest/download/${state.config.general.name}-{platform}-{arch}.update.json`;
    if (!isSame(updater.url, latest)) {
        console.warn(`crossbind: app.updater.url is ${updater.url}, not ${latest}, so the app does not update from the newest of ${repository}'s releases.`);
        return;
    }
    if (version.split('+')[0].includes('-')) console.warn(`crossbind: ${version} is a prerelease, which GitHub never makes the latest release, so no app updates to it.`);
    if ((await call('GET', '')).private) console.warn(`crossbind: ${repository} is private, whose releases GitHub gives no app without a token, so none updates from them.`);
}

// The publisher of a desktop app's installers, and its update with app.updater, to a GitHub release of its version, as
// its tag v<version> names it: a release made or taken as it is, where an asset of the same name gives way.
export const githubReleases = (platform) => ({
    name: 'github',
    platform,
    store: 'GitHub Releases',

    async check() {
        const missing = [];
        const repository = githubRepository(state.config.package);
        if (!repository) missing.push(NO_REPOSITORY);
        const token = githubToken();
        if (!token) missing.push(NO_TOKEN);
        const updater = appUpdater(state.config);
        if (updater && !process.env[UPDATER_KEY]) missing.push(NO_UPDATE_KEY);
        if (missing.length > 0) return { missing };
        const version = state.config.package?.version ?? '1.0.0';
        const call = githubCaller(repository, token);
        if (updater) await warnUpdates(call, repository, updater, version);
        const release = await releaseOf(call, `v${version}`);
        const kind = release ? `${release.draft ? 'draft ' : ''}release` : 'new release';
        console.log(`crossbind: publishing the ${platform} app of ${version} to ${repository}'s ${kind} v${version}; building the app first.`);
        return { session: { call, repository, version, hasUpdate: Boolean(updater) } };
    },

    buildNumber: () => null,

    // The token writes to the repository, which the build has no need of.
    buildEnv: () => ({ GH_TOKEN: undefined, GITHUB_TOKEN: undefined }),

    async upload({ options: { isDraft = false } }, {
        call, repository, version, hasUpdate,
    }, apps) {
        const files = apps.flatMap((app) => releaseFiles(platform, app, hasUpdate));
        const tag = `v${version}`;
        // Another publish of the version may have made its release during this one's build.
        let release = await releaseOf(call, tag);
        if (!release) {
            const commit = releaseCommit(repository);
            if (!commit) console.log(`crossbind: ${repository} gets the tag ${tag} where it has none at its default branch, as it has no commit of this build's.`);
            release = await newRelease(call, { tag, commit, isPrerelease: version.split('+')[0].includes('-') });
        }
        for (const { file, name } of files) {
            console.log(`crossbind: uploading ${name} to ${tag}.`);
            await uploadAsset(call, release, file, name);
        }
        if (release.draft && isDraft) {
            console.log(`crossbind: the ${platform} app of ${version} is on the draft release ${tag}, which a publish without --draft, or GitHub's page, puts out: ${release.html_url}`);
            return;
        }
        const out = release.draft ? await publishRelease(call, release) : release;
        console.log(`crossbind: the ${platform} app of ${version} is out on GitHub's release ${tag}${isDraft ? ', which was out already' : ''}: ${out.html_url}`);
    },
});

export const publishGithub = (platform, options, tools) => publish(githubReleases(platform), options, tools);
