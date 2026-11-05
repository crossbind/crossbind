import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { appStoreCaller, appStoreToken, uploadParts } from '../../../extensions/app-store/src/appStoreApi.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());

let dir;
let key;
let requests;
let answer;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-store-api-'));
    const file = path.join(dir, 'AuthKey_ABC123DEFG.p8');
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    key = { key: file, keyId: 'ABC123DEFG', issuer: 'issuer-uuid' };
    requests = [];
    answer = () => json(200, { data: [] });
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        requests.push({ url, init });
        return answer();
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("an App Store Connect API key's token", () => {
    test('is a JWT signed ES256 by the key, for App Store Connect, for 10 minutes, well under the 20 it takes at most', () => {
        const now = Date.UTC(2026, 9, 30);
        const [header, payload, signature] = appStoreToken(key, now).split('.');
        expect(decode(header)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
        expect(decode(payload)).toEqual({ iss: 'issuer-uuid', iat: now / 1000, exp: now / 1000 + 600, aud: 'appstoreconnect-v1' });
        const bytes = Buffer.from(signature, 'base64url');
        expect(bytes).toHaveLength(64);
        expect(createVerify('SHA256').update(`${header}.${payload}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, bytes)).toBe(true);
    });
});

describe("App Store Connect's API", () => {
    test('takes a token of its own at each call, and bodies as JSON', async () => {
        const call = appStoreCaller(key);
        expect(await call('GET', '/apps?filter%5BbundleId%5D=dev.example.demo')).toEqual({ data: [] });
        const body = { data: { type: 'reviewSubmissions', id: 'S1', attributes: { submitted: true } } };
        await call('PATCH', '/reviewSubmissions/S1', body);

        expect(requests.map(({ url, init }) => [init.method, url])).toEqual([
            ['GET', 'https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=dev.example.demo'],
            ['PATCH', 'https://api.appstoreconnect.apple.com/v1/reviewSubmissions/S1'],
        ]);
        expect(requests[0].init.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
        expect(requests[0].init.headers['content-type']).toBeUndefined();
        expect(requests[1].init.headers['content-type']).toBe('application/json');
        expect(JSON.parse(requests[1].init.body)).toEqual(body);
    });

    test('says what Apple answered a call it refused with, without the query', async () => {
        answer = () => json(409, { errors: [{ status: '409', code: 'STATE_ERROR', title: 'The request cannot be fulfilled.', detail: 'The version is not in a valid state.' }] });
        await expect(appStoreCaller(key)('GET', '/apps/1/appStoreVersions?filter%5Bplatform%5D=IOS')).rejects.toMatchObject({
            status: 409, message: 'crossbind: App Store Connect answered GET /apps/1/appStoreVersions with 409: The version is not in a valid state.',
        });
        answer = () => new Response('Bad Gateway', { status: 502 });
        await expect(appStoreCaller(key)('POST', '/apps', {})).rejects.toThrow('crossbind: App Store Connect answered POST /apps with 502.');
        answer = () => json(409, {
            errors: [{
                code: 'ENTITY_ERROR', detail: 'There are problems with the request entity.', meta: { associatedErrors: { '/v1/appStoreVersions/V1': [{ code: 'ENTITY_ERROR.ATTRIBUTE.REQUIRED', detail: 'You must provide a value for the attribute copyright.' }] } },
            }],
        });
        await expect(appStoreCaller(key)('PATCH', '/reviewSubmissions/S1', {})).rejects
            .toThrow('crossbind: App Store Connect answered PATCH /reviewSubmissions/S1 with 409: There are problems with the request entity. You must provide a value for the attribute copyright.');
        answer = () => new Response('<html>Sign in to the network</html>', { status: 200 });
        await expect(appStoreCaller(key)('GET', '/apps')).rejects
            .toThrow('crossbind: App Store Connect answered GET /apps with no JSON, as a proxy between might: <html>Sign in to the network</html>');
    });

    test('asks again on a GET or PATCH that finds App Store Connect busy or out of reach, after the time Apple names, but not on a POST', async () => {
        vi.useFakeTimers();
        const answers = [json(429, {}), new Response('', { status: 503, headers: { 'retry-after': '2' } }), json(200, { data: ['A1'] })];
        answer = () => answers.shift();
        const asked = appStoreCaller(key)('GET', '/apps');
        await vi.advanceTimersByTimeAsync(10_000);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(await asked).toEqual({ data: ['A1'] });
        expect(requests).toHaveLength(3);

        requests = [];
        answer = () => json(503, { errors: [{ title: 'Service Unavailable' }] });
        await expect(appStoreCaller(key)('POST', '/reviewSubmissions', {})).rejects.toThrow('with 503: Service Unavailable');
        expect(requests).toHaveLength(1);

        requests = [];
        const busy = [json(429, { errors: [{ title: 'Rate limit exceeded' }] }), json(201, { data: { id: 'S1' } })];
        answer = () => busy.shift();
        const posted = appStoreCaller(key)('POST', '/reviewSubmissions', {});
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await posted).toEqual({ data: { id: 'S1' } });
        expect(requests).toHaveLength(2);

        requests = [];
        answer = () => {
            throw new TypeError('fetch failed', { cause: new Error('read ECONNRESET') });
        };
        const outOfReach = appStoreCaller(key)('GET', '/builds').catch((error) => error);
        await vi.advanceTimersByTimeAsync(30_000);
        expect((await outOfReach).message).toBe('crossbind: App Store Connect was out of reach for GET /builds: read ECONNRESET');
        expect(requests).toHaveLength(4);
        vi.useRealTimers();
    });

    test('names what to mend for a key it refuses, or for a role without the right', async () => {
        answer = () => json(401, { errors: [{ title: 'Authentication credentials are missing or invalid.' }] });
        await expect(appStoreCaller(key)('GET', '/apps')).rejects.toThrow([
            'crossbind: App Store Connect refused the API key ABC123DEFG (Authentication credentials are missing or invalid.):',
            "CROSSBIND_APPLE_API_KEY is not that key's .p8, CROSSBIND_APPLE_API_KEY_ID or CROSSBIND_APPLE_API_ISSUER is not its own, it was revoked, or this machine's clock is off.",
        ].join(' '));
        answer = () => json(403, { errors: [{ title: 'The API key in use does not allow this request' }] });
        await expect(appStoreCaller(key)('POST', '/reviewSubmissions', {})).rejects.toThrow([
            'crossbind: App Store Connect answered POST /reviewSubmissions with 403: The API key in use does not allow this request',
            'crossbind: the API key ABC123DEFG takes the App Manager or Admin role for that, which App Store Connect gives under Users and Access › Integrations.',
        ].join('\n'));
        answer = () => json(403, { errors: [{ code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED', detail: 'A required agreement is missing or has expired.' }] });
        await expect(appStoreCaller(key)('GET', '/apps')).rejects.toThrow([
            'crossbind: App Store Connect answered GET /apps with 403: A required agreement is missing or has expired.',
            "crossbind: the team's Account Holder accepts Apple's latest agreements in App Store Connect, under Business.",
        ].join('\n'));
    });
});

describe("a file's upload where App Store Connect reserved it", () => {
    test('goes part by part, each the range of bytes and with the headers its operation names, and asks again when busy', async () => {
        vi.useFakeTimers();
        const operations = [
            { method: 'PUT', url: 'https://upload.example.test/1', offset: 0, length: 3, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] },
            { method: 'PUT', url: 'https://upload.example.test/2', offset: 3, length: 2, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] },
        ];
        const answers = [new Response('', { status: 503 }), new Response('', { status: 200 }), new Response('', { status: 200 })];
        answer = () => answers.shift();
        const uploading = uploadParts(operations, Buffer.from('abcde'), '/demo/01.png');
        await vi.advanceTimersByTimeAsync(10_000);
        await uploading;
        expect(requests.map(({ url, init }) => [init.method, url, init.headers, String(init.body)])).toEqual([
            ['PUT', 'https://upload.example.test/1', { 'Content-Type': 'image/png' }, 'abc'],
            ['PUT', 'https://upload.example.test/1', { 'Content-Type': 'image/png' }, 'abc'],
            ['PUT', 'https://upload.example.test/2', { 'Content-Type': 'image/png' }, 'de'],
        ]);
        expect(requests[0].init.headers.authorization).toBeUndefined();
        vi.useRealTimers();
    });

    test('names the file whose part the storage refuses', async () => {
        answer = () => new Response('', { status: 403 });
        await expect(uploadParts([{ method: 'PUT', url: 'https://upload.example.test/1', offset: 0, length: 1 }], Buffer.from('a'), '/demo/01.png'))
            .rejects.toThrow("crossbind: App Store Connect's storage answered the upload of /demo/01.png with 403.");
    });
});
