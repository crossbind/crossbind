// What e2e/run.mjs's endpoint serves beside what src/web-features.js reaches: under /page/ the page `pnpm build` made, as
// a dev server would serve it to the probe's origins, a Range of a file, and an answer with headers the probe's proxy
// drops; under /fetch/ what src/served-origins.js checks the host's fetch() with. Run alone, as
// `node e2e/endpoint.mjs`, it serves both on every address, for an app on a phone that no run drives, built with
// VITE_E2E_ENDPOINT=http://<this machine's address>:47831.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REACH_PORT } from './launch.mjs';

// The host's limit of a fetch's answer.
const MAX_FETCH_BYTES = 256 * 1024 * 1024;
const LARGE_BYTES = 64 * 1024 * 1024;
// A large body's bytes are i % 251, as the probe checks them; a chunk of a whole number of 251 starts the pattern anew.
const PATTERN = 251;
const CHUNK = Buffer.from(Array.from({ length: PATTERN * 4096 }, (_, i) => i % PATTERN));
// How long an answer the host gives up on stays open, past its 60 s.
const HELD_MS = 90000;
const TRICKLE_MS = 1000;
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
    '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const RANGE = /^bytes=(\d+)-(\d*)$/;
// How long the endpoint takes to answer a page on its way, and how long that page, once shown, waits before it says so.
const SLOW_MS = 3000;
const SHOWN_MS = 3000;

const pathOf = (request) => new URL(request.url, 'http://endpoint').pathname;

// The page's own files alone: those at the folder's top and under assets/, never the apps beside them.
function pageFile(dist, path) {
    const file = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1));
    const parts = file.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..') || (parts.length > 1 && parts[0] !== 'assets')) return null;
    const full = join(dist, ...parts);
    return existsSync(full) && statSync(full).isFile() ? full : null;
}

// The bytes of a file, or of the one range a request names, with what its answer says of them.
function answerFile(request, response, file) {
    const bytes = readFileSync(file);
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
    const range = RANGE.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (range && start > end) {
        response.writeHead(416, { 'content-range': `bytes */${bytes.length}` });
        response.end();
        return;
    }
    const body = bytes.subarray(start, end + 1);
    response.writeHead(range ? 206 : 200, { ...headers, 'content-length': body.length, ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(request.method === 'HEAD' ? undefined : body);
}

// The page under /page/, which the probe's proxy fetches for each of its origins' requests; true once answered.
export function answerPage(request, response, dist) {
    const path = pathOf(request);
    if (!path.startsWith('/page/')) return false;
    const inPage = path.slice('/page'.length);
    if (inPage === '/__e2e/headers') {
        response.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'e2e-proxy=1; Path=/', 'x-e2e': 'dropped' });
        response.end('headers');
        return true;
    }
    // A page that comes late, as one on its way while its origin ends, which says so if the window shows it.
    if (inPage === '/__e2e/slow') {
        const said = "console.error('CONFORMANCE ERR: ' + location.origin + ': the window shows a page of an origin that ended while it was on its way')";
        setTimeout(() => {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            response.end(`<!doctype html><meta charset="utf-8"><script>setTimeout(() => ${said}, ${SHOWN_MS});</script>`);
        }, SLOW_MS);
        return true;
    }
    // A path of the kind a dev server names, with a colon, as Vite's virtual modules have.
    if (inPage === '/__e2e/id:virtual') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('id:virtual');
        return true;
    }
    const file = pageFile(dist, inPage);
    if (!file) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end(`the endpoint has no ${inPage}`);
        return true;
    }
    answerFile(request, response, file);
    return true;
}

// Writes the pattern until total bytes went, or the host closed the answer, as it does once it has given up.
function stream(response, total) {
    let left = total;
    response.on('close', () => { left = 0; });
    const next = () => {
        while (left > 0) {
            const part = CHUNK.subarray(0, Math.min(CHUNK.length, left));
            left -= part.length;
            if (!response.write(part)) {
                response.once('drain', next);
                return;
            }
        }
        response.end();
    };
    next();
}

// An answer that never ends: its headers, then a byte each second, until the host closes it.
function trickle(response) {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    const timer = setInterval(() => response.write('.'), TRICKLE_MS);
    const ending = setTimeout(() => response.destroy(), HELD_MS);
    response.on('close', () => {
        clearInterval(timer);
        clearTimeout(ending);
    });
}

// The fetch's checks under /fetch/; true once answered. counts keeps what the endpoint heard, across the run.
export function answerFetch(request, response, counts) {
    const path = pathOf(request);
    if (!path.startsWith('/fetch/')) return false;
    const elsewhere = `http://localhost:${request.socket.localPort}`;
    const routes = {
        // A redirect within the origin, which the host follows but for a POST's or a DELETE's, and one to another, which
        // it gives back.
        '/fetch/redirect-in': () => request.resume().on('end', () => response.writeHead(302, { location: '/fetch/count?redirected' }).end()),
        // What a fetch sent: its method, the type its headers named, and its body's length and SHA-256.
        '/fetch/echo': () => {
            const chunks = [];
            request.on('data', (chunk) => chunks.push(chunk)).on('end', () => {
                const body = Buffer.concat(chunks);
                const sha256 = createHash('sha256').update(body).digest('hex');
                response.writeHead(200, { 'content-type': 'application/json' })
                    .end(JSON.stringify({ method: request.method, type: request.headers['content-type'] ?? null, length: body.length, sha256 }));
            });
        },
        '/fetch/redirect-out': () => response.writeHead(302, { location: `${elsewhere}/fetch/count` }).end(),
        '/fetch/redirect-loop': () => response.writeHead(302, { location: '/fetch/redirect-loop' }).end(),
        // What the host sent of a cookie the last answer set.
        '/fetch/cookie': () => response.writeHead(200, { 'set-cookie': 'e2e-fetch=1; Path=/; Max-Age=3600' }).end(request.headers.cookie ?? 'none'),
        // An answer a cache would keep for an hour: the count of those the endpoint heard.
        '/fetch/count': () => {
            counts.count = (counts.count ?? 0) + 1;
            response.writeHead(200, { 'cache-control': 'max-age=3600', etag: '"e2e-count"' }).end(String(counts.count));
        },
        '/fetch/declared-over': () => {
            response.writeHead(200, { 'content-length': MAX_FETCH_BYTES + 1, 'content-type': 'application/octet-stream' });
            response.write(CHUNK.subarray(0, 1024));
            const ending = setTimeout(() => response.destroy(), HELD_MS);
            response.on('close', () => clearTimeout(ending));
        },
        '/fetch/large': () => {
            response.writeHead(200, { 'content-length': LARGE_BYTES, 'content-type': 'application/octet-stream' });
            stream(response, LARGE_BYTES);
        },
        // Past the limit with no length declared, and an answer that never ends: what this run checks if it says so.
        '/fetch/undeclared-over': () => {
            response.writeHead(200, { 'content-type': 'application/octet-stream' });
            stream(response, MAX_FETCH_BYTES + 2 * CHUNK.length);
        },
        '/fetch/slow': () => trickle(response),
        '/fetch/limits': () => response.writeHead(200).end(process.env.CROSSBIND_E2E_FETCH_LIMITS === '1' ? 'yes' : 'no'),
    };
    const route = routes[path];
    if (route) route();
    else response.writeHead(404).end();
    return true;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    const dist = resolve(import.meta.dirname, '..', 'dist');
    const counts = {};
    createServer((request, response) => {
        if (!answerPage(request, response, dist) && !answerFetch(request, response, counts)) response.writeHead(404).end();
    }).listen(REACH_PORT, '0.0.0.0', () => console.log(`the endpoint serves ${dist} and the fetch's checks on port ${REACH_PORT}`));
}
