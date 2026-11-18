// Spike: Windows' origin for a project. Opens the built app, or with --msix the one its MSIX package installed, beside
// step A's endpoint at 47831, and with --listen beside a listener of the run's own on the machine's port 80, where what
// escapes the host goes. Prints what the app printed of the spike, what reached the endpoint and the listener, and
// writes it all to dist/spike-<label>.log.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';

const RUN_TIMEOUT_MS = 180000;
const REACH_PORT = 47831;
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const root = resolve(import.meta.dirname, '..');
const name = 'crossbind-e2e-desktop-app';
const isMsix = process.argv.includes('--msix');
const isListening = process.argv.includes('--listen');
const label = `${isMsix ? 'msix' : 'plain'}-${process.arch}${isListening ? '-listener' : ''}`;
const executable = isMsix
    ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', `${name}.exe`)
    : join(root, 'dist', `${name}-win32-${process.arch}`, `${name}.exe`);
const address = Object.values(networkInterfaces()).flat()
    .find((one) => one.family === 'IPv4' && !one.internal && !one.address.startsWith('169.254.'))?.address;

const heard = { endpoint: [], listener: [] };
let out = '';

// The service worker the listener serves, which takes a key's origin where its script's request escapes the host.
const LISTENER_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    if (new URL(event.request.url).pathname === '/spike/under-sw.txt') event.respondWith(new Response('the service worker of the listener on port 80'));
});
self.addEventListener('message', (event) => {
    event.waitUntil((async () => {
        const results = {};
        for (const url of event.data.urls) {
            try {
                const response = await fetch(url);
                results[url] = response.status + ' ' + (await response.text()).slice(0, 80);
            } catch (error) {
                results[url] = 'error: ' + error.message;
            }
        }
        event.source.postMessage(results);
    })());
});
`;

// An http and ws server that logs each request it hears into list, answering http with answer(request).
function serve(port, list, answer) {
    const log = (request, kind) => {
        const preflight = request.headers['access-control-request-private-network'] ? ', private network preflight' : '';
        list.push(`${kind} ${request.headers.host} ${request.url} from ${request.socket.remoteAddress}, origin ${request.headers.origin}${preflight}`);
    };
    const server = createServer((request, response) => {
        log(request, request.method);
        const [type, body] = answer(request);
        response.writeHead(200, {
            'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-private-network': 'true', 'cache-control': 'no-store',
        });
        response.end(body);
    });
    server.on('upgrade', (request, socket) => {
        log(request, 'upgrade');
        socket.on('error', () => {});
        const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}${WEBSOCKET_GUID}`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        const text = Buffer.from(port === 80 ? 'escaped to the listener on port 80' : 'ok');
        socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
    });
    return new Promise((done) => {
        server.once('error', (error) => done(`not listening: ${error.message}`));
        // Every address, IPv6's loopback too, which a name of localhost's may reach first.
        server.listen({ port, host: '::', ipv6Only: false }, () => done('listening'));
    });
}

function finish(problem) {
    clearTimeout(timer);
    app?.kill();
    const lines = out.split(/\r?\n/).filter((line) => /^(SPIKE|PAGE GETS|crossbind)/.test(line));
    const text = [
        `spike ${label}: ${problem ?? 'done'}`, `executable ${executable}`, `network address ${address}`, `listener ${listener}`,
        ...lines, 'what reached the endpoint:', ...heard.endpoint, 'what reached the listener on port 80:', ...heard.listener,
        'the whole output:', out,
    ].join('\n');
    writeFileSync(join(root, 'dist', `spike-${label}.log`), text);
    console.log(text);
    process.exit(problem ? 1 : 0);
}

console.log(`endpoint: ${await serve(REACH_PORT, heard.endpoint, () => ['text/plain', 'ok'])}`);
const listener = isListening
    ? await serve(80, heard.listener, (request) => (request.url.startsWith('/spike/sw.js')
        ? ['text/javascript', LISTENER_WORKER] : ['text/plain', 'served by the listener on port 80']))
    : 'none';
console.log(`listener on port 80: ${listener}`);
const app = spawn(executable, [], { env: { ...process.env, CROSSBIND_APP_CONSOLE: '1', CROSSBIND_E2E_NETWORK_ADDRESS: address ?? '' } });
const timer = setTimeout(() => finish('the spike did not finish in time'), RUN_TIMEOUT_MS);
const take = (chunk) => {
    out += chunk;
    if (/^SPIKE done/m.test(out)) finish();
};
app.stdout.on('data', take);
app.stderr.on('data', take);
app.once('error', (error) => finish(`the app did not start: ${error.message}`));
app.once('exit', (code) => setTimeout(() => finish(`the app exited with ${code} before the spike was done`), 1000));
