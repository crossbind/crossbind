import { describe, expect, test } from 'vitest';
import { checkedGuide, guideText, guidedPublishers } from '../src/actions/storeGuide.js';

const publisherOf = (name, hasGuide) => ({ name, publisher: { store: null, ...(hasGuide ? { guide: () => null } : {}) } });
const PUBLISHERS = [publisherOf('app-store', true), publisherOf('github', false), publisherOf('google-play', true)];

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

describe("a store's guide", () => {
    const guide = {
        sends: ['the bundle', 'store/demo/en-US: title'],
        problems: ['crossbind: store/demo/en-US/icon.png is 500 × 500, and Demo Store takes an icon of 512 × 512.'],
        where: 'Demo Console',
        steps: [
            { text: 'Create the app.', url: 'https://demo.example/console' },
            { text: 'Store listing, each field from its file:', details: ['Title ← store/demo/en-US/title.txt'] },
        ],
    };

    test('is written as what a publish sends, what to fix first, and the steps by hand, in order', () => {
        expect(guideText({ name: 'demo-store', publisher: { store: 'Demo Store' } }, guide, 'Demo 1.2.3')).toBe([
            'Demo Store · Demo 1.2.3',
            '',
            'crossbind app publish demo-store sends:',
            '  ✓ the bundle',
            '  ✓ store/demo/en-US: title',
            '',
            'To fix first, as Demo Store refuses it and a publish stops before its build:',
            '  ✗ store/demo/en-US/icon.png is 500 × 500, and Demo Store takes an icon of 512 × 512.',
            '',
            'By hand in Demo Console, once for the app:',
            '  1. Create the app.',
            '     https://demo.example/console',
            '  2. Store listing, each field from its file:',
            '     - Title ← store/demo/en-US/title.txt',
        ].join('\n'));
    });

    test('leaves out a part it has nothing of, and names the store by its extension where it has no name', () => {
        expect(guideText({ name: 'demo-store', publisher: { store: null } }, {
            sends: [], problems: [], where: 'Demo Console', steps: [],
        }, 'Demo 1.2.3')).toBe('demo-store · Demo 1.2.3');
    });

    test('is refused where it is not the shape crossbind writes, naming the publisher', () => {
        expect(checkedGuide('demo-store', guide)).toBe(guide);
        const message = "crossbind: demo-store's guide gives no { sends, problems, where, steps }";
        expect(() => checkedGuide('demo-store', null)).toThrow(message);
        expect(() => checkedGuide('demo-store', { ...guide, sends: 'the bundle' })).toThrow(message);
        expect(() => checkedGuide('demo-store', { ...guide, steps: [{ text: 'Create the app.', details: 'Title' }] })).toThrow(message);
        expect(() => checkedGuide('demo-store', { ...guide, where: undefined })).toThrow(message);
    });
});
