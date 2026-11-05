import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// gcloud prints the token of the account signed in to it, unless `gcloud.fails` says why it cannot.
const gcloud = { fails: null };
const spawnSync = vi.fn(() => (gcloud.fails ?? { status: 0, stdout: 'user-token\n', stderr: '' }));
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));
// The system keychain, which keeps each secret by its service and key.
const keychain = new Map();
vi.mock('../src/utils/keychain.js', () => ({
    readSecret: (key, { service }) => keychain.get(`${service}: ${key}`) ?? null,
    storeSecret: (key, secret, { service }) => Boolean(keychain.set(`${service}: ${key}`, secret)),
}));

const {
    PLAY, highestVersionCode, keepSignIn, keptSignIn, playCredentials, playToken, uploadBundle,
} = await import('../src/actions/googlePlay.js');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ACCOUNT = 'play@demo.iam.gserviceaccount.com';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status, message) => json(status, { error: { code: status, message } });

let dir;
let home;
let keyFile;
let requests;
// Google Play as an app's edit sees it: its answers by method and path, else the default ones below.
let answers;

function play(url, init = {}) {
    const { hostname, pathname, search } = new URL(url);
    const route = `${init.method} ${hostname === 'androidpublisher.googleapis.com' ? pathname.replace(/^.*\/applications\/[^/]+/, '') : hostname}${search}`;
    requests.push({ route, init });
    if (answers[route]) return answers[route](init);
    if (route === 'POST oauth2.example.test') return json(200, { access_token: 'key-token' });
    if (route === 'POST oauth2.googleapis.com') return json(200, { access_token: 'signed-in-token' });
    if (route === 'POST iamcredentials.googleapis.com') return json(200, { accessToken: 'account-token' });
    if (route === 'POST /edits') return json(200, { id: 'E1' });
    if (route === 'GET /edits/E1/tracks') return json(200, { tracks: [{ track: 'internal', releases: [{ status: 'completed', versionCodes: ['1000004'] }] }, { track: 'production' }] });
    if (route === 'GET /edits/E1/bundles') return json(200, { bundles: [{ versionCode: 1000002 }, { versionCode: 1000006 }] });
    if (route === 'GET /edits/E1/apks') return json(200, {});
    if (route === 'POST /edits/E1/bundles?uploadType=media') return json(200, { versionCode: 1000007 });
    if (/^PUT \/edits\/E1\/(tracks|listings)\/[\w:-]+$/.test(route)) return json(200, JSON.parse(init.body));
    if (route === 'GET /edits/E1/listings') return json(200, { listings: [{ language: 'en-US', title: 'Demo', shortDescription: 'A demo', fullDescription: 'The demo app.' }] });
    if (/^(GET|DELETE) \/edits\/E1\/listings\/[\w-]+\/\w+$/.test(route)) return json(200, {});
    if (/^POST \/edits\/E1\/listings\/[\w-]+\/\w+\?uploadType=media$/.test(route)) return json(200, { image: { id: 'I1' } });
    if (route === 'POST /edits/E1:commit') return json(200, { id: 'E1' });
    if (route === 'DELETE /edits/E1') return new Response(null, { status: 204 });
    return failure(500, `unanswered ${route}`);
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-play-'));
    keyFile = path.join(dir, 'play.json');
    fs.writeFileSync(keyFile, JSON.stringify({
        type: 'service_account', client_email: ACCOUNT, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.example.test/token',
    }));
    requests = [];
    answers = {};
    gcloud.fails = null;
    keychain.clear();
    home = vi.spyOn(os, 'homedir').mockReturnValue(dir);
    vi.stubGlobal('fetch', vi.fn(async (url, init) => play(url, init)));
});

afterEach(() => {
    vi.unstubAllGlobals();
    home.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("Google Play's credentials", () => {
    test("are a service account's JSON key, or its e-mail for the user's gcloud login, from the environment or this machine", () => {
        expect(playCredentials({}, {})).toBeNull();
        expect(playCredentials({ [PLAY.key]: keyFile }, {})).toMatchObject({ account: ACCOUNT, file: keyFile });
        expect(playCredentials({}, { GOOGLE_PLAY_KEY: keyFile })).toMatchObject({ account: ACCOUNT });
        expect(playCredentials({ [PLAY.serviceAccount]: ACCOUNT }, {})).toEqual({ account: ACCOUNT });
        expect(playCredentials({}, { GOOGLE_PLAY_SERVICE_ACCOUNT: ACCOUNT })).toEqual({ account: ACCOUNT });
    });

    test('are one of the two, and a key with what a service account key has', () => {
        expect(() => playCredentials({ [PLAY.key]: keyFile, [PLAY.serviceAccount]: ACCOUNT }, {}))
            .toThrow(`both ${PLAY.key} and ${PLAY.serviceAccount} are set`);
        fs.writeFileSync(keyFile, JSON.stringify({ client_email: ACCOUNT }));
        expect(() => playCredentials({ [PLAY.key]: keyFile }, {})).toThrow(`${keyFile} (${PLAY.key}) has no private_key, token_uri, so it is no service account key`);
        expect(() => playCredentials({ [PLAY.key]: path.join(dir, 'none.json') }, {})).toThrow(`${PLAY.key} names ${path.join(dir, 'none.json')}, which is no file`);
    });

    test("are a JSON key's text in the environment, as CI gives a secret, which no failure repeats", () => {
        expect(playCredentials({ [PLAY.key]: fs.readFileSync(keyFile, 'utf8') }, {})).toMatchObject({ account: ACCOUNT, file: null });
        const broken = () => playCredentials({ [PLAY.key]: '{ "private_key": "secret-material", ' }, {});
        expect(broken).toThrow(`crossbind: ${PLAY.key} holds no JSON, so it is no service account key.`);
        expect(broken).not.toThrow('secret-material');
        expect(() => playCredentials({ [PLAY.key]: '{ "private_key": "secret-material" }' }, {}))
            .toThrow(`crossbind: ${PLAY.key} has no client_email, token_uri, so it is no service account key.`);
    });

    test('are an access token from the environment alone, as CI makes one with no key, and never with another kind', () => {
        expect(playCredentials({ [PLAY.token]: 'ci-token' }, {})).toEqual({ token: 'ci-token' });
        expect(playCredentials({}, { GOOGLE_PLAY_TOKEN: 'ci-token' })).toBeNull();
        expect(() => playCredentials({ [PLAY.token]: 'ci-token' }, { GOOGLE_PLAY_SERVICE_ACCOUNT: ACCOUNT }))
            .toThrow(`${PLAY.token} is set, and so is ${PLAY.serviceAccount} or its key in ~/.crossbind.json: set one.`);
        expect(() => playCredentials({ [PLAY.token]: 'ci-token', [PLAY.key]: keyFile }, {})).toThrow(`and so is ${PLAY.key}`);
    });

    test('are, with neither set, the Google sign-in this machine keeps while Google takes it', async () => {
        expect(await keptSignIn()).toBeNull();
        expect(keepSignIn('refresh')).toBe(true);
        expect([...keychain.keys()]).toEqual([`crossbind google play: ${path.join(dir, '.crossbind', 'google-play')}`]);
        expect(fs.statSync(path.join(dir, '.crossbind')).isDirectory()).toBe(true);
        expect(await keptSignIn()).toEqual({ refreshToken: 'refresh' });

        const said = vi.spyOn(console, 'log').mockImplementation(() => {});
        answers['POST oauth2.googleapis.com'] = () => json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        expect(await keptSignIn()).toBeNull();
        expect(said).toHaveBeenCalledWith('crossbind: Google no longer takes the sign-in this machine keeps for Google Play, as when it was revoked.');
        said.mockRestore();
    });
});

describe("Google Play's token", () => {
    test('of a key is a JWT signed RS256 for one hour with the androidpublisher scope', async () => {
        expect(await playToken(playCredentials({ [PLAY.key]: keyFile }, {}))).toBe('key-token');
        const assertion = new URLSearchParams(String(requests[0].init.body)).get('assertion');
        const [header, claims, signature] = assertion.split('.');
        expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
        const { iss, scope, aud, iat, exp } = JSON.parse(Buffer.from(claims, 'base64url'));
        expect({ iss, scope, aud, life: exp - iat }).toEqual({
            iss: ACCOUNT, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.example.test/token', life: 3600,
        });
    });

    test("of an e-mail is bought with the user's gcloud token, and no key exists", async () => {
        expect(await playToken({ account: ACCOUNT })).toBe('account-token');
        expect(spawnSync).toHaveBeenCalledWith('gcloud', ['auth', 'print-access-token'], expect.objectContaining({ encoding: 'utf8' }));
        const { route, init } = requests[0];
        expect(route).toBe('POST iamcredentials.googleapis.com');
        expect(init.headers.authorization).toBe('Bearer user-token');
        expect(JSON.parse(init.body)).toEqual({ scope: ['https://www.googleapis.com/auth/androidpublisher'] });
    });

    test('of an access token from the environment is the token itself', async () => {
        expect(await playToken({ token: 'ci-token' })).toBe('ci-token');
        expect(requests).toEqual([]);
    });

    test('of a Google sign-in is bought with its refresh token', async () => {
        expect(await playToken({ refreshToken: 'refresh' })).toBe('signed-in-token');
        const grant = new URLSearchParams(String(requests[0].init.body));
        expect([requests[0].route, grant.get('grant_type'), grant.get('refresh_token')]).toEqual(['POST oauth2.googleapis.com', 'refresh_token', 'refresh']);
    });

    test('names the fix when it is refused', async () => {
        answers['POST oauth2.example.test'] = () => json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
        await expect(playToken(playCredentials({ [PLAY.key]: keyFile }, {}))).rejects.toThrow(`Google refused the token of ${ACCOUNT}: 400 invalid_grant Invalid JWT Signature.`);
        gcloud.fails = { status: 1, stdout: '', stderr: 'ERROR: (gcloud.auth.print-access-token) You do not currently have an active account selected.' };
        await expect(playToken({ account: ACCOUNT })).rejects.toThrow('gcloud gave no token of yours: sign in with gcloud auth login');
        gcloud.fails = null;
        answers['POST iamcredentials.googleapis.com'] = () => failure(403, "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).");
        await expect(playToken({ account: ACCOUNT })).rejects.toThrow('your gcloud account needs the Service Account Token Creator role on it, and its project the IAM Service Account Credentials API');
    });
});

describe("an app's edit on Google Play", () => {
    const credentials = () => playCredentials({ [PLAY.key]: keyFile }, {});

    test('gives the highest versionCode Play has seen, in bundles, APKs and releases alike, and is deleted', async () => {
        expect(await highestVersionCode('dev.example.app', credentials())).toBe(1000006);
        expect(requests.map(({ route }) => route).slice(1)).toEqual([
            'POST /edits', 'GET /edits/E1/tracks', 'GET /edits/E1/bundles', 'GET /edits/E1/apks', 'DELETE /edits/E1',
        ]);
        answers['GET /edits/E1/bundles'] = () => json(200, {});
        answers['GET /edits/E1/tracks'] = () => json(200, { tracks: [{ track: 'internal' }] });
        expect(await highestVersionCode('dev.example.app', credentials())).toBe(0);
    });

    test('says what to do for an app Play Console lacks, or an account without release rights', async () => {
        answers['POST /edits'] = () => failure(404, 'Package not found: dev.example.app.');
        await expect(highestVersionCode('dev.example.app', credentials())).rejects.toMatchObject({
            status: 404, message: expect.stringContaining('Play Console has no app dev.example.app: create it there, with dev.example.app as its package name'),
        });
        answers['POST /edits'] = () => failure(403, 'The caller does not have permission');
        await expect(highestVersionCode('dev.example.app', credentials())).rejects.toMatchObject({
            status: 403, message: expect.stringContaining(`${ACCOUNT} has no release rights for dev.example.app: invite it in Play Console`),
        });
        await expect(highestVersionCode('dev.example.app', { refreshToken: 'refresh' })).rejects.toMatchObject({
            status: 403,
            message: expect.stringContaining('the Google account you signed in with has no release rights for dev.example.app: sign in with one that has, or have it invited in Play Console'),
        });
    });

    test('says what an access token from the environment lacks: life, the scope or release rights', async () => {
        const token = { token: 'ci-token' };
        answers['POST /edits'] = () => failure(401, 'Request had invalid authentication credentials.');
        await expect(highestVersionCode('dev.example.app', token)).rejects.toThrow(`Google Play takes ${PLAY.token} no more: it has expired`);
        answers['POST /edits'] = () => failure(403, 'Request had insufficient authentication scopes.');
        await expect(highestVersionCode('dev.example.app', token))
            .rejects.toThrow(`${PLAY.token} lacks the scope https://www.googleapis.com/auth/androidpublisher, which Google Play's API takes`);
        answers['POST /edits'] = () => failure(403, 'The caller does not have permission');
        await expect(highestVersionCode('dev.example.app', token))
            .rejects.toThrow(`the account behind ${PLAY.token} has no release rights for dev.example.app: invite it in Play Console`);
        const request = requests.find(({ route }) => route === 'POST /edits');
        expect(request.init.headers.authorization).toBe('Bearer ci-token');
    });

    test("uploads a bundle and releases it on a track, the bundle's bytes as they are", async () => {
        const aab = path.join(dir, 'app.aab');
        fs.writeFileSync(aab, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff]));
        expect(await uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed' })).toEqual({ versionCode: 1000007, status: 'completed', listed: [] });
        const upload = requests.find(({ route }) => route === 'POST /edits/E1/bundles?uploadType=media');
        expect(upload.init.headers['content-type']).toBe('application/octet-stream');
        expect(Buffer.compare(upload.init.body, fs.readFileSync(aab))).toBe(0);
        const release = requests.find(({ route }) => route === 'PUT /edits/E1/tracks/internal');
        expect(JSON.parse(release.init.body)).toEqual({ track: 'internal', releases: [{ versionCodes: ['1000007'], status: 'completed' }] });
        expect(requests.at(-1).route).toBe('POST /edits/E1:commit');
    });

    test('of an app never released makes the release a draft, which Play Console rolls out once', async () => {
        const aab = path.join(dir, 'app.aab');
        fs.writeFileSync(aab, 'bundle');
        let commits = 0;
        answers['POST /edits/E1:commit'] = () => (++commits === 1
            ? failure(400, 'Only releases with status draft may be created on draft app.')
            : json(200, { id: 'E1' }));
        expect(await uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed' })).toEqual({ versionCode: 1000007, status: 'draft', listed: [] });
        const releases = requests.filter(({ route }) => route === 'PUT /edits/E1/tracks/internal').map(({ init }) => JSON.parse(init.body).releases[0].status);
        expect(releases).toEqual(['completed', 'draft']);
    });

    test('is deleted when a step fails, and the failure is the one reported', async () => {
        const aab = path.join(dir, 'app.aab');
        fs.writeFileSync(aab, 'bundle');
        answers['POST /edits/E1/bundles?uploadType=media'] = () => failure(400, 'APK specifies a version code that has already been used.');
        await expect(uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed' }))
            .rejects.toThrow('Google Play answered POST /edits/E1/bundles with 400: APK specifies a version code that has already been used.');
        expect(requests.at(-1).route).toBe('DELETE /edits/E1');
    });
});

describe("an app's native debug symbols on Google Play", () => {
    test('go up with its bundle, as the nativeCode file of its versionCode, in the same edit', async () => {
        const aab = path.join(dir, 'app.aab');
        const symbols = path.join(dir, 'symbols.zip');
        fs.writeFileSync(aab, 'bundle');
        fs.writeFileSync(symbols, Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        answers['POST /edits/E1/apks/1000007/deobfuscationFiles/nativeCode?uploadType=media'] = () => json(200, { deobfuscationFile: { symbolType: 'nativeCode' } });
        await uploadBundle('dev.example.app', playCredentials({ [PLAY.key]: keyFile }, {}), { aab, symbols, track: 'internal', status: 'completed' });
        const routes = requests.map(({ route }) => route);
        const upload = routes.indexOf('POST /edits/E1/apks/1000007/deobfuscationFiles/nativeCode?uploadType=media');
        expect(upload).toBeGreaterThan(routes.indexOf('POST /edits/E1/bundles?uploadType=media'));
        expect(upload).toBeLessThan(routes.indexOf('POST /edits/E1:commit'));
        expect(Buffer.compare(requests[upload].init.body, fs.readFileSync(symbols))).toBe(0);
    });
});

describe("a release's rollout, notes and listing on Google Play", () => {
    const credentials = () => playCredentials({ [PLAY.key]: keyFile }, {});
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const file = (name, bytes) => {
        fs.writeFileSync(path.join(dir, name), bytes);
        return path.join(dir, name);
    };
    const releasesOf = (track) => requests.filter(({ route }) => route === `PUT /edits/E1/tracks/${track}`).map(({ init }) => JSON.parse(init.body).releases[0]);
    const bodyOf = (route) => requests.find((request) => request.route === route).init.body;
    const turkish = { title: 'Deneme', shortDescription: 'Bir deneme', fullDescription: 'Deneme uygulaması.' };
    let aab;

    beforeEach(() => {
        aab = file('app.aab', 'bundle');
        answers['GET /edits/E1/listings/en-US/phoneScreenshots'] = () => json(200, { images: [{ id: 'A', sha256: hash('first') }, { id: 'B', sha256: hash('second') }] });
    });

    test('rolls a release out to the share of users userFraction gives, which a draft never takes', async () => {
        await uploadBundle('dev.example.app', credentials(), { aab, track: 'production', status: 'inProgress', userFraction: 0.1 });
        expect(releasesOf('production')).toEqual([{ versionCodes: ['1000007'], status: 'inProgress', userFraction: 0.1 }]);

        requests = [];
        let commits = 0;
        answers['POST /edits/E1:commit'] = () => (++commits === 1 ? failure(400, 'Only releases with status draft may be created on draft app.') : json(200, { id: 'E1' }));
        expect((await uploadBundle('dev.example.app', credentials(), { aab, track: 'production', status: 'inProgress', userFraction: 0.1 })).status).toBe('draft');
        expect(releasesOf('production').map(({ status, userFraction }) => [status, userFraction])).toEqual([['inProgress', 0.1], ['draft', undefined]]);
    });

    test('gives a release the notes of each language that has some, for its versionCode or else the default ones', async () => {
        const listings = [
            { language: 'de-DE', texts: {}, notes: {}, images: {} },
            { language: 'en-US', texts: {}, notes: { default: 'Fixes.' }, images: {} },
            { language: 'tr-TR', texts: {}, notes: { 1000007: 'Bu sürüm için.', default: 'Düzeltmeler.' }, images: {} },
        ];
        await uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed', listings });
        expect(releasesOf('internal')[0].releaseNotes).toEqual([{ language: 'en-US', text: 'Fixes.' }, { language: 'tr-TR', text: 'Bu sürüm için.' }]);
        expect(requests.filter(({ route }) => route.includes('/listings'))).toEqual([]);
    });

    test("changes a language's texts and images where Play's differ, before the release, and leaves the rest as they are", async () => {
        const icon = file('icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const listings = [
            { language: 'en-US', texts: { title: 'Demo' }, notes: {}, images: { phoneScreenshots: [file('1.png', 'first'), file('2.png', 'second')] } },
            { language: 'tr-TR', texts: turkish, notes: {}, images: { icon: [icon] } },
        ];

        expect((await uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed', listings })).listed).toEqual(['tr-TR']);

        const routes = requests.map(({ route }) => route);
        expect(routes.filter((route) => route.includes('/listings'))).toEqual([
            'GET /edits/E1/listings',
            'GET /edits/E1/listings/en-US/phoneScreenshots',
            'PUT /edits/E1/listings/tr-TR',
            'GET /edits/E1/listings/tr-TR/icon',
            'DELETE /edits/E1/listings/tr-TR/icon',
            'POST /edits/E1/listings/tr-TR/icon?uploadType=media',
        ]);
        expect(routes.indexOf('POST /edits/E1/listings/tr-TR/icon?uploadType=media')).toBeLessThan(routes.indexOf('PUT /edits/E1/tracks/internal'));
        expect(JSON.parse(bodyOf('PUT /edits/E1/listings/tr-TR'))).toEqual({ language: 'tr-TR', ...turkish });
        const upload = requests.find(({ route }) => route === 'POST /edits/E1/listings/tr-TR/icon?uploadType=media');
        expect(upload.init.headers['content-type']).toBe('image/png');
        expect(Buffer.compare(upload.init.body, fs.readFileSync(icon))).toBe(0);
    });

    test("puts a listing back whole with the field that changed, and screenshots anew in the project's order", async () => {
        const listings = [{ language: 'en-US', texts: { fullDescription: 'The demo app, anew.' }, notes: {}, images: { phoneScreenshots: [file('b.jpg', 'second'), file('a.jpg', 'first')] } }];

        expect((await uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed', listings })).listed).toEqual(['en-US']);

        expect(JSON.parse(bodyOf('PUT /edits/E1/listings/en-US'))).toEqual({ language: 'en-US', title: 'Demo', shortDescription: 'A demo', fullDescription: 'The demo app, anew.' });
        const screenshots = requests.filter(({ route }) => route.startsWith('DELETE /edits/E1/listings/en-US/phoneScreenshots') || route === 'POST /edits/E1/listings/en-US/phoneScreenshots?uploadType=media');
        expect(screenshots.map(({ route, init }) => [route.split(' ')[0], init.headers['content-type'], init.body && String(init.body)])).toEqual([
            ['DELETE', 'application/json', undefined],
            ['POST', 'image/jpeg', 'second'],
            ['POST', 'image/jpeg', 'first'],
        ]);
    });

    test('names the rights a production release and a listing take, when Play refuses the account', async () => {
        answers['PUT /edits/E1/tracks/production'] = () => failure(403, 'The caller does not have permission');
        const listings = [{ language: 'en-US', texts: { title: 'Demo' }, notes: {}, images: {} }];
        await expect(uploadBundle('dev.example.app', credentials(), { aab, track: 'production', status: 'completed', listings })).rejects.toThrow(
            `${ACCOUNT} has no release rights for dev.example.app: invite it in Play Console, under Users and permissions, with "Release to production, exclude devices, and use Play App Signing" and "Manage store presence" for the app.`,
        );
        expect(requests.at(-1).route).toBe('DELETE /edits/E1');
    });

    test('makes a listing in a language Play has none in only of a title, a short and a full description', async () => {
        const listings = [{ language: 'tr-TR', texts: { title: 'Deneme' }, notes: {}, images: { icon: [file('icon.png', 'icon')] } }];
        await expect(uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed', listings })).rejects.toThrow(
            `crossbind: Google Play has no listing in tr-TR yet, which it makes of a title, a short and a full description: add short_description.txt, full_description.txt to ${path.join('store', 'google-play', 'tr-TR')}.`,
        );
        expect(requests.filter(({ route }) => route.includes('/listings/tr-TR'))).toEqual([]);
        expect(requests.at(-1).route).toBe('DELETE /edits/E1');
    });

    test('names the image Play refuses', async () => {
        const shot = file('3.png', 'third');
        answers['POST /edits/E1/listings/en-US/phoneScreenshots?uploadType=media'] = () => failure(400, 'Image is too small.');
        const listings = [{ language: 'en-US', texts: {}, notes: {}, images: { phoneScreenshots: [shot] } }];
        await expect(uploadBundle('dev.example.app', credentials(), { aab, track: 'internal', status: 'completed', listings })).rejects.toMatchObject({
            status: 400,
            message: `crossbind: Google Play answered POST /edits/E1/listings/en-US/phoneScreenshots with 400: Image is too small.\ncrossbind: it answered so for ${shot}.`,
        });
    });
});
