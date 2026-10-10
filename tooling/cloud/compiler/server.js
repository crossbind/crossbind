import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { compile, WorkspaceError } from './compile.js';
import { validateRequest, InvalidRequest, MAX_SOURCE_BYTES } from './validate.js';

const PORT = 8080;
const MAX_IN_FLIGHT = 2;
// A fresh microVM after this many compiles, failed ones included, so nothing one compile managed to leave
// behind lasts long.
const RECYCLE_AFTER = 200;

// JSON escaping can double the size of the sources.
export const MAX_BODY_BYTES = 2 * MAX_SOURCE_BYTES + 1024;

class BodyTooLarge extends Error {}

function send(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
}

function readBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        if (Number(req.headers['content-length']) > maxBytes) {
            req.resume();
            reject(new BodyTooLarge());
            return;
        }
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size <= maxBytes) chunks.push(chunk);
        });
        req.on('end', () => (size > maxBytes ? reject(new BodyTooLarge()) : resolve(Buffer.concat(chunks).toString('utf8'))));
        req.on('error', reject);
    });
}

// Once the last byte of the answer has gone out, never earlier: exiting right after res.end() cuts large bodies.
function afterSent(res, callback) {
    if (res.writableFinished) {
        callback();
        return;
    }
    let called = false;
    const once = () => {
        if (called) return;
        called = true;
        callback();
    };
    res.once('finish', once);
    res.once('close', once);
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        throw new InvalidRequest('The body is not JSON.');
    }
}

// Only the Worker in front reaches this server; it still trusts nothing it receives.
export function createCompileServer({
    compileFiles = compile, maxInFlight = MAX_IN_FLIGHT, recycleAfter = RECYCLE_AFTER,
    onRecycle = () => process.exit(0), log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
    let queue = Promise.resolve();
    let inFlight = 0;
    let compiles = 0;
    let attempts = 0;
    // Due for recycling: new work gets 503, and the process leaves once the last answer is out.
    let recycling = false;
    let recycled = false;

    const runCompile = (files) => {
        const job = queue.then(() => compileFiles(files));
        queue = job.then(() => {}, () => {});
        return job;
    };

    async function handleCompile(req, res) {
        let files;
        try {
            files = validateRequest(parseJson(await readBody(req, MAX_BODY_BYTES)));
        } catch (error) {
            if (error instanceof BodyTooLarge) return send(res, 413, { error: `The body is over ${MAX_BODY_BYTES} bytes.` });
            if (error instanceof InvalidRequest) return send(res, 400, { error: error.message });
            throw error;
        }
        if (recycling || inFlight >= maxInFlight) return send(res, 503, { error: 'The compiler is busy; try again in a moment.' });
        inFlight += 1;
        try {
            const started = Date.now();
            const result = await runCompile(files);
            compiles += 1;
            log(JSON.stringify({ event: 'compile', ok: result.ok, reason: result.reason, ms: Date.now() - started }));
            return send(res, 200, result);
        } catch (error) {
            // A workspace that cannot be cleared stays broken for every later compile: only a fresh container helps.
            recycling ||= error instanceof WorkspaceError;
            log(JSON.stringify({ event: 'error', message: error.message }));
            return send(res, 500, { error: 'Internal error.' });
        } finally {
            inFlight -= 1;
            attempts += 1;
            recycling ||= attempts >= recycleAfter;
            afterSent(res, () => {
                if (!recycling || recycled || inFlight > 0) return;
                recycled = true;
                onRecycle();
            });
        }
    }

    return http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/health') return send(res, recycling ? 503 : 200, { ok: !recycling, compiles });
        if (req.method === 'POST' && req.url === '/compile') {
            return handleCompile(req, res).catch((error) => {
                log(JSON.stringify({ event: 'error', message: error.message }));
                if (!res.headersSent) send(res, 500, { error: 'Internal error.' });
            });
        }
        return send(res, 404, { error: 'Not found.' });
    });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = createCompileServer();
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.listen(PORT, '0.0.0.0', () => process.stdout.write(`playground compiler listening on ${PORT}\n`));
}
