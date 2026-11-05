import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: {}, targets: [] };
vi.mock('../src/state/index.js', () => ({ default: state }));
// GitHub as the publisher sees it: the repository and token it finds, the release of the tag at each look, and what it
// is given.
const github = {};
const page = (id) => `https://github.com/demo/app/releases/${id}`;
vi.mock('../src/publishers/github/githubReleases.js', () => ({
    githubRepository: (packageJson, env) => (env ? 'demo/app' : github.repository),
    githubToken: () => github.token,
    githubCaller: () => async (method, route) => {
        github.asked.push(`${method} ${route}`);
        return { private: github.isPrivate };
    },
    releaseOf: async (call, tag) => {
        github.looked.push(tag);
        return github.releases.length > 1 ? github.releases.shift() : github.releases[0];
    },
    newRelease: async (call, options) => {
        github.made.push(options);
        return { id: 7, draft: true, assets: [], html_url: page('untagged-7') };
    },
    uploadAsset: async (call, release, file, name) => {
        github.uploads.push({ release: release.id, file: path.basename(file), name });
        return { name, browser_download_url: `https://github.com/demo/app/releases/download/v${state.config.package.version}/${name}` };
    },
    publishRelease: async (call, release) => {
        github.published.push(release.id);
        return { ...release, draft: false, html_url: page(`tag/v${state.config.package.version}`) };
    },
}));
vi.mock('../src/utils/ask.js', () => ({ hasTerminal: () => false }));

const { default: publish } = await import('../src/actions/publish.js');
const { newUpdaterKey } = await import('../src/actions/appUpdate.js');

const keys = newUpdaterKey();
const LATEST = 'https://github.com/demo/app/releases/latest/download/demo-{platform}-{arch}.update.json';
let base;
let printed;
let warned;
// Vite builds the desktop app as the plugin does: each arch's app, what installs it and, with a key, its update beside it.
const vite = {};
const UPDATE_PLATFORMS = { macos: 'darwin', linux: 'linux', windows: 'win32' };
async function runVite(args, env) {
    Object.assign(vite, { env, runs: vite.runs + 1 });
    const dist = path.join(base, 'dist');
    const platform = env.CROSSBIND_APP_PLATFORM;
    const apps = (platform === 'macos' ? ['arm64'] : ['x64', 'arm64']).map((arch) => {
        const app = path.join(dist, platform === 'macos' ? 'demo.app' : `demo-${UPDATE_PLATFORMS[platform]}-${arch}`);
        fs.mkdirSync(app, { recursive: true });
        const installer = { macos: path.join(dist, 'demo.dmg'), linux: `${app}.deb`, windows: `${app}-setup.exe` }[platform];
        const kind = { macos: 'dmg', linux: 'deb', windows: 'nsis' }[platform];
        if (!vite.lacksInstaller) fs.writeFileSync(installer, 'installer');
        let update = null;
        if (env.CROSSBIND_UPDATER_PRIVATE_KEY && !vite.lacksUpdate) {
            const file = { macos: 'demo-darwin-arm64.app.zip', linux: `${path.basename(app)}.tar.gz`, windows: `${path.basename(app)}-setup.exe` }[platform];
            const manifest = path.join(dist, `demo-${UPDATE_PLATFORMS[platform]}-${arch}.update.json`);
            fs.writeFileSync(path.join(dist, file), 'update');
            fs.writeFileSync(manifest, JSON.stringify({ version: '1.2.3', file, signature: 's' }));
            update = { manifest, file: path.join(dist, file) };
        }
        return {
            app, arch, installers: vite.lacksInstaller ? [] : [{ name: kind, files: [installer] }, ...(vite.more?.(app, dist) ?? [])], update,
        };
    });
    fs.mkdirSync(state.config.paths.build, { recursive: true });
    fs.writeFileSync(path.join(state.config.paths.build, 'app-outputs.json'), JSON.stringify({ [platform]: apps }));
    return 0;
}
const withUpdater = (url = LATEST) => {
    state.config.app.updater = { url, publicKey: keys.publicKey };
    vi.stubEnv('CROSSBIND_UPDATER_PRIVATE_KEY', keys.privateKey);
};

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-publish-github-'));
    state.config = {
        general: { name: 'demo' }, app: {}, extensions: [], package: { version: '1.2.3' }, paths: { project: base, build: path.join(base, '.crossbind', 'build') }, system: {},
    };
    Object.assign(github, {
        repository: 'demo/app', token: 'secret', isPrivate: false, releases: [null], asked: [], looked: [], made: [], uploads: [], published: [],
    });
    Object.assign(vite, {
        env: null, runs: 0, lacksInstaller: false, lacksUpdate: false, more: null,
    });
    printed = [];
    warned = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(line));
    vi.spyOn(console, 'warn').mockImplementation((line) => warned.push(line));
    vi.stubEnv('CROSSBIND_UPDATER_PRIVATE_KEY', '');
    vi.stubEnv('GITHUB_SHA', 'abc123');
    vi.stubEnv('GITHUB_REPOSITORY', 'Demo/App');
    vi.stubEnv('GITHUB_TOKEN', 'secret');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(base, { recursive: true, force: true });
});

describe('publishing a desktop app to a GitHub release', () => {
    test("puts a macOS app's disk image under its platform and arch, its update and manifest, into a new draft it then puts out", async () => {
        withUpdater();

        await publish(['github'], { platform: 'macos', runVite });

        expect(vite.env.CROSSBIND_APP_PLATFORM).toBe('macos');
        expect(vite.env.GITHUB_TOKEN).toBeUndefined();
        expect(github.looked).toEqual(['v1.2.3', 'v1.2.3']);
        expect(github.made).toEqual([{ tag: 'v1.2.3', commit: 'abc123', isPrerelease: false }]);
        expect(github.uploads).toEqual([
            { release: 7, file: 'demo.dmg', name: 'demo-darwin-arm64.dmg' },
            { release: 7, file: 'demo-darwin-arm64.app.zip', name: 'demo-darwin-arm64.app.zip' },
            { release: 7, file: 'demo-darwin-arm64.update.json', name: 'demo-darwin-arm64.update.json' },
        ]);
        expect(github.published).toEqual([7]);
        const said = printed.join('\n');
        expect(said).toContain("crossbind: publishing the macos app of 1.2.3 to demo/app's new release v1.2.3; building the app first.");
        expect(said).toContain("crossbind: the macos app of 1.2.3 is out on GitHub's release v1.2.3: https://github.com/demo/app/releases/tag/v1.2.3");
        expect(warned).toEqual([]);
    });

    test("names each file of a macOS app's installers after the app, with its platform and arch, whatever the installer makes", async () => {
        vite.more = (app, dist) => [['pkg', 'demo.pkg'], ['archive', 'demo.app.tar.gz'], ['notes', 'notes.txt']].map(([name, file]) => {
            fs.writeFileSync(path.join(dist, file), name);
            return { name, files: [path.join(dist, file)] };
        });

        await publish(['github'], { platform: 'macos', runVite });

        expect(github.uploads.map(({ name }) => name))
            .toEqual(['demo-darwin-arm64.dmg', 'demo-darwin-arm64.pkg', 'demo-darwin-arm64.app.tar.gz', 'demo-darwin-arm64-notes.txt']);
    });

    test("refuses an installer's file under the name of a macOS app's update, whose signature covers the update's own", async () => {
        withUpdater();
        const dist = path.join(base, 'dist');
        vite.more = () => {
            fs.writeFileSync(path.join(dist, 'demo.app.zip'), 'zip');
            return [{ name: 'zip', files: [path.join(dist, 'demo.app.zip')] }];
        };

        await expect(publish(['github'], { platform: 'macos', runVite })).rejects.toThrow(`crossbind: ${path.join(dist, 'demo.app.zip')} and ${path.join(dist, 'demo-darwin-arm64.app.zip')} would both be demo-darwin-arm64.app.zip, of which a GitHub release holds one, so nothing went to GitHub Releases.`);
        expect(github.uploads).toEqual([]);
    });

    test('refuses two files a release would hold under one name, before any goes up', async () => {
        const dist = path.join(base, 'dist');
        vite.more = (app) => {
            const other = path.join(dist, 'other', `${path.basename(app)}.deb`);
            fs.mkdirSync(path.dirname(other), { recursive: true });
            fs.writeFileSync(other, 'deb');
            return [{ name: 'other-deb', files: [other] }];
        };

        await expect(publish(['github'], { platform: 'linux', runVite })).rejects.toThrow(`crossbind: ${path.join(dist, 'demo-linux-x64.deb')} and ${path.join(dist, 'other', 'demo-linux-x64.deb')} would both be demo-linux-x64.deb, of which a GitHub release holds one, so nothing went to GitHub Releases.`);
        expect([github.made, github.uploads]).toEqual([[], []]);
    });

    test("takes the release another publish made during the build, leaves it a draft with --draft, and each arch's files go up", async () => {
        github.releases = [null, { id: 3, draft: true, assets: [], html_url: page('untagged-3') }];
        await publish(['github', '--draft'], { platform: 'linux', runVite });
        expect(github.made).toEqual([]);
        expect(github.uploads).toEqual([
            { release: 3, file: 'demo-linux-x64.deb', name: 'demo-linux-x64.deb' },
            { release: 3, file: 'demo-linux-arm64.deb', name: 'demo-linux-arm64.deb' },
        ]);
        expect(github.published).toEqual([]);
        expect(printed.join('\n')).toContain(`crossbind: the linux app of 1.2.3 is on the draft release v1.2.3, which a publish without --draft, or GitHub's page, puts out: ${page('untagged-3')}`);
    });

    test("puts a Windows app's setup up once, as what installs it and as its update, into a release out already", async () => {
        withUpdater();
        github.releases = [{ id: 4, draft: false, assets: [], html_url: page('tag/v1.2.3') }];
        await publish(['github', '--draft'], { platform: 'windows', runVite });
        expect(github.uploads.map(({ name }) => name)).toEqual(['demo-win32-x64-setup.exe', 'demo-win32-x64.update.json', 'demo-win32-arm64-setup.exe', 'demo-win32-arm64.update.json']);
        expect(github.published).toEqual([]);
        expect(printed.join('\n')).toContain("crossbind: publishing the windows app of 1.2.3 to demo/app's release v1.2.3");
        expect(printed.join('\n')).toContain("is out on GitHub's release v1.2.3, which was out already");
    });

    test("tags a new release at the workflow's commit where it is the repository's alone, and a prerelease of a prerelease's version", async () => {
        vi.stubEnv('GITHUB_REPOSITORY', 'demo/source');
        state.config.package.version = '1.2.3+build-5';
        await publish(['github'], { platform: 'linux', runVite });
        expect(github.made).toEqual([{ tag: 'v1.2.3+build-5', commit: null, isPrerelease: false }]);
        expect(printed.join('\n')).toContain('crossbind: demo/app gets the tag v1.2.3+build-5 where it has none at its default branch, as it has no commit of this build\'s.');

        github.made = [];
        vi.stubEnv('GITHUB_REPOSITORY', 'demo/app');
        state.config.package.version = '1.2.3-beta.1';
        await publish(['github'], { platform: 'linux', runVite });
        expect(github.made).toEqual([{ tag: 'v1.2.3-beta.1', commit: 'abc123', isPrerelease: true }]);
    });

    test('names every missing piece at once before the build: the repository, the token and the key app.updater takes', async () => {
        state.config.app.updater = { url: LATEST, publicKey: keys.publicKey };
        github.repository = null;
        github.token = null;
        const failure = await publish(['github'], { platform: 'macos', runVite }).catch((error) => error);
        expect(failure.message.split('\n').map((line) => line.slice(0, 50))).toEqual([
            'crossbind: GitHub Releases takes the app to a repo',
            'crossbind: GitHub takes a release from a token wit',
            'crossbind: app.updater has the app update from whe',
        ]);
        expect(vite.runs).toBe(0);
    });

    test('stops where the build made no installer, or no update app.updater takes', async () => {
        withUpdater();
        vite.lacksInstaller = true;
        await expect(publish(['github'], { platform: 'macos', runVite })).rejects
            .toThrow(`crossbind: the build made no installer of ${path.join(base, 'dist', 'demo.app')}, so nothing went to GitHub Releases.`);
        fs.rmSync(path.join(base, 'dist'), { recursive: true });
        Object.assign(vite, { lacksInstaller: false, lacksUpdate: true });
        await expect(publish(['github'], { platform: 'macos', runVite })).rejects
            .toThrow(`crossbind: the build made no update of ${path.join(base, 'dist', 'demo.app')}, which app.updater takes, so nothing went to GitHub Releases.`);
        expect(github.uploads).toEqual([]);
    });

    test('warns where an app would not update from the release: an updater elsewhere, a prerelease, or a private repository', async () => {
        withUpdater('https://github.com/demo/app/releases/download/v1.0.0/demo-{platform}-{arch}.update.json');
        await publish(['github'], { platform: 'linux', runVite });
        expect(warned).toEqual([`crossbind: app.updater.url is https://github.com/demo/app/releases/download/v1.0.0/demo-{platform}-{arch}.update.json, not ${LATEST}, so the app does not update from the newest of demo/app's releases.`]);

        warned = [];
        withUpdater(LATEST.replace('demo/app', 'Demo/App'));
        state.config.package.version = '1.2.3-beta.1';
        github.isPrivate = true;
        await publish(['github'], { platform: 'linux', runVite });
        expect(warned).toEqual([
            'crossbind: 1.2.3-beta.1 is a prerelease, which GitHub never makes the latest release, so no app updates to it.',
            "crossbind: demo/app is private, whose releases GitHub gives no app without a token, so none updates from them.",
        ]);
        expect(github.asked).toEqual(['GET ']);
    });
});
