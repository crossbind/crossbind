import os from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: {} };
vi.mock('../src/utils/appExtensions.js', async (importOriginal) => (await import('./ownTools.js')).default(importOriginal));
vi.mock('../src/state/index.js', () => ({ default: state }));
// The config read again with a publisher's changes, as the build reads it, and whether each read took its files afresh.
const reloads = [];
const freshReads = [];
vi.mock('../src/state/loadConfig.js', () => ({
    default: async (configDir, configName, { changes, isFresh }) => {
        reloads.push(changes);
        freshReads.push(isFresh);
        return { ...state.config, changed: changes };
    },
}));
const outputs = { cleared: 0 };
vi.mock('../src/actions/buildApp.js', () => ({
    DESKTOP_PLATFORMS: { darwin: 'macos', linux: 'linux', win32: 'windows' },
    MAX_VERSION_CODE: 2100000000,
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
    builtInPublishers, default: publish, publishChain, publishHelp, publishOptions, publishPlatforms, publishersOf, storeOf,
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
        const publishers = builtInPublishers();
        expect(storeOf(['--mode', 'staging'], 'ios', 'android', publishers)).toEqual({ store: 'app-store', rest: ['--mode', 'staging'] });
        expect(storeOf([], undefined, 'android', publishers).store).toBe('google-play');
        expect(storeOf([], 'linux', undefined, publishers).store).toBeNull();
        expect(storeOf([], 'macos', undefined, publishers).store).toBeNull();
        expect(storeOf([], undefined, undefined, publishers).store).toBeNull();
    });

    test("is the last that says it is its platform's, so that an app's own comes before crossbind's", () => {
        const own = extension('own-store', { platform: 'android', isDefault: true });
        const listed = extension('acme-store', { platform: 'android', isDefault: true });
        const other = extension('other-store', { platform: 'android' });
        expect(storeOf([], 'android', undefined, [own, listed, other]).store).toBe('acme-store');
        expect(storeOf([], 'ios', undefined, [own, listed, other]).store).toBeNull();
    });

    test('is one that goes first for the platforms it lists alone, of those it takes', () => {
        const store = extension('dual-store', { platform: ['ios', 'macos'], isDefault: ['ios'] });
        expect(storeOf([], 'ios', undefined, [store]).store).toBe('dual-store');
        expect(storeOf([], 'macos', undefined, [store]).store).toBeNull();
    });

    test('is named before the options, as one named after them would go on to Vite', () => {
        const publishers = builtInPublishers();
        expect(() => storeOf(['--track', 'beta', 'google-play'], 'android', undefined, publishers))
            .toThrow('crossbind: crossbind app publish takes the store first, before the options: crossbind app publish google-play --track beta.');
        expect(storeOf(['--mode', 'staging'], 'android', undefined, publishers).store).toBe('google-play');
    });

    test("is one of the app's publishers, which the command names when it names none of them", () => {
        const publishers = builtInPublishers();
        expect(() => publishChain(publishers, 'winget')).toThrow('crossbind: crossbind app publish takes the store it sends the app to first: app-store, github, google-play or microsoft-store, not winget.');
        expect(() => publishChain(publishers, null)).toThrow('crossbind: crossbind app publish takes the store it sends the app to first: app-store, github, google-play or microsoft-store.');
    });
});

describe('the publishers an app has', () => {
    test("are crossbind's own, each a publisher of its platforms with its options, from a folder of its own", () => {
        const publishers = builtInPublishers();
        expect(publishers.map(({ name, publisher }) => [name, publisher.platforms, Object.keys(publisher.options)])).toEqual([
            ['app-store', ['ios', 'macos'], ['submit', 'phased']],
            ['github', ['macos', 'linux', 'windows'], ['draft']],
            ['google-play', ['android'], ['track', 'draft', 'rollout']],
            ['microsoft-store', ['windows'], ['draft', 'rollout']],
        ]);
        expect(publishers.map(({ root }) => root.split(/[\\/]/).slice(-2).join('/'))).toEqual([
            'extensions/app-store', 'extensions/github', 'extensions/google-play', 'extensions/microsoft-store',
        ]);
    });

    test("take an app's extension of one's name with a publisher in its place, and the app's others after them", () => {
        const github = extension('github', { platform: 'macos' });
        const appOnly = checkedExtension({ name: 'google-play', app: {} }, os.tmpdir(), 'extensions[0]');
        const publishers = publishersOf([appOnly, extension('homebrew', { platform: 'macos', after: 'github' }), github]);
        expect(names(publishers)).toEqual(['app-store', 'github', 'google-play', 'microsoft-store', 'homebrew']);
        expect(publishers[1]).toBe(github);
        expect(publishers[2].publisher.store).toBe('Google Play');
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

describe('the platforms a publish builds for', () => {
    const [, github, googlePlay] = builtInPublishers();

    test('are the one -p names, which every publisher of the publish takes', () => {
        expect(publishPlatforms([github], 'windows', 'linux', 'darwin')).toEqual(['windows']);
        expect(() => publishPlatforms([googlePlay], 'ios', undefined)).toThrow("crossbind: google-play takes android apps, not ios', which -p names.");
        expect(() => publishPlatforms([github], 'android', undefined)).toThrow("crossbind: github takes macos, linux or windows apps, not android's, which -p names.");
    });

    test("are else a store's only one, whatever CROSSBIND_APP_PLATFORM says", () => {
        expect(publishPlatforms([googlePlay], undefined, 'ios')).toEqual(['android']);
    });

    test("are else CROSSBIND_APP_PLATFORM's, else this machine's desktop one for a store of desktop apps alone", () => {
        expect(publishPlatforms([github], undefined, 'linux', 'darwin')).toEqual(['linux']);
        expect(() => publishPlatforms([github], undefined, 'android', 'darwin')).toThrow("crossbind: github takes macos, linux or windows apps, not android's, which CROSSBIND_APP_PLATFORM names.");
        expect(['darwin', 'linux', 'win32'].map((host) => publishPlatforms([github], undefined, undefined, host))).toEqual([['macos'], ['linux'], ['windows']]);
        const tap = extension('tap', { platform: ['linux', 'windows'] });
        expect(() => publishPlatforms([tap], undefined, undefined, 'darwin')).toThrow('crossbind: tap takes linux or windows apps: name one with -p.');
    });

    test("are else every one of a store that takes a phone's apps too, as App Store Connect keeps an app's iOS and macOS builds in one record", () => {
        const [appStore] = builtInPublishers();
        expect(publishPlatforms([appStore], undefined, undefined, 'darwin')).toEqual(['ios', 'macos']);
        expect(publishPlatforms([appStore], 'macos', undefined, 'darwin')).toEqual(['macos']);
        expect(publishPlatforms([appStore], undefined, 'ios', 'darwin')).toEqual(['ios']);
    });

    test('are those every publisher of a chain takes', () => {
        const homebrew = extension('homebrew', { platform: 'macos', after: 'github' });
        expect(publishPlatforms([github, homebrew], undefined, undefined, 'linux')).toEqual(['macos']);
        const store = extension('store', { platform: 'android', after: 'github' });
        expect(() => publishPlatforms([github, store], undefined, undefined)).toThrow('crossbind: store comes after github, which takes apps of none of its platforms.');
    });
});

describe('the options of a publish', () => {
    const publishers = builtInPublishers();
    const [appStore, github, googlePlay] = publishers;

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
        expect(() => publishOptions([appStore], ['--draft'], publishers)).toThrow("crossbind: --draft is github's, which app-store takes none of.");
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
        freshReads.length = 0;
        outputs.cleared = 0;
        terminal.isThere = false;
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

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

    test('stops once the first upload has asked for as many builds as a publish makes', async () => {
        state.config.extensions = [store('demo', { uploads: 10 })];
        await expect(publish(['demo'], { runVite })).rejects.toThrow('crossbind: demo asks for another build after 4, as many as a publish makes.');
        expect(run.builds).toHaveLength(4);
    });

    test("names the publisher and the step a failure comes from, where its message is not crossbind's own", async () => {
        state.config.extensions = [store('demo', { publisher: { check: () => { throw new TypeError("Cannot read properties of undefined (reading 'token')"); } } })];
        await expect(publish(['demo'], { runVite })).rejects.toThrow("crossbind: demo's check failed: Cannot read properties of undefined (reading 'token')");
        state.config.extensions = [store('demo', { publisher: { upload: async () => { throw new Error('crossbind: Demo Store took no upload.'); } } })];
        await expect(publish(['demo'], { runVite })).rejects.toThrow(/^crossbind: Demo Store took no upload\.$/);
    });

    test('refuses a build number no store takes before the build, naming the publisher that gave it', async () => {
        for (const number of [0, 1.5, '42', 2100000001]) {
            state.config.extensions = [store('demo', { publisher: { buildNumber: () => number } })];
            await expect(publish(['demo'], { runVite })).rejects.toThrow(`crossbind: demo's buildNumber gives ${JSON.stringify(number)}, which is no build number`);
        }
        expect(run.builds).toEqual([]);
    });

    test('takes a build number from 1 to 2100000000, as both stores do', async () => {
        for (const number of [1, 2100000000]) {
            state.config.extensions = [store('demo', { publisher: { buildNumber: () => number } })];
            await publish(['demo'], { runVite });
            expect(run.builds.at(-1).env).toMatchObject({ CROSSBIND_APP_BUILD_NUMBER: String(number) });
        }
    });

    test('uploads nothing when the build fails, naming the store', async () => {
        run.exitCode = 2;
        state.config.extensions = [store('demo')];
        await expect(publish(['demo'], { runVite })).rejects.toMatchObject({
            message: 'crossbind: the build ended with exit code 2, so nothing went to Demo Store.', exitCode: 2,
        });
        expect(run.uploads).toEqual([]);
    });

    test("sends each platform of a store that takes a phone's apps in turn, with its own changes, after checking them all", async () => {
        const events = [];
        const changes = { app: { macos: { sandbox: true } } };
        const changed = () => JSON.stringify(state.config.changed ?? null);
        state.config.extensions = [store('demo', {
            publisher: {
                platform: ['ios', 'macos'],
                build: (api) => (api.platform === 'macos' ? changes : null),
                check: async (api) => {
                    events.push(`check ${api.platform} ${changed()}`);
                    return { session: { token: 'demo' } };
                },
                upload: async (api, session, output) => {
                    events.push(`upload ${api.platform} ${output.project} ${changed()}`);
                },
            },
        })];
        await publish(['demo'], {
            runVite: async (args, env) => {
                events.push(`build ${env.CROSSBIND_APP_PLATFORM} ${env.CROSSBIND_CONFIG_CHANGES ?? null} ${env.CROSSBIND_APP_BUILD_NUMBER}`);
                return 0;
            },
        });
        const patch = JSON.stringify(changes);
        expect(events).toEqual([
            'check ios null',
            `check macos ${patch}`,
            'build ios null 42',
            'upload ios /demo/dist/demo-ios null',
            `build macos ${patch} 42`,
            `upload macos /demo/dist/demo-macos ${patch}`,
        ]);
        // Each read of the config after the first platform's checks takes its files afresh, with what those wrote.
        expect(freshReads.length).toBeGreaterThan(0);
        expect(freshReads.every(Boolean)).toBe(true);
        expect(console.log).toHaveBeenCalledWith('crossbind: publishing the app for ios then macos; -p publishes one alone.');
    });

    test('sends the platform -p names alone', async () => {
        state.config.extensions = [store('demo', { publisher: { platform: ['ios', 'macos'] } })];
        await publish(['demo'], { platform: 'macos', runVite });
        expect(run.builds.map(({ env }) => env.CROSSBIND_APP_PLATFORM)).toEqual(['macos']);
        expect(console.log).not.toHaveBeenCalled();
    });

    test('names what any platform lacks before the first build of all', async () => {
        state.config.extensions = [store('demo', {
            publisher: {
                platform: ['ios', 'macos'],
                check: async (api) => (api.platform === 'macos' ? { missing: ['no category'] } : { session: { token: 'demo' } }),
            },
        })];
        await expect(publish(['demo'], { runVite })).rejects.toThrow(/^no category$/);
        expect(run.builds).toEqual([]);
    });

    test('says what went to the store before a platform failed, and how to publish the rest', async () => {
        state.config.extensions = [store('demo', { publisher: { platform: ['ios', 'macos'] } })];
        const failing = (platform, exitCode) => async (args, env) => (env.CROSSBIND_APP_PLATFORM === platform ? exitCode : runVite(args, env));
        await expect(publish(['demo'], { runVite: failing('macos', 2) })).rejects.toMatchObject({
            message: 'crossbind: the build ended with exit code 2, so nothing went to Demo Store.\ncrossbind: ios went to Demo Store before macos stopped; publish macos alone, with -p macos.',
            exitCode: 2,
        });
        expect(run.uploads.map(({ output }) => output.project)).toEqual(['/demo/dist/demo-ios']);

        Object.assign(run, { builds: [], uploads: [] });
        await expect(publish(['demo'], { runVite: failing('ios', 3) })).rejects.toThrow(/^crossbind: the build ended with exit code 3, so nothing went to Demo Store\.$/);
        expect(run.builds).toEqual([]);
        expect(run.uploads).toEqual([]);
    });
});
