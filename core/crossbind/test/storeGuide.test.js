import { describe, expect, test } from 'vitest';
import {
    checkedGuide, checkedState, guideText, guidedPublishers, pagePlatforms, sendingPublishers,
} from '../src/actions/storeGuide.js';

const publisherOf = (name, { guide = false, send = false, platforms = ['android'] } = {}) => ({
    name, publisher: { store: null, platforms, ...(guide ? { guide: () => null } : {}), ...(send ? { send: () => null } : {}) },
});
const PUBLISHERS = [
    publisherOf('app-store', { guide: true, send: true, platforms: ['ios', 'macos'] }),
    publisherOf('github', { platforms: ['macos', 'linux', 'windows'] }),
    publisherOf('google-play', { guide: true, send: true }),
];

describe('the stores crossbind app store tells of', () => {
    test('are every one whose publisher has a guide, or the one named', () => {
        expect(guidedPublishers(PUBLISHERS).map(({ name }) => name)).toEqual(['app-store', 'google-play']);
        expect(guidedPublishers(PUBLISHERS, 'google-play').map(({ name }) => name)).toEqual(['google-play']);
    });

    test('are none of a name no publisher has, or one whose publisher has no guide', () => {
        expect(() => guidedPublishers(PUBLISHERS, 'winget')).toThrow('crossbind: crossbind app store tells of app-store or google-play, not winget.');
        expect(() => guidedPublishers(PUBLISHERS, 'github')).toThrow("crossbind: github's publisher has no guide, so it tells nothing of its store.");
    });
});

describe('the stores crossbind app store --send sends the page of', () => {
    test('are every one whose publisher sends one, or the one named', () => {
        expect(sendingPublishers(PUBLISHERS).map(({ name }) => name)).toEqual(['app-store', 'google-play']);
        expect(sendingPublishers(PUBLISHERS, 'app-store').map(({ name }) => name)).toEqual(['app-store']);
    });

    test('are none of a name no publisher has, or one whose store has no page', () => {
        expect(() => sendingPublishers(PUBLISHERS, 'winget')).toThrow('crossbind: crossbind app store --send sends the page of app-store or google-play, not winget.');
        expect(() => sendingPublishers(PUBLISHERS, 'github')).toThrow("crossbind: github's publisher sends no page of its store.");
    });

    test('go for every platform the publisher takes, or the one -p names', () => {
        const [appStore] = PUBLISHERS;
        expect(pagePlatforms(appStore)).toEqual(['ios', 'macos']);
        expect(pagePlatforms(appStore, 'macos')).toEqual(['macos']);
        expect(() => pagePlatforms(appStore, 'android')).toThrow("crossbind: app-store takes ios or macos apps, not android's, which -p names.");
    });
});

describe("a store's guide", () => {
    const guide = {
        publishes: ['the bundle'],
        sends: ['store/demo/en-US: title'],
        problems: ['crossbind: store/demo/en-US/icon.png is 500 × 500, and Demo Store takes an icon of 512 × 512.'],
        where: 'Demo Console',
        steps: [
            { text: 'Create the app.', url: 'https://demo.example/console' },
            { text: 'Store listing, each field from its file:', details: ['Title ← store/demo/en-US/title.txt'] },
        ],
    };

    test('is written as what an upload sends, what --send sends, what to fix first, the steps by hand and what the store has, in order', () => {
        expect(guideText({ name: 'demo-store', publisher: { store: 'Demo Store' } }, guide, 'Demo 1.2.3', ['crossbind: internal: versionCode 7, out'])).toBe([
            'Demo Store · Demo 1.2.3',
            '',
            'crossbind app upload demo-store sends:',
            '  ✓ the bundle',
            '',
            'crossbind app store demo-store --send sends:',
            '  ✓ store/demo/en-US: title',
            '',
            'To fix first, as Demo Store would refuse it:',
            '  ✗ store/demo/en-US/icon.png is 500 × 500, and Demo Store takes an icon of 512 × 512.',
            '',
            'By hand in Demo Console, once for the app:',
            '  1. Create the app.',
            '     https://demo.example/console',
            '  2. Store listing, each field from its file:',
            '     - Title ← store/demo/en-US/title.txt',
            '',
            'Demo Store has now:',
            '  internal: versionCode 7, out',
        ].join('\n'));
    });

    test('leaves out a part it has nothing of, and names the store by its extension where it has no name', () => {
        expect(guideText({ name: 'demo-store', publisher: { store: null } }, {
            publishes: [], sends: [], problems: [], where: 'Demo Console', steps: [],
        }, 'Demo 1.2.3')).toBe('demo-store · Demo 1.2.3');
    });

    test('is refused where it is not the shape crossbind writes, naming the publisher', () => {
        expect(checkedGuide('demo-store', guide)).toBe(guide);
        const message = "crossbind: demo-store's guide gives no { publishes, sends, problems, where, steps }";
        expect(() => checkedGuide('demo-store', null)).toThrow(message);
        expect(() => checkedGuide('demo-store', { ...guide, publishes: 'the bundle' })).toThrow(message);
        expect(() => checkedGuide('demo-store', { ...guide, sends: undefined })).toThrow(message);
        expect(() => checkedGuide('demo-store', { ...guide, steps: [{ text: 'Create the app.', details: 'Title' }] })).toThrow(message);
        expect(() => checkedGuide('demo-store', { ...guide, where: undefined })).toThrow(message);
    });
});

describe("what a store has now, as its publisher's state tells", () => {
    test('is lines of text, naming the publisher where it is none', () => {
        expect(checkedState('demo-store', ['internal: versionCode 7, out'])).toEqual(['internal: versionCode 7, out']);
        expect(() => checkedState('demo-store', 'out')).toThrow("crossbind: demo-store's state gives no list of lines of what its store has.");
        expect(() => checkedState('demo-store', [7])).toThrow("crossbind: demo-store's state gives no list of lines");
    });
});
