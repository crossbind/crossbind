import { DEMOS } from '../demos.js';

// The home page runs its demos itself rather than framing them: the demo build leaves a generated
// loader and a .wasm under /examples/<id>/dist, and this module fetches that pair on demand and
// hands back the booted module, so results render in the site's own markup.
//
// Nothing here runs until a visitor asks for it. A demo that was not built simply has no entry,
// and the sections that use it render without their run controls.

const booted = new Map();
let queue = Promise.resolve();

function injectScript(source) {
    return new Promise((resolve, reject) => {
        const element = document.createElement('script');
        element.src = source;
        element.async = true;
        element.addEventListener('load', () => resolve());
        element.addEventListener('error', () => reject(new Error(`could not load ${source}`)));
        document.head.append(element);
    });
}

export const liveDemo = (id) => DEMOS.get(id) ?? null;
export const isLive = (id) => Boolean(DEMOS.get(id)?.script);

// Every generated loader publishes the same global name, so two artifacts must never be in flight
// together; each load waits for the one before it and keeps its own module afterwards.
export function loadDemo(id) {
    const demo = liveDemo(id);
    if (!demo?.script) return Promise.reject(new Error('this demo was not built into the site'));
    if (!booted.has(id)) {
        const ready = queue.then(async () => {
            await injectScript(demo.script);
            const initNative = globalThis.Crossbind?.initNative ?? globalThis.initNative;
            if (typeof initNative !== 'function') throw new Error('the demo loader did not publish initNative');
            return initNative({ path: demo.path });
        });
        queue = ready.then(
            () => undefined,
            () => undefined,
        );
        booted.set(id, ready);
    }
    return booted.get(id);
}
