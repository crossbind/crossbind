import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const outputs = { cleared: 0 };
vi.mock('../src/actions/buildApp.js', () => ({
    DESKTOP_PLATFORMS: { darwin: 'macos', linux: 'linux', win32: 'windows' },
    appOutputOf: (platform) => `/demo/dist/demo-${platform}`,
    clearAppOutputs: () => {
        outputs.cleared += 1;
    },
}));
const terminal = { isThere: false };
vi.mock('../src/utils/ask.js', () => ({ hasTerminal: () => terminal.isThere }));

const { default: publish, desktopPlatformOf, storeOf } = await import('../src/actions/publish.js');

describe('the store crossbind app publish sends an app to', () => {
    test('is the one the command names first, before the options Vite takes', () => {
        expect(storeOf(['google-play', '--mode', 'staging'], undefined, undefined)).toEqual({ store: 'google-play', viteArgs: ['--mode', 'staging'] });
        expect(storeOf(['winget'], undefined, undefined)).toEqual({ store: 'winget', viteArgs: [] });
    });

    test('is else the one of the platform -p or CROSSBIND_APP_PLATFORM names, and none without either', () => {
        expect(storeOf(['--mode', 'staging'], 'ios', 'android')).toEqual({ store: 'app-store', viteArgs: ['--mode', 'staging'] });
        expect(storeOf([], undefined, 'android')).toEqual({ store: 'google-play', viteArgs: [] });
        expect(storeOf([], undefined, undefined)).toEqual({ store: null, viteArgs: [] });
    });

    test('is not named one way by -p and another by its name, which CROSSBIND_APP_PLATFORM gives way to', () => {
        expect(() => storeOf(['app-store'], 'android', undefined)).toThrow('crossbind: -p android names the store google-play, not app-store.');
        expect(storeOf(['google-play'], undefined, 'ios').store).toBe('google-play');
    });

    test("takes a desktop platform's app where -p names one, and none a mobile store takes", () => {
        expect(storeOf(['github'], 'macos', undefined)).toEqual({ store: 'github', viteArgs: [] });
        expect(storeOf([], 'linux', undefined).store).toBeNull();
        expect(() => storeOf(['github'], 'android', undefined)).toThrow('crossbind: -p android names the store google-play, not github.');
        expect(() => storeOf(['google-play'], 'windows', undefined)).toThrow('crossbind: google-play takes no windows app, which -p windows names.');
    });

    test("builds a desktop store's app for the platform -p names, else CROSSBIND_APP_PLATFORM's, else this machine's", () => {
        expect(desktopPlatformOf('github', 'windows', 'linux', 'darwin')).toBe('windows');
        expect(desktopPlatformOf('github', undefined, 'linux', 'darwin')).toBe('linux');
        expect(desktopPlatformOf('github', undefined, '', 'darwin')).toBe('macos');
        expect(['darwin', 'linux', 'win32'].map((host) => desktopPlatformOf('github', undefined, undefined, host))).toEqual(['macos', 'linux', 'windows']);
        expect(() => desktopPlatformOf('github', undefined, 'android', 'darwin')).toThrow("crossbind: github takes desktop apps, of macos, linux or windows, not android's.");
    });
});

describe('a publish', () => {
    const run = {};
    const runVite = async (args, env) => {
        run.builds.push({ args, env });
        return run.exitCode;
    };
    // A store that takes what check says it lacks, its number and environment, and asks for one build more than it uploads.
    const publisher = (store = {}) => ({
        platform: 'android',
        store: 'Demo Store',
        check: async (context) => {
            run.contexts.push(context);
            return store.missing ? { missing: store.missing } : { session: { token: 't' } };
        },
        buildNumber: async (context, session) => (session.token === 't' ? 42 : null),
        buildEnv: () => ({ DEMO_KEY: 'k' }),
        upload: async (context, session, output) => {
            run.uploads.push({ session, output });
            return { isRebuildAsked: run.uploads.length < (store.uploads ?? 1) };
        },
    });

    beforeEach(() => {
        Object.assign(run, { builds: [], uploads: [], contexts: [], exitCode: 0 });
        outputs.cleared = 0;
        terminal.isThere = false;
    });

    afterEach(() => vi.unstubAllEnvs());

    test('names every piece the store lacks at once, before any build', async () => {
        await expect(publish(publisher({ missing: ['no key', 'no account'] }), { viteArgs: [] }, { runVite })).rejects.toThrow('no key\nno account');
        expect(run.builds).toEqual([]);
    });

    test("builds the publisher's platform with its number and environment, and hands the output to its upload", async () => {
        terminal.isThere = true;
        vi.stubEnv('CROSSBIND_APP_PLATFORM', 'ios');
        await publish(publisher(), { viteArgs: ['--mode', 'staging'], track: 'beta' }, { runVite });
        expect(run.contexts).toEqual([{ isGuided: true, options: { viteArgs: ['--mode', 'staging'], track: 'beta' } }]);
        expect(run.builds).toHaveLength(1);
        expect(run.builds[0].args).toEqual(['build', '--mode', 'staging']);
        expect(run.builds[0].env).toMatchObject({ DEMO_KEY: 'k', CROSSBIND_APP_PLATFORM: 'android', CROSSBIND_APP_BUILD_NUMBER: '42' });
        expect(run.uploads).toEqual([{ session: { token: 't' }, output: '/demo/dist/demo-android' }]);
        expect(outputs.cleared).toBe(1);
    });

    test('builds again as long as the upload asks for it', async () => {
        await publish(publisher({ uploads: 3 }), {}, { runVite });
        expect(run.builds).toHaveLength(3);
        expect(run.uploads).toHaveLength(3);
        expect(outputs.cleared).toBe(3);
    });

    test('uploads nothing when the build fails, naming the store', async () => {
        run.exitCode = 2;
        await expect(publish(publisher(), {}, { runVite })).rejects.toMatchObject({
            message: 'crossbind: the build ended with exit code 2, so nothing went to Demo Store.', exitCode: 2,
        });
        expect(run.uploads).toEqual([]);
    });
});
