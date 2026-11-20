// A preview launch of the conformance app, which e2e/preview.mjs makes: the page opens the crossbind app preview whose
// open: line the run serves, as the preview extension will open one. It asks the session with a challenge of its own and
// checks, in order, the protocol's range, the proof made with the line's key, then the session; each way that stops is
// tried before the one that opens, and none serves the origin, which the one that opens serves with the gate's token in
// its proxy, for the window to show. The previewed page's own lines go to the preview's terminal.
import { invoke } from 'crossbind/app';
import { REACH_PORT } from '../e2e/launch.mjs';

const ENDPOINT = import.meta.env.VITE_E2E_ENDPOINT || `http://127.0.0.1:${REACH_PORT}`;
const ORIGIN = 'e2e-preview';
// The protocols this app takes.
const PROTOCOLS = [1, 1];
const KEY_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

const toBase64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
// The bytes of base64url in the one form that decodes to them, or null.
function fromBase64url(text) {
    if (typeof text !== 'string' || !BASE64URL.test(text) || text.length % 4 === 1) return null;
    const bytes = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
    return toBase64url(bytes) === text ? bytes : null;
}
const hmacKey = (bytes, usage) => crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
const encoded = (text) => new TextEncoder().encode(text);

async function sessionAnswer(source, challenge, [least, most]) {
    const { host } = new URL(source);
    const asked = await invoke('probe.fetch', { url: `${source}/__crossbind/session?challenge=${challenge}&protocols=${least}-${most}` });
    if (asked.failure) throw new Error(`crossbind cannot reach ${host}: ${asked.failure}. Is crossbind app preview running there, and is this device on its network?`);
    let answer = null;
    try {
        answer = JSON.parse(asked.text ?? '');
    } catch {
        // No JSON is no session.
    }
    if (asked.status !== 200 || !Number.isInteger(answer?.protocol)) throw new Error(`${host} is no crossbind preview: run crossbind app preview in the project`);
    return answer;
}

// What the session says once its protocol is one this app takes and its proof holds, else why not, as the opener tells
// its user; a field of the session is read once the proof holds alone.
async function checkSession(source, keyText, range) {
    const { host } = new URL(source);
    const key = fromBase64url(keyText);
    if (key?.length !== KEY_BYTES) throw new Error("the code's key is no 32 bytes of base64url: scan the code crossbind app preview prints again");
    const challenge = toBase64url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
    const answer = await sessionAnswer(source, challenge, range);
    const proof = fromBase64url(answer.proof);
    const holds = proof !== null && typeof answer.session === 'string'
        && await crypto.subtle.verify('HMAC', await hmacKey(key, 'verify'), proof, encoded(`crossbind-session.${answer.protocol}.${challenge}.${answer.session}`));
    const sent = holds ? fromBase64url(answer.session) : null;
    const session = sent ? JSON.parse(new TextDecoder().decode(sent)) : null;
    const [least, most] = range;
    if (answer.protocol < least) {
        throw new Error(`this project's crossbind is older than this app takes (protocol ${answer.protocol}, from ${least}): update crossbind in the project${session?.update ? `: ${session.update}` : ''}`);
    }
    if (answer.protocol > most) throw new Error(`this project's crossbind is newer than this app (protocol ${answer.protocol}, up to ${most}): update the crossbind app`);
    if (!holds) throw new Error(`the server at ${host} could not prove it is the preview you scanned: scan the code crossbind app preview prints again`);
    if (!session) throw new Error(`the server at ${host} sent a session that is no base64url: scan the code crossbind app preview prints again`);
    return session;
}

// The session's origin, served once its check holds, whose proxy sends the gate's token.
async function open(source, keyText, range) {
    const session = await checkSession(source, keyText, range);
    const signer = await hmacKey(fromBase64url(keyText), 'sign');
    const previewToken = toBase64url(new Uint8Array(await crypto.subtle.sign('HMAC', signer, encoded('crossbind-requests'))));
    return { session, url: await invoke('probe.serveOrigin', { name: ORIGIN, source, previewToken }) };
}

// False where the run opens no preview; else the window goes to the preview's page, or the page says why not.
export async function runPreview() {
    const asked = await invoke('probe.fetch', { url: `${ENDPOINT}/preview` });
    if (asked.status !== 200) return false;
    try {
        const line = new URL(asked.text.trim());
        const keyText = new URLSearchParams(line.hash.slice(1)).get('k');
        const tries = { 'wrong key': ['A'.repeat(43), PROTOCOLS], 'protocol below': [keyText, [2, 3]], 'protocol above': [keyText, [0, 0]] };
        const stops = {};
        for (const [what, [key, range]] of Object.entries(tries)) {
            stops[what] = await open(line.origin, key, range).then(() => 'opened', (error) => error.message);
        }
        console.log(`PAGE GETS preview-stops ${JSON.stringify(stops)}`);
        // The origin is not served yet, as none of the tries served it: it is served now, once.
        const { session, url } = await open(line.origin, keyText, PROTOCOLS);
        console.log(`PAGE GETS preview-open ${JSON.stringify({ session, url })}`);
        location.href = url;
    } catch (error) {
        console.error(`CONFORMANCE ERR: the preview did not open: ${error?.message ?? error}`);
    }
    return true;
}
