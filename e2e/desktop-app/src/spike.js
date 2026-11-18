// Spike: the app's own page, crossbind://app/, before and after the keys' origins: what it gets there, and what it holds
// of their marks, which it must not see. It goes to http://k1.localhost/spike/ first, and prints SPIKE done once back.
import { invoke } from 'crossbind/app';
import { initNative } from '@crossbind/conformance/native/confconstants.h';
import { reportWebFeatures } from './web-features.js';

const report = (name, value) => console.log(`SPIKE ${location.host} ${name} ${JSON.stringify(value)}`);
const failure = (error) => `error: ${error?.name ?? 'Error'}: ${error?.message ?? error}`;

function openMarks() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('spike', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('marks');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

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

export async function runSpike() {
    const stage = new URLSearchParams(location.search).get('spike');
    report('start', { href: location.href, stage });
    if (stage === 'back') {
        report('marks-seen', await seen().catch(failure));
        console.log('SPIKE done');
        return;
    }
    await reportWebFeatures(false);
    report('marks-seen', await seen().catch(failure));
    // invoke() waits for initNative(), which loads the page's crossbind.js.
    let net = null;
    try {
        await initNative();
        net = await invoke('probe.networkAddress');
    } catch (error) {
        report('network-address', failure(error));
    }
    report('network-address', net);
    location.assign(`http://k1.localhost/spike/index.html?run=k1&net=${encodeURIComponent(net ?? '')}`);
}
