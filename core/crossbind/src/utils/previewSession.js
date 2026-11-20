import crypto from 'node:crypto';
import path from 'node:path';

// What the crossbind app and crossbind app preview read of each other: the session, the gate's header, the socket's
// rule and the exports of the page API the app answers at PAGE_API_PATH. It rises for a change that breaks one of them,
// not for one that adds, which the module of the project's side covers (previewModule.js).
export const PREVIEW_PROTOCOL = 1;
export const SESSION_PATH = '/__crossbind/session';
export const PAGE_API_PATH = '/__crossbind/app.js';
// The header the device's proxy adds to every request, as Node names it.
export const GATE_HEADER = 'x-crossbind-preview';
const KEY_BYTES = 32;
// 32 bytes in base64url without padding.
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
// A range of protocols an app takes, as it asks for a session: least-most.
const PROTOCOLS = /^(\d{1,6})-(\d{1,6})$/;

export const newPreviewKey = () => crypto.randomBytes(KEY_BYTES).toString('base64url');

// 32 bytes in base64url in the one form that decodes to them, so no other text stands for the same bytes: a key and a
// challenge.
export const isBase64url32 = (text) => typeof text === 'string' && BASE64URL_32.test(text)
    && Buffer.from(text, 'base64url').toString('base64url') === text;

const hmac = (key, text) => crypto.createHmac('sha256', Buffer.from(key, 'base64url')).update(text).digest('base64url');

// What the proxy sends as GATE_HEADER: made from the key, which itself never travels.
export const gateToken = (key) => hmac(key, 'crossbind-requests');

// Whether a secret given equals the one expected, in a time that tells nothing of where they differ.
export function isSameSecret(given, expected) {
    if (typeof given !== 'string' || typeof expected !== 'string') return false;
    const [a, b] = [Buffer.from(given), Buffer.from(expected)];
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// What the proof signs: the protocol, the challenge and the session as sent, which neither may hold a dot of its own.
export const provenText = (protocol, challenge, session) => `crossbind-session.${protocol}.${challenge}.${session}`;

// The answer to GET SESSION_PATH: 400 for a challenge of any other form than 32 bytes of the device's, else the
// protocol, the session's JSON in base64url, and the proof of the key over both and the challenge.
export function answerSession(key, challenge, session) {
    if (!isBase64url32(challenge)) {
        return { status: 400, text: 'crossbind: a session check takes a challenge of 32 bytes in base64url, 43 characters' };
    }
    const sent = Buffer.from(JSON.stringify(session)).toString('base64url');
    return { status: 200, json: { protocol: PREVIEW_PROTOCOL, session: sent, proof: hmac(key, provenText(PREVIEW_PROTOCOL, challenge, sent)) } };
}

// What the terminal says of an app that asked for a session with a range of protocols this preview is outside of.
export function protocolsLine(protocols, update) {
    const range = PROTOCOLS.exec(protocols ?? '');
    if (!range) return null;
    const [least, most] = [Number(range[1]), Number(range[2])];
    const asked = `crossbind: a crossbind app that takes protocols ${least}–${most} asked for this preview, which speaks ${PREVIEW_PROTOCOL}`;
    if (PREVIEW_PROTOCOL < least) return `${asked}: update crossbind in the project (${update})`;
    if (PREVIEW_PROTOCOL > most) return `${asked}: update the crossbind app on the device`;
    return null;
}

// A request's target read as a URL's path and query, or null where no URL reads it, as http://[/ is none.
const targetOf = (url) => URL.parse(url, 'http://preview');

// The path Vite's own socket takes, as Vite joins it from its base and server.ws.path.
const socketPathOf = ({ base, server }) => (server.ws?.path ? path.posix.join(base, server.ws.path) : base);

// Whether a socket opens: Vite's ping on Vite's own socket path, where it closes at once and carries nothing, or one with
// Vite's token, which only a page that came through the gate holds, with an Origin or without one.
export function isSocketAllowed(protocol, url, webSocketToken, socketPath) {
    const target = targetOf(url);
    if (!target) return false;
    if (protocol === 'vite-ping' && target.pathname === socketPath) return true;
    return isSameSecret(target.searchParams.get('token'), webSocketToken);
}

function send(res, status, type, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
}

// What a preview's dev server answers before anything of Vite's or of its plugins': the session to anyone, 400 to a
// target no URL reads, 403 to any other request without the gate's token, and the rest on. Each range of protocols an app
// asked for is named once.
export function previewGate(preview, logger) {
    const token = gateToken(preview.key);
    const named = new Set();
    return (req, res, next) => {
        const url = targetOf(req.url);
        if (!url) {
            send(res, 400, 'text/plain; charset=utf-8', "crossbind: a request's target is the path of a URL");
            return;
        }
        if (url.pathname === SESSION_PATH) {
            const line = protocolsLine(url.searchParams.get('protocols'), preview.update);
            if (line && !named.has(line)) {
                named.add(line);
                logger.warn(line);
            }
            const answer = answerSession(preview.key, url.searchParams.get('challenge'), preview.session);
            if (answer.json) send(res, answer.status, 'application/json', JSON.stringify(answer.json));
            else send(res, answer.status, 'text/plain; charset=utf-8', answer.text);
            return;
        }
        if (!isSameSecret(req.headers[GATE_HEADER], token)) {
            send(res, 403, 'text/plain; charset=utf-8', 'crossbind: this preview answers the device that opened it alone');
            return;
        }
        if (url.pathname === PAGE_API_PATH) {
            logger.warn(`crossbind: a page asked this dev server for ${PAGE_API_PATH}, which the crossbind app answers itself: update the crossbind app on the device`);
        }
        next();
    };
}

// The gate in front of the server's own handler, which holds every middleware of Vite's and of its plugins', whatever
// their order and whenever they are added, so that none answers a request the gate refuses.
export function guardServer(httpServer, gate) {
    const handlers = httpServer.listeners('request');
    httpServer.removeAllListeners('request');
    httpServer.on('request', (req, res) => gate(req, res, () => handlers.forEach((handler) => handler.call(httpServer, req, res))));
}

// The first listener of the server's upgrades: a socket that may not open goes before Vite sees it. configOf gives Vite's
// resolved config, its socket's token among it.
export function previewSocketGate(configOf, logger) {
    return (req, socket) => {
        const config = configOf();
        if (isSocketAllowed(req.headers['sec-websocket-protocol'], req.url, config.webSocketToken, socketPathOf(config))) return;
        logger.warn(`crossbind: refused a socket without the page's token from ${req.socket.remoteAddress}`);
        socket.destroy();
    };
}

// What crossbind app preview hands the dev server it starts, in CROSSBIND_APP_PREVIEW: the key, where it listens and
// the address and port a device reaches it at, and the session; null where it started none.
export function previewOf(env = process.env) {
    if (!env.CROSSBIND_APP_PREVIEW) return null;
    const preview = JSON.parse(env.CROSSBIND_APP_PREVIEW);
    if (!isBase64url32(preview?.key)) throw new Error('crossbind: CROSSBIND_APP_PREVIEW holds no key: crossbind app preview sets it.');
    return preview;
}
