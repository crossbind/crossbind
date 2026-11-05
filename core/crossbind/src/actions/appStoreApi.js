import fs from 'node:fs';
import { createSign } from 'node:crypto';
import { APPLE_SIGNING } from './appleSigning.js';

const API = 'https://api.appstoreconnect.apple.com/v1';
// A token's life, well under the 20 minutes App Store Connect takes at most, so a clock somewhat ahead of Apple's passes.
const TOKEN_SECONDS = 600;
// How often a call that does the same when made twice, as a GET or PATCH does, tries again on an answer App Store
// Connect gives when busy or down, and how long it waits first where Apple's answer names no time.
const RETRIES = 3;
const RETRY_SECONDS = 10;
const isTransient = (status) => status === 429 || status >= 500;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sleep = (seconds) => new Promise((resolve) => { setTimeout(resolve, seconds * 1000); });

// A token of an App Store Connect API key: a JWT signed ES256, with the signature's two numbers side by side, as JWTs
// take them.
export function appStoreToken({ key, keyId, issuer }, now = Date.now()) {
    const iat = Math.floor(now / 1000);
    const unsigned = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({ iss: issuer, iat, exp: iat + TOKEN_SECONDS, aud: 'appstoreconnect-v1' })}`;
    const signature = createSign('SHA256').update(unsigned).sign({ key: fs.readFileSync(key, 'utf8'), dsaEncoding: 'ieee-p1363' });
    return `${unsigned}.${signature.toString('base64url')}`;
}

// What Apple said of a refused call, with the reasons it gives field by field.
const saidIn = (errors) => errors.flatMap(({ detail, title, meta }) => [
    detail ?? title, ...Object.values(meta?.associatedErrors ?? {}).flat().map((associated) => associated.detail ?? associated.title),
]).filter(Boolean).join(' ');

function apiError(status, method, route, body, { keyId }) {
    const errors = body?.errors ?? [];
    const said = saidIn(errors);
    let text = `crossbind: App Store Connect answered ${method} ${route} with ${status}${said ? `: ${said}` : '.'}`;
    if (status === 401) {
        text = `crossbind: App Store Connect refused the API key ${keyId}${said ? ` (${said})` : ''}: ${APPLE_SIGNING.key} is not that key's .p8, ${APPLE_SIGNING.keyId} or ${APPLE_SIGNING.issuer} is not its own, it was revoked, or this machine's clock is off.`;
    } else if (status === 403 && errors.some(({ code }) => /AGREEMENT/i.test(code ?? ''))) {
        text += "\ncrossbind: the team's Account Holder accepts Apple's latest agreements in App Store Connect, under Business.";
    } else if (status === 403) {
        text += `\ncrossbind: the API key ${keyId} takes the App Manager or Admin role for that, which App Store Connect gives under Users and Access › Integrations.`;
    }
    return Object.assign(new Error(text), { status, errors });
}

// The answer to a request, which `init` makes anew at each try. One that leaves the same when made twice, as a GET does,
// tries again when App Store Connect is busy or out of reach for a moment; one that would not, as a POST, tries again
// only where App Store Connect said it was too busy to take it. `what` names the request, and `where` its host, where it
// never reached that.
async function answerTo(url, init, isRepeatable, { what, where = 'App Store Connect' }) {
    for (let attempt = 0; ; attempt += 1) {
        let response;
        try {
            response = await fetch(url, init());
        } catch (error) {
            if (!isRepeatable || attempt >= RETRIES) throw new Error(`crossbind: ${where} was out of reach for ${what}: ${error.cause?.message ?? error.message}`, { cause: error });
            await sleep(RETRY_SECONDS);
            continue;
        }
        const isRetried = isRepeatable ? isTransient(response.status) : response.status === 429;
        if (attempt >= RETRIES || !isRetried) return response;
        await sleep(Number(response.headers.get('retry-after')) || RETRY_SECONDS);
    }
}

// A caller of App Store Connect's API with an API key, which signs a token for each try, as a publish outlasts one.
export function appStoreCaller(key) {
    return async (method, route, body) => {
        const path = route.split('?')[0];
        const response = await answerTo(`${API}${route}`, () => ({
            method,
            headers: { authorization: `Bearer ${appStoreToken(key)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        }), method !== 'POST', { what: `${method} ${path}` });
        const text = await response.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            if (response.ok) throw new Error(`crossbind: App Store Connect answered ${method} ${path} with no JSON, as a proxy between might: ${text.slice(0, 200)}`);
        }
        if (response.ok) return json;
        throw apiError(response.status, method, path, json, key);
    };
}

// Uploads a file's bytes where App Store Connect reserved them, part by part as its upload operations say.
export async function uploadParts(operations, bytes, file) {
    for (const {
        method, url, offset, length, requestHeaders = [],
    } of operations) {
        const headers = Object.fromEntries(requestHeaders.map(({ name, value }) => [name, value]));
        const response = await answerTo(url, () => ({ method, headers, body: bytes.subarray(offset, offset + length) }), true, { what: `the upload of ${file}`, where: "App Store Connect's storage" });
        if (!response.ok) throw new Error(`crossbind: App Store Connect's storage answered the upload of ${file} with ${response.status}.`);
    }
}
