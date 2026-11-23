import { initNative, add, sumTo } from './native/native.h';

await initNative();
const count = 50_000;
const since = (start) => Math.round(performance.now() - start);

let start = performance.now();
let sum = 0;
for (let i = 1; i <= count; i += 1) sum = await add(sum, i);
console.log('a call each:', since(start), 'ms');

start = performance.now();
sum = await sumTo(count);
console.log('one call:', since(start), 'ms, sum', sum);
