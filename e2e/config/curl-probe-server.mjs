// The HTTP server CurlProbe (native/curl_probe.cpp) talks to, and the report it must produce.
// The server answers any origin (CORS), so a page on another port can reach it.
import http from 'node:http';

const BIG_BYTES = 40000;
const SLOW_MS = 1500;
const MAX_WRITE_SIZE = 16384;
const RASTER_SIDE = 256;
const TIFF_SHORT = 3;
const TIFF_LONG = 4;
const TIFF_HEADER_BYTES = 8;
const TIFF_ENTRY_BYTES = 12;

// A plain little-endian TIFF of one byte band, its directory after the pixels, so that a reader has to ask for
// more than the file's start.
function rasterFile() {
    const pixels = Uint8Array.from({ length: RASTER_SIDE * RASTER_SIDE }, (_, i) => (i * 7) % 251);
    const directory = TIFF_HEADER_BYTES + pixels.length;
    const entries = [
        [256, TIFF_SHORT, RASTER_SIDE], // ImageWidth
        [257, TIFF_SHORT, RASTER_SIDE], // ImageLength
        [258, TIFF_SHORT, 8], // BitsPerSample
        [259, TIFF_SHORT, 1], // Compression: none
        [262, TIFF_SHORT, 1], // PhotometricInterpretation: black is zero
        [273, TIFF_LONG, TIFF_HEADER_BYTES], // StripOffsets
        [277, TIFF_SHORT, 1], // SamplesPerPixel
        [278, TIFF_SHORT, RASTER_SIDE], // RowsPerStrip
        [279, TIFF_LONG, pixels.length], // StripByteCounts
    ];
    const bytes = Buffer.alloc(directory + 2 + entries.length * TIFF_ENTRY_BYTES + 4);
    bytes.write('II', 0, 'latin1');
    bytes.writeUInt16LE(42, 2);
    bytes.writeUInt32LE(directory, 4);
    bytes.set(pixels, TIFF_HEADER_BYTES);
    bytes.writeUInt16LE(entries.length, directory);
    entries.forEach(([tag, type, value], index) => {
        const at = directory + 2 + index * TIFF_ENTRY_BYTES;
        bytes.writeUInt16LE(tag, at);
        bytes.writeUInt16LE(type, at + 2);
        bytes.writeUInt32LE(1, at + 4);
        if (type === TIFF_SHORT) bytes.writeUInt16LE(value, at + 8);
        else bytes.writeUInt32LE(value, at + 8);
    });
    return { bytes, sum: pixels.reduce((total, value) => total + value, 0) };
}

const RASTER = rasterFile();

// What RemoteRaster (web-vanilla/src/remote/remote_raster.h) reads from /raster.tif.
export const remoteRaster = { side: RASTER_SIDE, sum: RASTER.sum };

// GDAL's description of a WMS server at `url` whose map is the raster twice, side by side, one tile each.
export function remoteWms(url) {
    const window = `<UpperLeftX>-180</UpperLeftX><UpperLeftY>90</UpperLeftY><LowerRightX>180</LowerRightX><LowerRightY>-90</LowerRightY><SizeX>${RASTER_SIDE * 2}</SizeX><SizeY>${RASTER_SIDE}</SizeY>`;
    const service = `<Version>1.1.1</Version><ServerUrl>${url}/wms?</ServerUrl><SRS>EPSG:4326</SRS><ImageFormat>image/tiff</ImageFormat><Layers>base</Layers>`;
    const tiles = `<BandsCount>1</BandsCount><DataType>Byte</DataType><BlockSizeX>${RASTER_SIDE}</BlockSizeX><BlockSizeY>${RASTER_SIDE}</BlockSizeY><OverviewCount>0</OverviewCount>`;
    return `<GDAL_WMS><Service name="WMS">${service}</Service><DataWindow>${window}</DataWindow>${tiles}</GDAL_WMS>`;
}

// GDAL configuration that makes the server at `url` the S3 endpoint /vsis3/bucket/raster.tif is read from, signed.
export function remoteBucket(url) {
    const endpoint = [`AWS_S3_ENDPOINT=${new URL(url).host}`, 'AWS_HTTPS=NO', 'AWS_VIRTUAL_HOSTING=FALSE'];
    const account = ['AWS_ACCESS_KEY_ID=probe', 'AWS_SECRET_ACCESS_KEY=probe', 'AWS_REGION=us-east-1'];
    return [...endpoint, ...account, 'GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR'].join('|');
}

// The raster, whole or the part a Range header names, as a static host answers.
function sendRaster(req, res, cors, stats) {
    const { bytes } = RASTER;
    const headers = { ...cors, 'Content-Type': 'image/tiff', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (!range) {
        res.writeHead(200, { ...headers, 'Content-Length': bytes.length });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return;
    }
    const start = Number(range[1]);
    const end = Math.min(range[2] === '' ? Infinity : Number(range[2]), bytes.length - 1);
    stats.rasterRanges += 1;
    res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        'Content-Length': end - start + 1,
    });
    res.end(bytes.subarray(start, end + 1));
}

function header(req, name) {
    const value = req.headers[name];
    return value === undefined ? '-' : `[${value}]`;
}

function echo(req, body) {
    const fields = { ct: 'content-type', probe: 'x-probe', empty: 'x-empty', removed: 'x-removed', range: 'range', auth: 'authorization' };
    const parts = Object.entries(fields).map(([label, name]) => `${label}=${header(req, name)}`);
    return [req.method, ...parts, `body=${body.toString('hex')}`].join(' ');
}

function respond(req, res, body, stats) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Reply' };
    if (req.url === '/raster.tif') {
        sendRaster(req, res, cors, stats);
    } else if (req.url === '/bucket/raster.tif') {
        // GDAL learns an S3 object's size from Content-Range, which a page reads only when the bucket exposes it.
        if ((req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 ')) stats.signedReads += 1;
        sendRaster(req, res, { ...cors, 'Access-Control-Expose-Headers': 'Content-Range' }, stats);
    } else if (req.url.startsWith('/wms?')) {
        stats.wmsTiles += 1;
        res.writeHead(200, { ...cors, 'Content-Type': 'image/tiff', 'Content-Length': RASTER.bytes.length });
        res.end(RASTER.bytes);
    } else if (req.url === '/echo') {
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

function handle(req, res, stats) {
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
    req.on('end', () => respond(req, res, Buffer.concat(chunks), stats));
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
    const stats = { rasterRanges: 0, signedReads: 0, wmsTiles: 0 };
    const server = http.createServer((req, res) => handle(req, res, stats));
    const port = await listen(server);
    return {
        url: `http://127.0.0.1:${port}`,
        deadUrl: `http://127.0.0.1:${await deadPort()}/`,
        // How many times a part of the raster was asked for.
        rasterRanges: () => stats.rasterRanges,
        // How many requests for the bucket's raster carried an AWS signature.
        signedReads: () => stats.signedReads,
        // How many WMS tiles were asked for.
        wmsTiles: () => stats.wmsTiles,
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
        ['badurl', 'rc=3 code=0 err=URL rejected: Bad hostname'],
        // A multi handle's transfers run through fetch too, one after another.
        ['multi', 'first=rc=0 code=200 /path?one second=rc=0 code=200 /path?two reported=2'],
        ['multirange', `rc=0 code=200 ${echoed('GET', { range: '[bytes=0-3]' })}`],
        ['multidead', 'rc=7 code=0 err=Could not connect: fetch failed (network error, CORS or a blocked request)'],
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
