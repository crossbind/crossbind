import {
    initNative, countdown, applyTwice, releaseCallback,
} from './native/native.h';

// A function cannot cross into a worker: use the page thread.
await initNative({ useWorker: false });

const tick = (value) => console.log('tick', value);
const timesTen = (value) => value * 10;

await countdown(3, tick);
console.log('applied twice:', await applyTwice(timesTen, 4));

// Each function passed to C++ holds a slot until it is released.
await releaseCallback(tick);
await releaseCallback(timesTen);
