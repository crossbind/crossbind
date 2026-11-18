// Spike: Windows' origin for a project, http://<key>.localhost/, which the host answers through WebResourceRequested from
// the page's own files. What the page gets there, its storage apart, plain http and ws to the network, what escapes
// the host, and a call of the app's functions with its bytes through /__crossbind/b/. Each line goes to the app's output
// as "SPIKE <host> <name> <json>". ?run=k1 goes on to k2, and ?run=k2 back to the app's own origin.
(() => {
    const REACH_PORT = 47831;
    const ANSWER_TIMEOUT_MS = 5000;
    const LOOP_RUNS = 4;
    const LOOP_ITERATIONS = 30000000;
    const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    // crossbind's codec's tag, as core/app-host/js/codec.js names it.
    const TAG = '\u0001t';
    const query = new URLSearchParams(location.search);
    const run = query.get('run');
    const net = query.get('net');
    const out = document.getElementById('out');

    const report = (name, value) => {
        const line = `SPIKE ${location.host} ${name} ${JSON.stringify(value)}`;
        console.log(line);
        out.textContent += `\n${line}`;
    };
    const failure = (error) => `error: ${error?.name ?? 'Error'}: ${error?.message ?? error}`;

    function settled(fn, ms = ANSWER_TIMEOUT_MS) {
        let timer;
        const late = new Promise((resolve) => {
            timer = setTimeout(() => resolve('error: no answer in time'), ms);
        });
        return Promise.race([Promise.resolve().then(fn).catch(failure), late]).finally(() => clearTimeout(timer));
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
            const worker = new Worker('/web-features-worker.js', options);
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

    function timeLoop() {
        const ms = [];
        for (let i = 0; i < LOOP_RUNS; i += 1) {
            const start = performance.now();
            let sum = 0;
            for (let j = 0; j < LOOP_ITERATIONS; j += 1) sum += Math.sqrt(j) * 0.5;
            ms.push(Math.round((performance.now() - start) * 10) / 10);
            if (sum < 0) ms.push(sum);
        }
        return { ms, best: Math.min(...ms) };
    }

    async function fetchText(url, init) {
        const response = await fetch(url, init);
        return `${response.status} ${(await response.text()).slice(0, 120)}`;
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

    // 1. What the page gets at the key's origin.
    async function pageGets() {
        report('page', {
            origin: location.origin,
            userAgent: navigator.userAgent,
            isSecureContext: globalThis.isSecureContext,
            crossOriginIsolated: globalThis.crossOriginIsolated,
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
    }

    // 3. Plain http and ws to the machine's loopback and to its address on its network.
    async function reach() {
        for (const [name, host] of Object.entries({ loopback: '127.0.0.1', network: net })) {
            if (!host) {
                report(`reach-${name}`, 'not tried: no address');
                continue;
            }
            const at = `${host}:${REACH_PORT}`;
            report(`http-${name}`, { url: `http://${at}/reach`, result: await settled(() => fetchText(`http://${at}/reach?from=${location.host}`)) });
            report(`ws-${name}`, { url: `ws://${at}/reach`, result: await settled(() => openSocket(`ws://${at}/reach?from=${location.host}`)) });
        }
    }

    function openMarks() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('spike', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('marks');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // 2. What this origin holds of every key's marks.
    async function seen() {
        const db = await openMarks();
        const keys = await new Promise((resolve, reject) => {
            const all = db.transaction('marks').objectStore('marks').getAllKeys();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => reject(all.error);
        });
        db.close();
        const files = [];
        try {
            for await (const name of (await navigator.storage.getDirectory()).keys()) files.push(name);
        } catch (error) {
            files.push(failure(error));
        }
        return { indexedDB: keys, opfs: files, localStorage: Object.keys(localStorage), cookie: document.cookie };
    }

    async function leaveMarks(key) {
        const db = await openMarks();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction('marks', 'readwrite');
            transaction.objectStore('marks').put(true, key);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
        await (await navigator.storage.getDirectory()).getFileHandle(`mark-${key}`, { create: true });
        localStorage.setItem(`mark-${key}`, '1');
        document.cookie = `mark-${key}=1; path=/; max-age=3600`;
    }

    function cookiesForLocalhost() {
        const tried = {};
        for (const domain of ['localhost', '.localhost']) {
            const name = `shared${domain.length}`;
            document.cookie = `${name}=1; domain=${domain}; path=/; max-age=3600`;
            tried[`domain=${domain}`] = document.cookie.includes(`${name}=1`) ? 'kept' : 'refused';
        }
        return tried;
    }

    // 4. A service worker of this origin: whose script it runs, what it answers for the page, and where its own fetches go.
    async function serviceWorker() {
        const registration = await navigator.serviceWorker.register('/spike/sw.js', { scope: '/spike/' });
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        await new Promise((resolve) => {
            if (worker.state === 'activated') resolve();
            else worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
        });
        if (!navigator.serviceWorker.controller) {
            await new Promise((resolve) => {
                navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
            });
        }
        const underWorker = await settled(() => fetchText('/spike/under-sw.txt'));
        const fetched = await new Promise((resolve) => {
            navigator.serviceWorker.addEventListener('message', (event) => resolve(event.data), { once: true });
            worker.postMessage({ urls: [`${location.origin}/spike/from-sw.txt`, `http://127.0.0.1:${REACH_PORT}/from-sw?from=${location.host}`] });
        });
        await registration.unregister();
        return { scriptUrl: worker.scriptURL, underWorker, fetched };
    }

    async function escapes() {
        report('ws-own-origin', await settled(() => openSocket(`ws://${location.host}/escape`)));
        report('service-worker', await settled(serviceWorker, 10000));
    }

    // 5. The window's token, which the host's script gave this origin's top frame, and the app's functions through it: a
    // message, a frame of bytes to /__crossbind/b/frame and a large result from /__crossbind/b/result.
    async function calls() {
        const token = globalThis.__crossbind_token;
        report('token', { token: typeof token, length: token?.length, device: globalThis.__crossbind_device?.platform ?? null });
        if (typeof token !== 'string') return;
        const send = (message) => window.webkit.messageHandlers.crossbind.postMessage(token + JSON.stringify(message));
        report('call-message', await settled(() => send(['app', 1, ['probe.fromPage'], [{}, 0]])));
        const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
        const text = JSON.stringify(['app', 2, ['probe.bytes'], [{ data: { [TAG]: 'att', i: 0 } }, 0]]);
        const framed = `${text.slice(0, -1)},${JSON.stringify([['Uint8Array', bytes.byteLength]])}]`;
        report('call-frame', await settled(async () => {
            const reply = await fetchText(`${location.origin}/__crossbind/b/frame?m=${encodeURIComponent(framed)}&t=${token}`, { method: 'POST', body: bytes });
            return reply.slice(0, 60);
        }));
        report('call-result', await settled(async () => {
            const [failed, value] = JSON.parse(await send(['app', 3, ['probe.bigBytes'], [{}, 0]]));
            if (failed || value?.[TAG] !== 'big') return `no large result: ${JSON.stringify(value).slice(0, 80)}`;
            const response = await fetch(`${location.origin}/__crossbind/b/result?id=${value.v}&t=${token}`);
            const got = new Uint8Array(await response.arrayBuffer());
            return `${response.status} ${got.length} bytes, ${got.every((byte, i) => byte === i % 251) ? 'as sent' : 'not as sent'}`;
        }));
        report('call-without-token', await settled(() => fetchText(`${location.origin}/__crossbind/b/result?id=1&t=0`)));
    }

    async function main() {
        report('start', { href: location.href });
        if (run === 'k1') {
            await pageGets();
            await reach();
            report('marks-seen', await seen());
            await leaveMarks('k1');
            report('cookies-for-localhost', cookiesForLocalhost());
            report('marks-left', await seen());
            await escapes();
            await calls();
            location.assign(`http://k2.localhost/spike/index.html?run=k2&net=${encodeURIComponent(net ?? '')}`);
        } else if (run === 'k2') {
            await pageGets();
            report('marks-seen', await seen());
            await leaveMarks('k2');
            report('marks-left', await seen());
            await escapes();
            await calls();
            location.assign('crossbind://app/?spike=back');
        }
    }

    main().catch((error) => report('failed', failure(error)));
})();
