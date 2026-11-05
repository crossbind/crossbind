import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    githubCaller, githubRepository, githubToken, newRelease, publishRelease, releaseOf, uploadAsset,
} from './githubReleases.js';

// The private key a build signs a desktop app's updates with, which it reads from the environment.
const UPDATER_KEY = 'CROSSBIND_UPDATER_PRIVATE_KEY';
const NO_REPOSITORY = 'crossbind: GitHub Releases takes the app to a repository of GitHub\'s, which neither CROSSBIND_GITHUB_REPOSITORY, GITHUB_REPOSITORY nor package.json\'s repository names: set repository to owner/name.';
const NO_TOKEN = 'crossbind: GitHub takes a release from a token with write access to the repository\'s contents: set GH_TOKEN or GITHUB_TOKEN, as a workflow does with its own, or sign in with `gh auth login`.';
const NO_UPDATE_KEY = `crossbind: app.updater has the app update from where it says, so its release takes the update ${UPDATER_KEY} signs: set it, as app.md's Updates says.`;

const isSame = (one, other) => typeof one === 'string' && one.toLowerCase() === other.toLowerCase();
const git = (api, args) => {
    const result = spawnSync('git', args, { cwd: api.project.root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
};
const isPrerelease = (version) => version.split('+')[0].includes('-');

// The commit a new release's tag is made at where the repository has no such tag yet: the one a workflow of that
// repository runs for, else the project's own where its origin is that repository; else none, and GitHub makes it at its
// default branch.
function releaseCommit(api, repository) {
    if (process.env.GITHUB_SHA) return isSame(process.env.GITHUB_REPOSITORY, repository) ? process.env.GITHUB_SHA : null;
    const origin = git(api, ['remote', 'get-url', 'origin']);
    return origin && isSame(githubRepository({ repository: origin }, {}), repository) ? git(api, ['rev-parse', 'HEAD']) : null;
}

// A macOS app's file takes the platform and arch into its name after the app's, as one release holds both arches'.
function macosName(api, app, arch, file) {
    const stem = path.basename(app, '.app');
    const name = path.basename(file);
    const rest = name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`) ? name.slice(stem.length) : `-${name}`;
    return `${api.project.name}-darwin-${arch}${rest}`;
}

// The files of an app's release, under the names the release gives them: what each of its installers made and, with
// app.updater, the update's file and its manifest.
function releaseFiles(api, { app, arch, installers, update }, hasUpdate) {
    const files = installers.flatMap(({ files: made }) => made).map((file) => ({
        file, name: api.platform === 'macos' ? macosName(api, app, arch, file) : path.basename(file),
    }));
    if (files.length === 0) throw new Error(`crossbind: the build made no installer of ${app}, so nothing went to GitHub Releases.`);
    if (!hasUpdate) return files;
    if (!update) throw new Error(`crossbind: the build made no update of ${app}, which app.updater takes, so nothing went to GitHub Releases.`);
    // A Linux or Windows app's update is one of its installers' files, which goes up once.
    const updates = [update.file, update.manifest].map((file) => ({ file, name: path.basename(file) }));
    return [...files, ...updates.filter((one) => !files.some(({ file }) => path.resolve(file) === path.resolve(one.file)))];
}

// What an app updates from the release misses: its manifest at the address of the newest release's, a version that
// release can be, and an address it can fetch with no token.
async function warnUpdates(api, call, repository, updater) {
    const latest = `https://github.com/${repository}/releases/latest/download/${api.project.name}-{platform}-{arch}.update.json`;
    if (!isSame(updater.url, latest)) {
        api.warn(`crossbind: app.updater.url is ${updater.url}, not ${latest}, so the app does not update from the newest of ${repository}'s releases.`);
        return;
    }
    if (isPrerelease(api.app.version)) api.warn(`crossbind: ${api.app.version} is a prerelease, which GitHub never makes the latest release, so no app updates to it.`);
    if ((await call('GET', '')).private) api.warn(`crossbind: ${repository} is private, whose releases GitHub gives no app without a token, so none updates from them.`);
}

// The publisher of a desktop app's installers, and its update with app.updater, to a GitHub release of its version, as
// its tag v<version> names it: a release made or taken as it is, where an asset of the same name gives way. It puts out
// the release's page and each file's address, for a publisher after it.
export default function github() {
    return {
        name: 'github',
        root: import.meta.dirname,
        publisher: {
            platform: 'desktop',
            store: 'GitHub Releases',
            options: {
                draft: { help: "leave the release a draft, which a publish without --draft, or GitHub's page, puts out" },
            },

            async check(api) {
                const missing = [];
                const repository = githubRepository(api.project.package);
                if (!repository) missing.push(NO_REPOSITORY);
                const token = githubToken();
                if (!token) missing.push(NO_TOKEN);
                const { updater } = api.app;
                if (updater && !process.env[UPDATER_KEY]) missing.push(NO_UPDATE_KEY);
                if (missing.length > 0) return { missing };
                const { version } = api.app;
                const call = githubCaller(repository, token);
                if (updater) await warnUpdates(api, call, repository, updater);
                const release = await releaseOf(call, `v${version}`);
                const kind = release ? `${release.draft ? 'draft ' : ''}release` : 'new release';
                api.log(`crossbind: publishing the ${api.platform} app of ${version} to ${repository}'s ${kind} v${version}; building the app first.`);
                return { session: { call, repository, hasUpdate: Boolean(updater) } };
            },

            // The token writes to the repository, which the build has no need of.
            buildEnv: () => ({ GH_TOKEN: undefined, GITHUB_TOKEN: undefined }),

            async upload(api, { call, repository, hasUpdate }, { apps }) {
                const { platform, app: { version }, options: { draft: isDraft } } = api;
                const files = apps.flatMap((app) => releaseFiles(api, app, hasUpdate));
                const twice = files.find(({ name }, index) => files.findIndex((other) => other.name === name) !== index);
                if (twice) {
                    const both = files.filter(({ name }) => name === twice.name).map(({ file }) => file);
                    throw new Error(`crossbind: ${both.join(' and ')} would both be ${twice.name}, of which a GitHub release holds one, so nothing went to GitHub Releases.`);
                }
                const tag = `v${version}`;
                // Another publish of the version may have made its release during this one's build.
                let release = await releaseOf(call, tag);
                if (!release) {
                    const commit = releaseCommit(api, repository);
                    if (!commit) api.log(`crossbind: ${repository} gets the tag ${tag} where it has none at its default branch, as it has no commit of this build's.`);
                    release = await newRelease(call, { tag, commit, isPrerelease: isPrerelease(version) });
                }
                const uploaded = [];
                for (const { file, name } of files) {
                    api.log(`crossbind: uploading ${name} to ${tag}.`);
                    uploaded.push(await uploadAsset(call, release, file, name));
                }
                const published = (out) => ({
                    published: { repository, tag, url: out.html_url, files: uploaded.map(({ name, browser_download_url: url }) => ({ name, url })) },
                });
                if (release.draft && isDraft) {
                    api.log(`crossbind: the ${platform} app of ${version} is on the draft release ${tag}, which a publish without --draft, or GitHub's page, puts out: ${release.html_url}`);
                    return published(release);
                }
                const out = release.draft ? await publishRelease(call, release) : release;
                api.log(`crossbind: the ${platform} app of ${version} is out on GitHub's release ${tag}${isDraft ? ', which was out already' : ''}: ${out.html_url}`);
                return published(out);
            },
        },
    };
}
