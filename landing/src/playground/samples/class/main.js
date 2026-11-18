import { initNative, Counter } from './native/native.h';

await initNative();

const counter = await new Counter(41);
await counter.increment();
console.log('the counter is at', await counter.value());
