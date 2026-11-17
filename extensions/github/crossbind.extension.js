import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    githubCaller, githubRepository, githubToken, newRelease, publishRelease, releaseOf, uploadAsset,
} from './src/githubReleases.js';

// The private key a build signs a desktop app's updates with, which it reads from the environment.
const UPDATER_KEY = 'CROSSBIND_UPDATER_PRIVATE_KEY';
// The installer whose files are an app's update.
const UPDATE_INSTALLER = 'updater';
const NO_REPOSITORY = 'crossbind: GitHub Releases takes the app to a repository of GitHub\'s, which neither CROSSBIND_GITHUB_REPOSITORY, GITHUB_REPOSITORY nor package.json\'s repository names: set repository to owner/name.';
const NO_TOKEN = 'crossbind: GitHub takes a release from a token with write access to the repository\'s contents: set GH_TOKEN or GITHUB_TOKEN, as a workflow does with its own, or sign in with `gh auth login`.';
const NO_UPDATE_KEY = `crossbind: app.updater has the app update from where it says, so its release takes the update ${UPDATER_KEY} signs: set it, as app.md's Updates says.`;

const isSame = (one, other) => typeof one === 'string' && one.toLowerCase() === other.toLowerCase();
const git = (api, args) => {
    const result = spawnSync('git', args, { cwd: api.project.root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
};
const isPrerelease = (version) => version.split('+')[0].includes('-');

// Stops an upload to a release that is out already, as an upload changes nothing public.
function assertDraft(release, repository, tag) {
    if (release && !release.draft) {
        throw new Error(`crossbind: ${repository}'s release ${tag} is out already, and an upload changes nothing public: raise the version in package.json for the next release.`);
    }
}

// The repository a release goes to and the token GitHub takes it from, or what is missing of them.
function accessOf(api) {
    const repository = githubRepository(api.project.package);
    const token = githubToken();
    const missing = [...(repository ? [] : [NO_REPOSITORY]), ...(token ? [] : [NO_TOKEN])];
    return missing.length > 0 ? { missing } : { repository, call: githubCaller(repository, token) };
}

// The commit a new release's tag is made at where the repository has no such tag yet: the one a workflow of that
// repository runs for, else the project's own where its origin is that repository; else none, and GitHub makes it at its
// default branch.
function releaseCommit(api, repository) {
    if (process.env.GITHUB_SHA) return isSame(process.env.GITHUB_REPOSITORY, repository) ? process.env.GITHUB_SHA : null;
    const origin = git(api, ['remote', 'get-url', 'origin']);
    return origin && isSame(githubRepository({ repository: origin }, {}), repository) ? git(api, ['rev-parse', 'HEAD']) : null;
}

// A macOS app's file takes the platform and arch into its name after the app's, as one release holds both arches', unless
// it has them already, as an update's, whose manifest names it.
function macosName(api, app, arch, file) {
    const stem = path.basename(app, '.app');
    const name = path.basename(file);
    const own = `${api.project.name}-darwin-${arch}`;
    if (name.startsWith(`${own}.`) || name.startsWith(`${own}-`)) return name;
    const rest = name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`) ? name.slice(stem.length) : `-${name}`;
    return `${api.project.name}-darwin-${arch}${rest}`;
}

// The files of an app's release, under the names the release gives them: what each of its installers made, among them
// with app.updater the update's. A Linux or Windows app's update is one of its installers' files, which goes up once.
function releaseFiles(api, { app, arch, installers }, hasUpdate) {
    if (!installers.some(({ name }) => name !== UPDATE_INSTALLER)) throw new Error(`crossbind: the build made no installer of ${app}, so nothing went to GitHub Releases.`);
    if (hasUpdate && !installers.some(({ name }) => name === UPDATE_INSTALLER)) {
        throw new Error(`crossbind: the build made no update of ${app}, which app.updater takes, so nothing went to GitHub Releases.`);
    }
    const files = [...new Set(installers.flatMap(({ files: made }) => made.map((file) => path.resolve(file))))];
    return files.map((file) => ({ file, name: api.platform === 'macos' ? macosName(api, app, arch, file) : path.basename(file) }));
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

// The publisher of a desktop app's installers, and its update with app.updater, to a draft GitHub release of its
// version, as its tag v<version> names it, made or taken as it is, where an asset of the same name gives way; the release
// puts the draft out. It puts out the release's page and each file's address, for a publisher after it.
export default function github() {
    return {
        name: 'github',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: 'desktop',
            store: 'GitHub Releases',

            async check(api) {
                const access = accessOf(api);
                const { updater } = api.config.app;
                const missing = [...(access.missing ?? []), ...(updater && !process.env[UPDATER_KEY] ? [NO_UPDATE_KEY] : [])];
                if (missing.length > 0) return { missing };
                const { call, repository } = access;
                const { version } = api.app;
                if (updater) await warnUpdates(api, call, repository, updater);
                const release = await releaseOf(call, `v${version}`);
                assertDraft(release, repository, `v${version}`);
                api.log(`crossbind: publishing the ${api.platform} app of ${version} to ${repository}'s ${release ? 'draft' : 'new draft'} release v${version}; building the app first.`);
                return { session: { call, repository, hasUpdate: Boolean(updater) } };
            },

            // The token writes to the repository, which the build has no need of.
            buildEnv: () => ({ GH_TOKEN: undefined, GITHUB_TOKEN: undefined }),

            async upload(api, { call, repository, hasUpdate }, { apps }) {
                const { platform, app: { version } } = api;
                const files = apps.flatMap((app) => releaseFiles(api, app, hasUpdate));
                const twice = files.find(({ name }, index) => files.findIndex((other) => other.name === name) !== index);
                if (twice) {
                    const both = files.filter(({ name }) => name === twice.name).map(({ file }) => file);
                    throw new Error(`crossbind: ${both.join(' and ')} would both be ${twice.name}, of which a GitHub release holds one, so nothing went to GitHub Releases.`);
                }
                const tag = `v${version}`;
                // Another publish of the version may have made its release during this one's build.
                let release = await releaseOf(call, tag);
                assertDraft(release, repository, tag);
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
                api.log(`crossbind: the ${platform} app of ${version} is on the draft release ${tag}, which crossbind app release github puts out: ${release.html_url}`);
                return {
                    published: { repository, tag, url: release.html_url, files: uploaded.map(({ name, browser_download_url: url }) => ({ name, url })) },
                };
            },

            // Puts out the draft release of the app's version, with no build, which GitHub makes the latest unless it
            // has a newer version out.
            async release(api) {
                const access = accessOf(api);
                if (access.missing) return access;
                const { call, repository } = access;
                const tag = `v${api.app.version}`;
                const release = await releaseOf(call, tag);
                if (!release) throw new Error(`crossbind: ${repository} has no release ${tag}: crossbind app upload github makes it a draft, with the app's installers.`);
                if (!release.draft) {
                    api.log(`crossbind: ${repository}'s release ${tag} is out already: ${release.html_url}`);
                    return {};
                }
                const out = await publishRelease(call, release);
                api.log(`crossbind: ${repository}'s release ${tag} is out: ${out.html_url}`);
                return {};
            },
        },
    };
}
