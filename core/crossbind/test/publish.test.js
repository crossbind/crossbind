import os from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: {} };
vi.mock('../src/state/index.js', () => ({ default: state }));
// The config read again with a publisher's changes, as the build reads it.
const reloads = [];
vi.mock('../src/state/loadConfig.js', () => ({
    default: async (configDir, configName, { changes }) => {
        reloads.push(changes);
        return { ...state.config, changed: changes };
    },
}));
const outputs = { cleared: 0 };
vi.mock('../src/actions/buildApp.js', () => ({
    DESKTOP_PLATFORMS: { darwin: 'macos', linux: 'linux', win32: 'windows' },
    appOutputOf: (platform) => ({ project: `/demo/dist/demo-${platform}` }),
    clearAppOutputs: () => {
        outputs.cleared += 1;
    },
}));
// Each publisher's api, as the run makes it: its name and what the run gives it.
vi.mock('../src/actions/extensionApi.js', () => ({
    default: (name, options) => ({ name, ...options }),
}));
const terminal = { isThere: false };
vi.mock('../src/utils/ask.js', () => ({ hasTerminal: () => terminal.isThere }));

const { checkedExtension } = await import('../src/utils/appExtensions.js');
const {
    PLATFORM_STORES, builtInPublishers, default: publish, publishChain, publishHelp, publishOptions, publishPlatform, publishersOf, storeOf,
} = await import('../src/actions/publish.js');

// An app's extension with a publisher, as crossbind takes it from crossbind.config.js.
const extension = (name, publisher) => checkedExtension({ name, publisher: { upload: async () => {}, ...publisher } }, os.tmpdir(), `extensions[${name}]`);
const names = (publishers) => publishers.map(({ name }) => name);

describe('the store crossbind app publish sends an app to', () => {
    test('is the one the command names first, before its options and the options Vite takes', () => {
        expect(storeOf(['google-play', '--track', 'beta', '--mode', 'staging'], undefined, undefined)).toEqual({ store: 'google-play', rest: ['--track', 'beta', '--mode', 'staging'] });
        expect(storeOf(['winget'], undefined, undefined)).toEqual({ store: 'winget', rest: [] });
    });

    test('is else the one of the platform -p or CROSSBIND_APP_PLATFORM names, and none without either', () => {
        expect(PLATFORM_STORES).toEqual({ android: 'google-play', ios: 'app-store' });
        expect(storeOf(['--mode', 'staging'], 'ios', 'android')).toEqual({ store: 'app-store', rest: ['--mode', 'staging'] });
        expect(storeOf([], undefined, 'android').store).toBe('google-play');
        expect(storeOf([], 'linux', undefined).store).toBeNull();
        expect(storeOf([], undefined, undefined).store).toBeNull();
    });

    test('is named before the options, as one named after them would go on to Vite', () => {
        expect(() => storeOf(['--track', 'beta', 'google-play'], 'android', undefined, ['google-play', 'app-store']))
            .toThrow('crossbind: crossbind app publish takes the store first, before the options: crossbind app publish google-play --track beta.');
        expect(storeOf(['--mode', 'staging'], 'android', undefined, ['google-play']).store).toBe('google-play');
    });

    test("is one of the app's publishers, which the command names when it names none of them", () => {
        const publishers = builtInPublishers();
        expect(() => publishChain(publishers, 'winget')).toThrow('crossbind: crossbind app publish takes the store it sends the app to first: google-play, app-store or github, not winget.');
        expect(() => publishChain(publishers, null)).toThrow('crossbind: crossbind app publish takes the store it sends the app to first: google-play, app-store or github.');
    });
});

describe('the publishers an app has', () => {
    test("are crossbind's own, each a publisher of its platforms with its options, from a folder of its own", () => {
        const publishers = builtInPublishers();
        expect(publishers.map(({ name, publisher }) => [name, publisher.platforms, Object.keys(publisher.options)])).toEqual([
            ['google-play', ['android'], ['track', 'draft', 'rollout']],
            ['app-store', ['ios'], ['submit', 'phased']],
            ['github', ['macos', 'linux', 'windows'], ['draft']],
        ]);
        expect(publishers.map(({ root }) => root.split(/[\\/]/).slice(-2).join('/'))).toEqual(['publishers/google-play', 'publishers/app-store', 'publishers/github']);
    });

    test("take an app's extension of one's name with a publisher in its place, and the app's others after them", () => {
        const github = extension('github', { platform: 'macos' });
        const appOnly = checkedExtension({ name: 'google-play', app: {} }, os.tmpdir(), 'extensions[0]');
        const publishers = publishersOf([appOnly, extension('homebrew', { platform: 'macos', after: 'github' }), github]);
        expect(names(publishers)).toEqual(['google-play', 'app-store', 'github', 'homebrew']);
        expect(publishers[2]).toBe(github);
        expect(publishers[0].publisher.store).toBe('Google Play');
    });

    test('run those a store comes after first, and refuse one that is missing or a circle', () => {
        const publishers = publishersOf([extension('homebrew', { platform: 'macos', after: 'github' }), extension('tap', { platform: 'macos', after: 'homebrew' })]);
        expect(names(publishChain(publishers, 'tap'))).toEqual(['github', 'homebrew', 'tap']);
        expect(() => publishChain(publishersOf([extension('homebrew', { platform: 'macos', after: 'nope' })]), 'homebrew'))
            .toThrow('crossbind: homebrew comes after nope, which no publisher is named.');
        expect(() => publishChain(publishersOf([extension('one', { platform: 'linux', after: 'two' }), extension('two', { platform: 'linux', after: 'one' })]), 'one'))
            .toThrow('crossbind: one, two and one come after one another in a circle.');
    });
});

describe('the platform a publish builds for', () => {
    const [googlePlay, , github] = builtInPublishers();

    test('is the one -p names, which every publisher of the publish takes', () => {
        expect(publishPlatform([github], 'windows', 'linux', 'darwin')).toBe('windows');
        expect(() => publishPlatform([googlePlay], 'ios', undefined)).toThrow("crossbind: google-play takes android apps, not ios', which -p names.");
        expect(() => publishPlatform([github], 'android', undefined)).toThrow("crossbind: github takes macos, linux or windows apps, not android's, which -p names.");
    });

    test("is else a store's only one, whatever CROSSBIND_APP_PLATFORM says", () => {
        expect(publishPlatform([googlePlay], undefined, 'ios')).toBe('android');
    });

    test("is else CROSSBIND_APP_PLATFORM's, else this machine's desktop one", () => {
        expect(publishPlatform([github], undefined, 'linux', 'darwin')).toBe('linux');
        expect(() => publishPlatform([github], undefined, 'android', 'darwin')).toThrow("crossbind: github takes macos, linux or windows apps, not android's, which CROSSBIND_APP_PLATFORM names.");
        expect(['darwin', 'linux', 'win32'].map((host) => publishPlatform([github], undefined, undefined, host))).toEqual(['macos', 'linux', 'windows']);
        const tap = extension('tap', { platform: ['linux', 'windows'] });
        expect(() => publishPlatform([tap], undefined, undefined, 'darwin')).toThrow('crossbind: tap takes linux or windows apps: name one with -p.');
    });

    test('is one every publisher of a chain takes', () => {
        const homebrew = extension('homebrew', { platform: 'macos', after: 'github' });
        expect(publishPlatform([github, homebrew], undefined, undefined, 'linux')).toBe('macos');
        const store = extension('store', { platform: 'android', after: 'github' });
        expect(() => publishPlatform([github, store], undefined, undefined)).toThrow('crossbind: store comes after github, which takes apps of none of its platforms.');
    });
});

describe('the options of a publish', () => {
    const publishers = builtInPublishers();
    const [googlePlay, appStore, github] = publishers;

    test("are its publishers' own, as values or flags, with their defaults, and the rest goes on to Vite", () => {
        expect(publishOptions([googlePlay], ['--track', 'beta', '--mode', 'staging', '--rollout=10'], publishers)).toEqual({
            options: { 'google-play': { track: 'beta', draft: false, rollout: '10' } },
            viteArgs: ['--mode', 'staging'],
        });
        expect(publishOptions([googlePlay], ['--draft'], publishers).options['google-play']).toEqual({ track: 'internal', draft: true, rollout: null });
    });

    test("are refused where they are another store's, naming whose they are", () => {
        expect(() => publishOptions([github], ['--track', 'beta', '--rollout', '5', '--submit'], publishers))
            .toThrow("crossbind: --track and --rollout are google-play's and --submit is app-store's, which github takes none of.");
        expect(() => publishOptions([appStore], ['--draft'], publishers)).toThrow("crossbind: --draft is google-play's, which app-store takes none of.");
    });

    test('take a value where they take one, and none where they are a flag', () => {
        expect(() => publishOptions([googlePlay], ['--track'], publishers)).toThrow('crossbind: --track takes a value, as <track>.');
        expect(() => publishOptions([googlePlay], ['--track', '--draft'], publishers)).toThrow('crossbind: --track takes a value, as <track>.');
        expect(() => publishOptions([googlePlay], ['--draft=yes'], publishers)).toThrow('crossbind: --draft takes no value.');
    });

    test('go to every publisher of a chain that takes them, as camelCase names of their --kebab-case', () => {
        const notes = extension('notes', { platform: 'macos', after: 'github', options: { releaseNotes: { help: 'the notes', value: '<file>' }, draft: { help: 'a draft' } } });
        expect(publishOptions([github, notes], ['--draft', '--release-notes', 'notes.md'], [...publishers, notes]).options).toEqual({
            github: { draft: true },
            notes: { releaseNotes: 'notes.md', draft: true },
        });
    });

    test('are taken alike by the publishers of a chain that take one of a name', () => {
        const notes = extension('notes', { platform: 'macos', after: 'github', options: { draft: { help: 'the draft to replace', value: '<id>' } } });
        expect(() => publishOptions([github, notes], ['--draft'], [...publishers, notes]))
            .toThrow('crossbind: github and notes both take --draft, one as a flag and one with a value: one of them names it otherwise.');
    });

    test("are listed in the command's help, store by store", () => {
        const help = publishHelp();
        expect(help).toContain('  google-play: Google Play, for android apps');
        expect(help).toContain('    --track <track>      the Google Play track the release goes on: internal, alpha, beta, production or one of your own (default: internal)');
        expect(help).toContain('  github: GitHub Releases, for macos, linux or windows apps');
        expect(help).toContain("An app's extensions add stores of their own");
    });
});

describe('a publish', () => {
    const run = {};
    const runVite = async (args, env) => {
        run.builds.push({ args, env });
        return run.exitCode;
    };
    // A store that takes what check says it lacks, its number and environment, and asks for one build more than it uploads.
    const store = (name, own = {}) => extension(name, {
        platform: 'android',
        store: 'Demo Store',
        options: { channel: { help: 'the channel', value: '<channel>', default: 'beta' } },
        check: async (api) => {
            run.apis.push(api);
            return own.missing ? { missing: own.missing } : { session: { token: name } };
        },
        buildNumber: async (api, session) => (session.token === name ? 42 : null),
        buildEnv: () => ({ DEMO_KEY: 'k' }),
        upload: async (api, session, output, published) => {
            run.uploads.push({
                name, session, output, published,
            });
            return { isRebuildAsked: run.uploads.length < (own.uploads ?? 1), published: `${name} ${run.uploads.length}` };
        },
        ...own.publisher,
    });
    // A store that publishes after another, from that one's build.
    const after = (name, first, own = {}) => extension(name, {
        platform: 'android',
        after: first,
        check: async () => (own.missing ? { missing: own.missing } : { session: { token: name } }),
        upload: async (api, session, output, published) => {
            run.uploads.push({
                name, session, output, published,
            });
            return own.isRebuildAsked ? { isRebuildAsked: true } : undefined;
        },
    });

    beforeEach(() => {
        Object.assign(run, {
            builds: [], uploads: [], apis: [], exitCode: 0,
        });
        state.config = { extensions: [] };
        reloads.length = 0;
        outputs.cleared = 0;
        terminal.isThere = false;
    });

    afterEach(() => vi.unstubAllEnvs());

    test('names every piece its publishers lack at once, before any build', async () => {
        state.config.extensions = [store('demo', { missing: ['no key'] }), after('mirror', 'demo', { missing: ['no account'] })];
        await expect(publish(['mirror'], { runVite })).rejects.toThrow('no key\nno account');
        expect(run.builds).toEqual([]);
    });

    test("builds the platform with the first publisher's number and environment, and hands the output to each upload in turn", async () => {
        terminal.isThere = true;
        state.config.extensions = [store('demo'), after('mirror', 'demo')];
        await publish(['mirror', '--channel', 'stable', '--mode', 'staging'], { envPlatform: 'ios', runVite });
        expect(run.apis.map(({
            name, platform, isGuided, options,
        }) => ({
            name, platform, isGuided, options,
        }))).toEqual([{
            name: 'demo', platform: 'android', isGuided: true, options: { channel: 'stable' },
        }]);
        expect(run.builds).toHaveLength(1);
        expect(run.builds[0].args).toEqual(['build', '--mode', 'staging']);
        expect(run.builds[0].env).toMatchObject({ DEMO_KEY: 'k', CROSSBIND_APP_PLATFORM: 'android', CROSSBIND_APP_BUILD_NUMBER: '42' });
        expect(run.builds[0].env.CROSSBIND_CONFIG_CHANGES).toBeUndefined();
        expect(run.uploads).toEqual([
            {
                name: 'demo', session: { token: 'demo' }, output: { project: '/demo/dist/demo-android' }, published: undefined,
            },
            {
                name: 'mirror', session: { token: 'mirror' }, output: { project: '/demo/dist/demo-android' }, published: 'demo 1',
            },
        ]);
        expect(outputs.cleared).toBe(1);
    });

    test("builds with the environment the first publisher's buildEnv gives, as any step may, once it resolves", async () => {
        state.config.extensions = [store('demo', { publisher: { buildEnv: async () => ({ DEMO_KEY: 'resolved', DEMO_GONE: undefined }) } })];
        await publish(['demo'], { runVite });
        expect(run.builds[0].env).toMatchObject({ DEMO_KEY: 'resolved' });
        expect(run.builds[0].env).toHaveProperty('DEMO_GONE', undefined);
    });

    test("builds with the first publisher's changes to the config, which this run reads too", async () => {
        const changes = { app: { updater: null, name: 'Demo for the store' } };
        state.config.extensions = [store('demo', { publisher: { build: (api) => (api.name === 'demo' ? changes : null) } })];
        await publish(['demo'], { runVite });
        expect(reloads).toEqual([changes]);
        expect(state.config.changed).toEqual(changes);
        expect(JSON.parse(run.builds[0].env.CROSSBIND_CONFIG_CHANGES)).toEqual(changes);
    });

    test('refuses changes to the config that are no object of JSON values', async () => {
        state.config.extensions = [store('demo', { publisher: { build: () => ({ app: { updater: () => {} } }) } })];
        await expect(publish(['demo'], { runVite })).rejects.toThrow("crossbind: demo's build gives no changes to crossbind.config.js, which are an object of JSON values merged into its export, where null removes a key.");
        state.config.extensions = [store('demo', { publisher: { build: () => ['app'] } })];
        await expect(publish(['demo'], { runVite })).rejects.toThrow("demo's build gives no changes");
        expect(run.builds).toEqual([]);
    });

    test('builds again as long as the first upload asks for it, and refuses another build to a publisher after it', async () => {
        state.config.extensions = [store('demo', { uploads: 3 })];
        await publish(['demo'], { runVite });
        expect(run.builds).toHaveLength(3);
        expect(run.uploads).toHaveLength(3);
        expect(outputs.cleared).toBe(3);

        run.uploads = [];
        state.config.extensions = [store('demo'), after('mirror', 'demo', { isRebuildAsked: true })];
        await expect(publish(['mirror'], { runVite })).rejects.toThrow('crossbind: mirror asks for another build, which demo, whose build it publishes from, alone can ask for.');
    });

    test('uploads nothing when the build fails, naming the store', async () => {
        run.exitCode = 2;
        state.config.extensions = [store('demo')];
        await expect(publish(['demo'], { runVite })).rejects.toMatchObject({
            message: 'crossbind: the build ended with exit code 2, so nothing went to Demo Store.', exitCode: 2,
        });
        expect(run.uploads).toEqual([]);
    });
});
