import assert from 'node:assert/strict';
import test from 'node:test';
import { followExpoSdk } from '../src/expo-sdk.js';

const REGISTRY = 'https://registry.example';

const TEMPLATE = Object.freeze({
    '@crossbind/plugin-react-native': '^2.0.0-beta.70',
    'hermes-compiler': '260318099.0.4',
    expo: '~58.0.14',
    'expo-router': '~58.0.23',
    react: '19.3.0',
    'react-native': '0.88.0',
    'react-native-safe-area-context': '~5.10.1',
});

const EXPO_TEMPLATE = Object.freeze({
    expo: '~58.0.23',
    'expo-router': '~58.0.30',
    'expo-only-in-the-official-template': '~1.0.0',
    react: '19.3.0',
    'react-native': '0.88.1',
    'react-native-safe-area-context': '~5.11.1',
});

const REACT_NATIVE = Object.freeze({ dependencies: { 'hermes-compiler': '260318099.0.5' } });

function fakeRegistry(routes) {
    const requested = [];
    const request = async (url, options) => {
        requested.push({ url, signal: options.signal });
        const path = url.slice(REGISTRY.length + 1);
        if (!(path in routes)) return { ok: false, status: 404 };
        return { ok: true, status: 200, json: async () => routes[path] };
    };
    return { request, requested };
}

const healthyRoutes = (dependencies = EXPO_TEMPLATE, reactNative = REACT_NATIVE) => ({
    'expo-template-default/sdk-58': { dependencies },
    [`react-native/${dependencies['react-native']}`]: reactNative,
});

const follow = (routes, registry = REGISTRY) => followExpoSdk(TEMPLATE, { registry, request: fakeRegistry(routes).request });

test('takes the versions Expo sets, and hermes-compiler from the react-native it names', async () => {
    assert.deepEqual(await follow(healthyRoutes()), {
        '@crossbind/plugin-react-native': '^2.0.0-beta.70',
        'hermes-compiler': '260318099.0.5',
        expo: '~58.0.23',
        'expo-router': '~58.0.30',
        react: '19.3.0',
        'react-native': '0.88.1',
        'react-native-safe-area-context': '~5.11.1',
    });
});

test('adds nothing the project does not depend on', async () => {
    assert.equal('expo-only-in-the-official-template' in (await follow(healthyRoutes())), false);
});

test('leaves the dependencies it was given as they were', async () => {
    const before = { ...TEMPLATE };
    await follow(healthyRoutes());
    assert.deepEqual(TEMPLATE, before);
});

test("reads the template of the project's own SDK, within a time limit", async () => {
    const { request, requested } = fakeRegistry(healthyRoutes());
    await followExpoSdk(TEMPLATE, { registry: REGISTRY, request });
    assert.deepEqual(requested.map(({ url }) => url), [`${REGISTRY}/expo-template-default/sdk-58`, `${REGISTRY}/react-native/0.88.1`]);
    assert.ok(requested.every(({ signal }) => signal instanceof AbortSignal));
});

test('accepts a registry address that ends with a slash', async () => {
    assert.equal((await follow(healthyRoutes(), `${REGISTRY}/`))['react-native'], '0.88.1');
});

test('takes the registry the package manager was configured with', async (t) => {
    const before = process.env.npm_config_registry;
    t.after(() => {
        if (before === undefined) delete process.env.npm_config_registry;
        else process.env.npm_config_registry = before;
    });
    process.env.npm_config_registry = REGISTRY;
    const { request, requested } = fakeRegistry(healthyRoutes());
    await followExpoSdk(TEMPLATE, { request });
    assert.equal(requested[0].url, `${REGISTRY}/expo-template-default/sdk-58`);
});

test('fails when the registry does not have the SDK', async () => {
    await assert.rejects(follow({}), /expo-template-default\/sdk-58: HTTP 404/);
});

test('fails when the registry cannot be reached', async () => {
    const request = async () => {
        throw new TypeError('fetch failed');
    };
    await assert.rejects(followExpoSdk(TEMPLATE, { registry: REGISTRY, request }), /fetch failed/);
});

for (const version of ['file:../expo-router', 'git+https://example.com/expo-router.git', 'latest', '*', '']) {
    test(`refuses "${version}" as the version of a package the project depends on`, async () => {
        await assert.rejects(follow(healthyRoutes({ ...EXPO_TEMPLATE, 'expo-router': version })), /expo-router: unexpected version/);
    });
}

test('ignores what it would not use: a package the project does not depend on', async () => {
    const result = await follow(healthyRoutes({ ...EXPO_TEMPLATE, 'expo-only-in-the-official-template': 'file:../x' }));
    assert.equal(result.expo, '~58.0.23');
});

test('refuses a react-native that is not one exact version', async () => {
    const routes = { 'expo-template-default/sdk-58': { dependencies: { ...EXPO_TEMPLATE, 'react-native': '~0.88.1' } } };
    await assert.rejects(follow(routes), /react-native: unexpected version "~0\.88\.1"/);
});

test('refuses a template that names no react-native', async () => {
    const { 'react-native': _, ...withoutReactNative } = EXPO_TEMPLATE;
    await assert.rejects(follow({ 'expo-template-default/sdk-58': { dependencies: withoutReactNative } }), /react-native: unexpected version/);
});

test('refuses a react-native that names no hermes-compiler', async () => {
    await assert.rejects(follow(healthyRoutes(EXPO_TEMPLATE, { dependencies: {} })), /react-native@0\.88\.1: unexpected hermes-compiler/);
});
