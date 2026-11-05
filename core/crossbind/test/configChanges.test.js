import { describe, expect, test } from 'vitest';
import { CONFIG_CHANGES, configChangesOf, mergePatch } from '../src/utils/configChanges.js';

describe("a publisher's changes to crossbind.config.js", () => {
    test("merge into the config as a JSON merge patch does: an object's keys merge, null removes one, any other value replaces", () => {
        const config = { app: { name: 'Demo', updater: { url: 'u', publicKey: 'k' }, urlSchemes: ['demo'] }, dts: 'sync' };
        expect(mergePatch(config, { app: { updater: null, urlSchemes: ['store'], window: { width: 800 } }, dts: 'promise' })).toEqual({
            app: { name: 'Demo', urlSchemes: ['store'], window: { width: 800 } }, dts: 'promise',
        });
        expect(config.app.updater).toEqual({ url: 'u', publicKey: 'k' });
        expect(mergePatch({ app: 'none' }, { app: { name: 'Demo' } })).toEqual({ app: { name: 'Demo' } });
        expect(mergePatch({ app: { name: 'Demo' } }, ['whole'])).toEqual(['whole']);
    });

    test("come to a build in its environment, as an object's JSON", () => {
        expect(configChangesOf({})).toBeNull();
        expect(configChangesOf({ [CONFIG_CHANGES]: '{"app":{"updater":null}}' })).toEqual({ app: { updater: null } });
        expect(() => configChangesOf({ [CONFIG_CHANGES]: '{"app":' })).toThrow('crossbind: CROSSBIND_CONFIG_CHANGES holds no JSON');
        expect(() => configChangesOf({ [CONFIG_CHANGES]: '["app"]' })).toThrow('crossbind: CROSSBIND_CONFIG_CHANGES is no object of changes to crossbind.config.js.');
    });
});
