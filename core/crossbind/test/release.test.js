import os from 'node:os';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: {}, targets: [] };
vi.mock('../src/utils/appExtensions.js', async (importOriginal) => (await import('./ownTools.js')).default(importOriginal));
vi.mock('../src/state/index.js', () => ({ default: state }));
// Each publisher's api, as the release makes it: its name and what the release gives it.
vi.mock('../src/actions/extensionApi.js', () => ({
    default: (name, options) => ({ name, ...options }),
}));
const terminal = { isThere: false };
vi.mock('../src/utils/ask.js', () => ({ hasTerminal: () => terminal.isThere }));

const { checkedExtension } = await import('../src/utils/appExtensions.js');
const { publishersOf } = await import('../src/actions/publish.js');
const { default: release, releaseStores, rolloutPercent } = await import('../src/actions/release.js');
const { appStores } = await import('../src/utils/appOptions.js');

let released;
// An app's extension with a publisher of a store, whose release says what it got and answers as given, and stages where
// canStage says so.
const store = (name, platform, { answer = () => ({}), canStage = true } = {}) => checkedExtension({
    name,
    publisher: {
        platform,
        canStage,
        upload: async () => {},
        release: async (api) => {
            released.push([name, api.platform, api.options.rollout, api.isGuided]);
            return answer(api);
        },
    },
}, os.tmpdir(), `extensions[${name}]`);
const names = (publishers) => publishers.map(({ name }) => name);

beforeEach(() => {
    released = [];
    terminal.isThere = false;
    state.config = { app: {}, extensions: [store('demo-store', 'android'), store('fruit-store', ['ios', 'macos'])] };
});

describe('the stores crossbind app release puts the app out on', () => {
    test('are the one named, else those app.stores names, in its order', () => {
        const publishers = publishersOf(state.config.extensions);
        expect(names(releaseStores(publishers, { store: 'fruit-store' }))).toEqual(['fruit-store']);
        expect(names(releaseStores(publishers, { stores: ['fruit-store', 'demo-store'] }))).toEqual(['fruit-store', 'demo-store']);
    });

    test('are those of the platform -p names, of app.stores, else the one that goes first for it', () => {
        const publishers = publishersOf(state.config.extensions);
        expect(names(releaseStores(publishers, { platform: 'ios', stores: ['demo-store', 'fruit-store'] }))).toEqual(['fruit-store']);
        expect(names(releaseStores(publishers, { envPlatform: 'android' }))).toEqual(['google-play']);
    });

    test('refuse a store no publisher is, one whose publisher puts nothing out, and none named', () => {
        const publishers = publishersOf([...state.config.extensions, checkedExtension({ name: 'mute-store', publisher: { platform: 'linux', upload: async () => {} } }, os.tmpdir(), 'extensions[mute-store]')]);
        expect(() => releaseStores(publishers, { store: 'winget' })).toThrow('crossbind: crossbind app release puts the app out on');
        expect(() => releaseStores(publishers, { store: 'winget' })).toThrow(', not winget.');
        expect(() => releaseStores(publishers, { store: 'mute-store' })).toThrow("crossbind: mute-store's publisher puts nothing out, as it has no release.");
        expect(() => releaseStores(publishers, {})).toThrow('or app.stores in crossbind.config.js names them.');
    });
});

describe('a release', () => {
    test("goes to each store app.stores names, on each platform its publisher takes, with --rollout's share", async () => {
        state.config.app.stores = ['demo-store', 'fruit-store'];
        terminal.isThere = true;
        await release([], { rollout: '10' });
        expect(released).toEqual([
            ['demo-store', 'android', 10, true], ['fruit-store', 'ios', 10, true], ['fruit-store', 'macos', 10, true],
        ]);
    });

    test('goes to the platform -p names alone, with no rollout where none is given', async () => {
        await release(['fruit-store'], { platform: 'macos' });
        expect(released).toEqual([['fruit-store', 'macos', null, false]]);
    });

    test('names every piece missing on every store at once, each once', async () => {
        state.config.extensions = [
            store('demo-store', 'android', { answer: () => ({ missing: ['crossbind: no key.'] }) }),
            store('fruit-store', ['ios', 'macos'], { answer: () => ({ missing: ['crossbind: no key.', 'crossbind: no team.'] }) }),
        ];
        state.config.app.stores = ['demo-store', 'fruit-store'];
        await expect(release([], {})).rejects.toThrow(new Error('crossbind: no key.\ncrossbind: no team.'));
        expect(released).toHaveLength(3);
    });
});

describe("--rollout's share of the users", () => {
    test('is a percent above 0 and at most 100 with two decimals at most, as 10 or 12.5%', () => {
        expect(['10', '12.5%', '0.01', '100'].map(rolloutPercent)).toEqual([10, 12.5, 0.01, 100]);
        ['0', '101', 'ten', '-5', '10%%', '12.345', ''].forEach((value) => expect(() => rolloutPercent(value))
            .toThrow(`crossbind: --rollout takes the percent of the users a release reaches at first, above 0 and at most 100 with two decimals at most, as 10 or 12.5%, not ${value}.`));
    });

    test('is all of them at once at 100, as without --rollout', async () => {
        await release(['fruit-store'], { platform: 'ios', rollout: '100%' });
        expect(released).toEqual([['fruit-store', 'ios', null, false]]);
    });

    test('stops the release before any store puts the app out where one reaches every user at once, naming how to release', async () => {
        state.config.extensions = [...state.config.extensions, store('direct-store', 'android', { canStage: false })];
        state.config.app.stores = ['demo-store', 'direct-store'];
        await expect(release([], { rollout: '10' })).rejects
            .toThrow('crossbind: direct-store puts the app out to every user at once, which --rollout 10 cannot stage: release direct-store without --rollout, and demo-store by name with it.');
        await expect(release(['direct-store'], { rollout: '10%' })).rejects
            .toThrow('crossbind: direct-store puts the app out to every user at once, which --rollout 10% cannot stage: release direct-store without --rollout.');
        expect(released).toEqual([]);
        await release(['direct-store'], { rollout: '100' });
        expect(released).toEqual([['direct-store', 'android', null, false]]);
    });
});

describe('app.stores', () => {
    test("is a list of stores' names, each once, or not set", () => {
        expect(appStores({ app: {} })).toBeNull();
        expect(appStores({ app: { stores: ['google-play', 'app-store'] } })).toEqual(['google-play', 'app-store']);
        const message = "crossbind: app.stores \"google-play\" is no list of stores' names, each once, as ['google-play', 'app-store'].";
        expect(() => appStores({ app: { stores: 'google-play' } })).toThrow(message);
        expect(() => appStores({ app: { stores: ['google-play', 'google-play'] } })).toThrow('is no list of stores');
        expect(() => appStores({ app: { stores: [] } })).toThrow('is no list of stores');
    });
});
