import { describe, expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {
    GATE_HEADER, PREVIEW_PROTOCOL, answerSession, gateToken, guardServer, isBase64url32, isSameSecret, newPreviewKey, previewGate,
    previewOf, previewSocketGate, protocolsLine,
} from '../src/utils/previewSession.js';

const key = newPreviewKey();
const challenge = Buffer.alloc(32, 7).toString('base64url');
const session = { protocol: PREVIEW_PROTOCOL, project: { name: 'demo' }, crossbind: '2.0.0', update: 'pnpm up crossbind' };
const preview = { key, session, update: 'pnpm up crossbind' };

// What a device does with the answer: WebCrypto's verify over the parts as sent, with the key it scanned.
async function holds(answer, given = challenge, withKey = key) {
    const signer = await webcrypto.subtle.importKey('raw', Buffer.from(withKey, 'base64url'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(`crossbind-session.${answer.protocol}.${given}.${answer.session}`);
    return webcrypto.subtle.verify('HMAC', signer, Buffer.from(answer.proof, 'base64url'), signed);
}

function asked(url, headers = {}) {
    const res = {
        statusCode: 200, headers: {}, body: null, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(body) { this.body = body; },
    };
    const next = vi.fn();
    const logger = { warn: vi.fn() };
    previewGate(preview, logger)({ url, headers }, res, next);
    return { res, next, logger };
}

describe('the pairing key and the challenge', () => {
    test('a key is 32 random bytes in the one base64url form that decodes to them', () => {
        expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(Buffer.from(key, 'base64url')).toHaveLength(32);
        expect(newPreviewKey()).not.toBe(key);
        expect(isBase64url32(key)).toBe(true);
    });

    test('takes 43 characters of base64url alone, in the form that decodes to 32 bytes', () => {
        expect(isBase64url32(challenge)).toBe(true);
        for (const odd of [undefined, '', 'x', challenge.slice(1), `${challenge}A`, `${challenge.slice(0, 42)}.`, `${challenge.slice(0, 42)}=`,
            `${challenge.slice(0, 42)}+`, Buffer.alloc(32, 7).toString('base64'), `${'A'.repeat(42)}B`]) {
            expect(isBase64url32(odd)).toBe(false);
        }
    });
});

describe('the session and its proof', () => {
    test('answers a challenge with the protocol, the session and a proof the key makes over them, which WebCrypto verifies', async () => {
        const { status, json } = answerSession(key, challenge, session);
        expect(status).toBe(200);
        expect(json.protocol).toBe(1);
        expect(JSON.parse(Buffer.from(json.session, 'base64url').toString())).toEqual(session);
        expect(await holds(json)).toBe(true);
        expect(await holds(json, challenge, newPreviewKey())).toBe(false);
    });

    test('proves nothing to another challenge, so a recorded answer opens nothing', async () => {
        const other = Buffer.alloc(32, 8).toString('base64url');
        const { json } = answerSession(key, challenge, session);
        expect(await holds(json, other)).toBe(false);
        expect(answerSession(key, other, session).json.proof).not.toBe(json.proof);
    });

    test('refuses a challenge of another form with 400, so no dot can move a border of what the proof signs', () => {
        for (const odd of [null, '', 'x', `${challenge.slice(0, 42)}.`, `${challenge}.${challenge}`, `${'A'.repeat(42)}B`]) {
            expect(answerSession(key, odd, session)).toEqual({ status: 400, text: 'crossbind: a session check takes a challenge of 32 bytes in base64url, 43 characters' });
        }
    });

    test('names which side to update where an app asks for protocols this preview is outside of', () => {
        expect(protocolsLine('2-3', 'pnpm up crossbind')).toBe('crossbind: a crossbind app that takes protocols 2–3 asked for this preview, which speaks 1: update crossbind in the project (pnpm up crossbind)');
        expect(protocolsLine('0-0', 'pnpm up crossbind')).toBe('crossbind: a crossbind app that takes protocols 0–0 asked for this preview, which speaks 1: update the crossbind app on the device');
        expect(protocolsLine('1-1', 'pnpm up crossbind')).toBeNull();
        expect(protocolsLine('1-x', 'pnpm up crossbind')).toBeNull();
        expect(protocolsLine(null, 'pnpm up crossbind')).toBeNull();
    });
});

describe('the gate', () => {
    const token = gateToken(key);

    test("the proxy's token is an HMAC of the key, never the key", async () => {
        const signer = await webcrypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const made = Buffer.from(await webcrypto.subtle.sign('HMAC', signer, new TextEncoder().encode('crossbind-requests'))).toString('base64url');
        expect(token).toBe(made);
        expect(token).not.toBe(key);
    });

    test('compares secrets whole, whatever their length', () => {
        expect(isSameSecret(token, token)).toBe(true);
        expect(isSameSecret(`${token.slice(0, -1)}A`, token)).toBe(token.endsWith('A'));
        expect(isSameSecret(token.slice(1), token)).toBe(false);
        expect(isSameSecret(undefined, token)).toBe(false);
        expect(isSameSecret([token], token)).toBe(false);
    });

    test('answers the session to anyone, with no store, and a challenge of another form 400', () => {
        const open = asked(`/__crossbind/session?challenge=${challenge}&protocols=1-1`);
        expect(open.res.statusCode).toBe(200);
        expect(open.res.headers).toMatchObject({ 'content-type': 'application/json', 'cache-control': 'no-store' });
        expect(JSON.parse(open.res.body).protocol).toBe(1);
        expect(open.next).not.toHaveBeenCalled();
        expect(open.logger.warn).not.toHaveBeenCalled();
        expect(asked('/__crossbind/session?challenge=x').res.statusCode).toBe(400);
        expect(asked(`/__crossbind/session?challenge=${challenge}&protocols=2-3`).logger.warn).toHaveBeenCalledWith(expect.stringContaining('takes protocols 2–3'));
    });

    test("refuses every other request without the token, Vite's own paths among them, saying nothing of the project's", () => {
        for (const url of ['/', '/src/main.js', '/@fs/home/me/project/package.json', '/@vite/client', '/__open-in-editor?file=src/main.js', '/__crossbind/session/../@fs/x']) {
            for (const headers of [{}, { [GATE_HEADER]: 'nope' }, { [GATE_HEADER]: key }]) {
                const { res, next } = asked(url, headers);
                expect(res.statusCode).toBe(403);
                expect(res.body).toBe('crossbind: this preview answers the device that opened it alone');
                expect(next).not.toHaveBeenCalled();
            }
        }
    });

    test('names each range of protocols an app asked for once, however often it asks', () => {
        const logger = { warn: vi.fn() };
        const gate = previewGate(preview, logger);
        const res = () => ({ setHeader() {}, end() {} });
        for (const protocols of ['2-3', '2-3', '0-0', '2-3', '0-0', '1-1']) {
            gate({ url: `/__crossbind/session?challenge=${challenge}&protocols=${protocols}`, headers: {} }, res(), vi.fn());
        }
        expect(logger.warn.mock.calls.map(([line]) => line.match(/protocols (\S+) asked/)[1])).toEqual(['2–3', '0–0']);
    });

    test('answers 400 to a request whose target no URL reads, and passes nothing on', () => {
        const { res, next } = asked('http://[/');
        expect(res.statusCode).toBe(400);
        expect(next).not.toHaveBeenCalled();
    });

    test('passes a request with the token on to Vite, and names one for the page API the device answers itself', () => {
        const page = asked('/src/main.js', { [GATE_HEADER]: token });
        expect(page.next).toHaveBeenCalledOnce();
        expect(page.logger.warn).not.toHaveBeenCalled();
        const api = asked('/__crossbind/app.js', { [GATE_HEADER]: token });
        expect(api.next).toHaveBeenCalledOnce();
        expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining('a page asked this dev server for /__crossbind/app.js'));
    });
});

describe('the socket', () => {
    const viteToken = 'vite-token-1';
    // Vite's resolved config as the gate reads it: its token, its base and its socket's own options.
    function upgraded(url, protocol = 'vite-hmr', { base = '/', ws = {} } = {}) {
        const socket = { destroy: vi.fn() };
        const logger = { warn: vi.fn() };
        const config = { webSocketToken: viteToken, base, server: { ws } };
        previewSocketGate(() => config, logger)({ url, headers: { 'sec-websocket-protocol': protocol }, socket: { remoteAddress: '192.168.1.9' } }, socket);
        return { socket, logger };
    }

    test("opens with Vite's token alone, which only a page through the gate holds", () => {
        expect(upgraded(`/?token=${viteToken}`).socket.destroy).not.toHaveBeenCalled();
        for (const url of ['/', '/?token=', '/?token=vite-token-2']) {
            const { socket, logger } = upgraded(url);
            expect(socket.destroy).toHaveBeenCalledOnce();
            expect(logger.warn).toHaveBeenCalledWith("crossbind: refused a socket without the page's token from 192.168.1.9");
        }
    });

    test("lets Vite's ping through on Vite's own socket path alone, where it closes at once and carries nothing", () => {
        expect(upgraded('/', 'vite-ping').socket.destroy).not.toHaveBeenCalled();
        expect(upgraded('/app/', 'vite-ping', { base: '/app/' }).socket.destroy).not.toHaveBeenCalled();
        expect(upgraded('/hmr', 'vite-ping', { ws: { path: 'hmr' } }).socket.destroy).not.toHaveBeenCalled();
        for (const [url, options] of [['/other', {}], ['/other?x=/', {}], ['/', { base: '/app/' }], ['/', { ws: { path: 'hmr' } }]]) {
            expect(upgraded(url, 'vite-ping', options).socket.destroy, url).toHaveBeenCalledOnce();
        }
        expect(upgraded('/other', 'vite-hmr').socket.destroy).toHaveBeenCalledOnce();
        expect(upgraded(`/other?token=${viteToken}`).socket.destroy).not.toHaveBeenCalled();
    });

    test('refuses a socket whose target no URL reads', () => {
        expect(upgraded('http://[/', 'vite-ping').socket.destroy).toHaveBeenCalledOnce();
    });
});

describe('the gate in front of the server', () => {
    const token = gateToken(key);
    // A request to the server, by a socket of its own, so that its target is sent as written: its status and body.
    function raw(port, target, headers = {}) {
        return new Promise((done) => {
            const socket = net.connect(port, '127.0.0.1', () => {
                const lines = Object.entries({ Host: `127.0.0.1:${port}`, Connection: 'close', ...headers }).map(([name, value]) => `${name}: ${value}`);
                socket.write(`GET ${target} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
            });
            let said = '';
            socket.on('data', (chunk) => { said += chunk; });
            socket.on('close', () => done({ status: Number(said.split(' ')[1]), body: said.split('\r\n\r\n')[1] }));
        });
    }

    test("answers before the server's own handler and whatever middleware it holds, whenever it was added", async () => {
        const reached = [];
        // The handler stands for Vite's middlewares, those of a plugin before crossbind's among them.
        const server = http.createServer((req, res) => {
            reached.push(req.url);
            res.end(req.url === '/__e2e/early' ? 'early' : 'vite');
        });
        guardServer(server, previewGate(preview, { warn() {} }));
        await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
        const { port } = server.address();
        try {
            expect(await raw(port, '/__e2e/early')).toMatchObject({ status: 403, body: 'crossbind: this preview answers the device that opened it alone' });
            expect(await raw(port, '/@vite/client', { [GATE_HEADER]: 'nope' })).toMatchObject({ status: 403 });
            expect(await raw(port, `/__crossbind/session?challenge=${challenge}`)).toMatchObject({ status: 200 });
            expect(await raw(port, 'http://[/')).toMatchObject({ status: 400 });
            expect(reached).toEqual([]);
            expect(await raw(port, '/__e2e/early', { [GATE_HEADER]: token })).toMatchObject({ status: 200, body: 'early' });
            expect(reached).toEqual(['/__e2e/early']);
        } finally {
            await new Promise((done) => { server.close(done); });
        }
    });
});

describe("what crossbind app preview hands Vite", () => {
    test('is nothing without it, and a key of its form with it', () => {
        expect(previewOf({})).toBeNull();
        expect(previewOf({ CROSSBIND_APP_PREVIEW: JSON.stringify(preview) }).key).toBe(key);
        expect(() => previewOf({ CROSSBIND_APP_PREVIEW: JSON.stringify({ key: 'short' }) })).toThrow('CROSSBIND_APP_PREVIEW holds no key');
    });
});
