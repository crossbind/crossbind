// The HTTP server CurlProbe (native/curl_probe.cpp) talks to, and the report it must produce.
// The server answers any origin (CORS), so a page on another port can reach it.
import http from 'node:http';

const BIG_BYTES = 40000;
const SLOW_MS = 1500;
const MAX_WRITE_SIZE = 16384;

function header(req, name) {
    const value = req.headers[name];
    return value === undefined ? '-' : `[${value}]`;
}

function echo(req, body) {
    const fields = { ct: 'content-type', probe: 'x-probe', empty: 'x-empty', removed: 'x-removed', range: 'range', auth: 'authorization' };
    const parts = Object.entries(fields).map(([label, name]) => `${label}=${header(req, name)}`);
    return [req.method, ...parts, `body=${body.toString('hex')}`].join(' ');
}

function respond(req, res, body) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Reply' };
    if (req.url === '/echo') {
        res.writeHead(200, { ...cors, 'Content-Type': 'text/plain', 'X-Reply': 'yes' });
        res.end(echo(req, body));
    } else if (req.url.startsWith('/path')) {
        res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' });
        res.end(req.url);
    } else if (req.url === '/big') {
        res.writeHead(200, cors);
        res.end('x'.repeat(BIG_BYTES));
    } else if (req.url === '/slow') {
        setTimeout(() => {
            res.writeHead(200, cors);
            res.end('late');
        }, SLOW_MS);
    } else {
        res.writeHead(404, cors);
        res.end('missing');
    }
}

function handle(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': req.headers['access-control-request-method'] ?? '*',
            'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
        });
        res.end();
        return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => respond(req, res, Buffer.concat(chunks)));
}

function listen(server) {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

function close(server) {
    return new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    });
}

// A port that refuses connections: bound once, then released.
async function deadPort() {
    const server = http.createServer();
    const port = await listen(server);
    await close(server);
    return port;
}

export async function startCurlProbeServer() {
    const server = http.createServer(handle);
    const port = await listen(server);
    return {
        url: `http://127.0.0.1:${port}`,
        deadUrl: `http://127.0.0.1:${await deadPort()}/`,
        close: () => close(server),
    };
}

function echoed(method, { ct = '-', probe = '-', empty = '-', range = '-', auth = '-', body = '' } = {}) {
    return `${method} ct=${ct} probe=${probe} empty=${empty} removed=- range=${range} auth=${auth} body=${body}`;
}

function hex(text) {
    return Buffer.from(text, 'binary').toString('hex');
}

function basic(credentials) {
    return `[Basic ${Buffer.from(credentials).toString('base64')}]`;
}

// `blocking`: curl waited with a synchronous request (in a worker), which takes no timeout and
// cannot be cancelled while it runs.
export function expectedCurlReport({ blocking }) {
    const lines = [
        ['get', `rc=0 code=200 ${echoed('GET', { probe: '[one]', empty: '[]' })} headers=status,reply,end`],
        ['post', `rc=0 code=200 ${echoed('POST', { ct: '[application/x-www-form-urlencoded]', body: hex('a\0b') })}`],
        ['put', `rc=0 code=200 ${echoed('PUT', { body: hex('put-body') })}`],
        ['method', `rc=0 code=200 ${echoed('MKCALENDAR')}`],
        ['longmethod', `rc=4 code=0 err=The fetch transport cannot send the method "${'X'.repeat(40)}"`],
        ['range', `rc=0 code=200 ${echoed('GET', { range: '[bytes=0-3]' })}`],
        ['userpwd', `rc=0 code=200 ${echoed('GET', { auth: basic('user:pass') })}`],
        ['urlcreds', `rc=0 code=200 ${echoed('GET', { auth: basic('u@x:p:y') })}`],
        ['noscheme', `rc=0 code=200 ${echoed('GET')}`],
        // A raw byte past ASCII goes out as UTF-8 %XX, whatever the page's encoding.
        ['utf8query', 'rc=0 code=200 /path?q=%C3%BC'],
        ['head', 'rc=0 code=200 bytes=0'],
        ['failonerror', 'rc=22 code=404 err=The requested URL returned error: 404 writes=0 status=HTTP/1.1 404 Not Found'],
        ['missing', 'rc=0 code=404 missing'],
        ['dead', 'rc=7 code=0 err=Could not connect: fetch failed (network error, CORS or a blocked request)'],
        ['big', `rc=0 code=200 bytes=${BIG_BYTES} writes=${Math.ceil(BIG_BYTES / MAX_WRITE_SIZE)} largest=${MAX_WRITE_SIZE}`],
        ['maxfilesize', 'rc=63 code=200 err=Exceeded the maximum allowed file size (10) with 10 bytes bytes=10'],
        ['shortwrite', `rc=23 code=200 err=Failure writing output to destination, passed ${MAX_WRITE_SIZE} returned 0`],
        ['mime', 'rc=4 code=0 err=The fetch transport cannot send multipart form posts'],
        ['reuse', 'first=7 second=22 code=404 err=The requested URL returned error: 404'],
        ['timeout', blocking ? 'rc=0 code=200 late' : 'rc=28 code=0'],
        ['file', 'rc=1 code=0 err=Protocol "file" is not supported by the fetch transport'],
        ['badurl', 'rc=3 code=0 err=URL rejected: Malformed input to a URL function'],
        ['multi', 'null'],
        // /big has no Content-Length, so the total stays 0 as in curl.
        ['progress', `rc=0 code=200 calls=some last=${BIG_BYTES}/0`],
        ['abort', 'rc=42 code=0 err=Callback aborted'],
        ['cancel', blocking ? 'rc=42 code=200 err=Callback aborted bytes=4' : 'rc=42 code=0 err=Callback aborted bytes=0'],
    ];
    return lines.map(([name, text]) => `${name}: ${text}\n`).join('');
}

// Checks the `CURLPROBE <json>` line a Node leg prints; null when the report matches.
export function curlProbeMismatch(output, options) {
    const match = output.match(/^CURLPROBE (.*)$/m);
    const report = match ? JSON.parse(match[1]) : null;
    const expected = expectedCurlReport(options);
    return report === expected ? null : `curl probe mismatch:\n--- expected\n${expected}--- actual\n${report ?? output}`;
}
