import {
    describe, test, expect, afterEach, beforeEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRunnerServer } from '../src/runner/server.js';
import { uploadMissing } from '../src/utils/remoteUpload.js';

const TOKEN = 'secret-token-for-tests';
const FORWARDED_HEADERS = ['authorization', 'content-type', 'content-range', 'x-crossbind-upload'];
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const servers = [];
let previousToken;

beforeEach(() => {
    previousToken = process.env.CROSSBIND_TOKEN;
    process.env.CROSSBIND_TOKEN = TOKEN;
});

afterEach(async () => {
    if (previousToken === undefined) delete process.env.CROSSBIND_TOKEN;
    else process.env.CROSSBIND_TOKEN = previousToken;
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.close(resolve); })));
});

async function listen(server) {
    servers.push(server);
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${server.address().port}`;
}

const readBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
};

// The proxy sends a request on to its runner's address: only the path comes from the request.
function forward(target, req, body, res) {
    const { hostname, port } = new URL(target);
    const headers = Object.fromEntries(FORWARDED_HEADERS.filter((name) => req.headers[name]).map((name) => [name, req.headers[name]]));
    const request = http.request({ hostname, port, path: req.url, method: req.method, headers }, (response) => {
        res.writeHead(response.statusCode, { 'content-type': response.headers['content-type'] ?? 'application/json' });
        response.pipe(res);
    });
    request.once('error', (error) => res.destroy(error));
    request.end(req.method === 'GET' ? undefined : body);
}

// Refuses a request body over the limit, as Cloudflare does above 100 MB and Cloud Run above 32 MiB.
function limitingProxy(target, limit) {
    return http.createServer(async (req, res) => {
        const body = await readBody(req);
        if (body.length > limit) {
            res.writeHead(413);
            res.end();
            return;
        }
        forward(target, req, body, res);
    });
}

// Drops the connection of the n-th upload request after reading part of it, as a network between a client and a
// hosted runner now and then does.
function droppingProxy(target, dropAt) {
    let uploads = 0;
    return http.createServer(async (req, res) => {
        if (req.method === 'PUT' && (uploads += 1) === dropAt) {
            req.once('data', () => req.socket.destroy());
            return;
        }
        forward(target, req, await readBody(req), res);
    });
}

// A runner deployed before uploads in parts: it takes a file in one request.
function olderRunner(received) {
    return http.createServer(async (req, res) => {
        const body = await readBody(req);
        const reply = (status, value) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(value));
        };
        if (req.url === '/v1/health') return reply(200, { ok: true, protocol: 1 });
        if (req.url === '/v1/missing') return reply(200, { missing: JSON.parse(body).hashes });
        received.push({ method: req.method, url: req.url, length: body.length });
        return reply(201, {});
    });
}

function files(sizes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-upload-'));
    return new Map(Object.entries(sizes).map(([name, size]) => {
        const data = crypto.randomBytes(size);
        const file = path.join(dir, name);
        fs.writeFileSync(file, data);
        return [sha(data), file];
    }));
}

// The runner server takes uploads only inside the Linux toolchain image.
describe.skipIf(process.platform === 'win32')('uploadMissing', () => {
    test('sends a file larger than one request may carry in parts, which the runner joins', async () => {
        const blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-blobs-'));
        const runner = await listen(createRunnerServer({
            mountPrefixes: [os.tmpdir()], scratchDirs: [], blobDir, token: TOKEN, image: 'web', role: 'web',
        }));
        const proxy = await listen(limitingProxy(runner, 512));
        const sources = files({ 'small.h': 10, 'large.a': 1000 });

        await uploadMissing(proxy, sources, 128);

        const { missing } = await (await fetch(`${runner}/v1/missing`, {
            method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ hashes: [...sources.keys()] }),
        })).json();
        expect(missing).toEqual([]);
        for (const [hash, file] of sources) expect(fs.readFileSync(path.join(blobDir, hash))).toEqual(fs.readFileSync(file));
    });

    test('sends a part again when the connection drops, and the runner joins the whole file', async () => {
        const blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-blobs-'));
        const runner = await listen(createRunnerServer({
            mountPrefixes: [os.tmpdir()], scratchDirs: [], blobDir, token: TOKEN, image: 'web', role: 'web',
        }));
        const proxy = await listen(droppingProxy(runner, 3));
        const sources = files({ 'large.a': 1000 });

        await uploadMissing(proxy, sources, 128);

        const [[hash, file]] = sources;
        expect(fs.readFileSync(path.join(blobDir, hash))).toEqual(fs.readFileSync(file));
    });

    test('names a file\'s upload after its hash, so a later attempt goes on with what the runner holds', async () => {
        const received = [];
        const runner = await listen(http.createServer(async (req, res) => {
            const body = await readBody(req);
            const reply = (status, value) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(value));
            };
            if (req.url === '/v1/health') return reply(200, { ok: true, protocol: 2 });
            if (req.url === '/v1/missing') return reply(200, { missing: JSON.parse(body).hashes });
            received.push(req.headers['x-crossbind-upload']);
            const [end, total] = req.headers['content-range'].match(/^bytes \d+-(\d+)\/(\d+)$/).slice(1).map(Number);
            return end + 1 === total ? reply(201, { stored: 'x' }) : reply(202, { received: end + 1 });
        }));
        const sources = files({ 'large.a': 300 });

        await uploadMissing(runner, sources, 128);

        expect(received).toEqual(Array(3).fill([...sources.keys()][0].slice(0, 32)));
    });

    test('names the request limit of a proxy that refuses even one part', async () => {
        const blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-blobs-'));
        const runner = await listen(createRunnerServer({
            mountPrefixes: [os.tmpdir()], scratchDirs: [], blobDir, token: TOKEN, image: 'web', role: 'web',
        }));
        const proxy = await listen(limitingProxy(runner, 100));
        const sources = files({ 'large.a': 1000 });

        await expect(uploadMissing(proxy, sources, 128)).rejects.toThrow(/large\.a.*refused a part of 128 bytes/);
    });

    test('names the fix when a runner from before uploads in parts is refused a large file', async () => {
        const proxy = await listen(limitingProxy(await listen(olderRunner([])), 512));
        const sources = files({ 'large.a': 1000 });

        await expect(uploadMissing(proxy, sources, 128)).rejects.toThrow(/large\.a .*too large.*deploy the runner again/);
    });

    test('still sends a large file in one request to a runner from before uploads in parts', async () => {
        const received = [];
        const runner = await listen(olderRunner(received));
        const sources = files({ 'large.a': 1000 });

        await uploadMissing(runner, sources, 128);

        expect(received).toEqual([{ method: 'PUT', url: `/v1/blobs/${[...sources.keys()][0]}`, length: 1000 }]);
    });
});
