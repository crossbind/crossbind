// What the web view gives a page of the app's own origin, as a web build there would use it, printed for e2e/run.mjs to
// show and asserted nowhere: the platforms differ, and the loop's time differs by machine.
import { device, invoke } from 'crossbind/app';
import { REACH_PORT } from '../e2e/launch.mjs';

const ANSWER_TIMEOUT_MS = 5000;
const LOOP_RUNS = 4;
const LOOP_ITERATIONS = 30000000;
// The smallest module: the magic number and the version.
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const WORKER_URL = `${import.meta.env.BASE_URL}web-features-worker.js`;
// The machine that runs an Android emulator, as the emulator reaches it: no loopback address to its web view.
const EMULATOR_HOST = '10.0.2.2';

const report = (name, value) => console.log(`PAGE GETS ${name} ${JSON.stringify(value)}`);
const failure = (error) => `error: ${error?.name ?? 'Error'}: ${error?.message ?? error}`;

// What run answers, or why it failed, or that it gave no answer in time.
function settled(run) {
    let timer;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve('error: no answer in time'), ANSWER_TIMEOUT_MS);
    });
    return Promise.race([Promise.resolve().then(run).catch(failure), late]).finally(() => clearTimeout(timer));
}

async function useOpfs() {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle('page-gets.txt', { create: true });
    await root.removeEntry('page-gets.txt');
    return 'ok';
}

function openIndexedDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('page-gets');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            request.result.close();
            indexedDB.deleteDatabase('page-gets');
            resolve('ok');
        };
    });
}

function askWorker(options) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_URL, options);
        worker.onmessage = ({ data }) => {
            worker.terminate();
            resolve(data);
        };
        worker.onerror = (event) => {
            worker.terminate();
            reject(new Error(event.message || 'the worker did not load'));
        };
    });
}

// The page's own JavaScript, which runs about thirty times slower where the engine interprets it.
function timeLoop() {
    const ms = [];
    let value = 0;
    for (let run = 0; run < LOOP_RUNS; run += 1) {
        const start = performance.now();
        let sum = 0;
        for (let i = 0; i < LOOP_ITERATIONS; i += 1) sum += Math.sqrt(i) * 0.5;
        ms.push(Math.round((performance.now() - start) * 10) / 10);
        value = Math.round(sum);
    }
    const sorted = [...ms].sort((a, b) => a - b);
    return { ms, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], value };
}

async function fetchText(url) {
    const response = await fetch(url);
    return `${response.status} ${await response.text()}`;
}

function openSocket(url) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.onmessage = ({ data }) => {
            socket.close();
            resolve(`message ${data}`);
        };
        socket.onerror = () => reject(new Error('the socket failed'));
    });
}

// The run's address on its machine's network, which the probe reads from the app's environment.
function networkHost(isAndroid) {
    if (isAndroid) return device.isVirtual ? EMULATOR_HOST : null;
    return invoke('probe.networkAddress');
}

export async function reportWebFeatures(isAndroid) {
    report('page', {
        origin: location.origin,
        userAgent: navigator.userAgent,
        isSecureContext: globalThis.isSecureContext,
        crossOriginIsolated: globalThis.crossOriginIsolated,
        getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
        clipboard: typeof navigator.clipboard?.readText,
        gpu: typeof navigator.gpu,
        serviceWorker: 'serviceWorker' in navigator,
        hardwareConcurrency: navigator.hardwareConcurrency,
    });
    report('webassembly', await settled(() => WebAssembly.instantiate(EMPTY_MODULE).then(() => 'ok')));
    report('opfs', await settled(useOpfs));
    report('indexeddb', await settled(openIndexedDb));
    report('subtle', await settled(() => crypto.subtle.digest('SHA-256', EMPTY_MODULE).then(() => 'ok')));
    report('locks', await settled(() => navigator.locks.request('page-gets', () => 'ok')));
    report('worker-classic', await settled(() => askWorker()));
    report('worker-module', await settled(() => askWorker({ type: 'module' })));
    report('js-loop', timeLoop());
    const hosts = { loopback: '127.0.0.1', network: await settled(() => networkHost(isAndroid)) };
    for (const [name, host] of Object.entries(hosts)) {
        if (!host || host.startsWith('error')) {
            report(`reach-${name}`, `not tried: no address (${host})`);
            continue;
        }
        const at = `${host}:${REACH_PORT}`;
        report(`http-${name}`, { url: `http://${at}/reach`, result: await settled(() => fetchText(`http://${at}/reach`)) });
        report(`ws-${name}`, { url: `ws://${at}/reach`, result: await settled(() => openSocket(`ws://${at}/reach`)) });
    }
}
