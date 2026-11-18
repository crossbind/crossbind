import { initNative, slowSum } from './native/native.h';

await initNative();

let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 1);

const sum = await slowSum(30_000_000);
clearInterval(timer);

console.log('sum:', Math.round(sum));
console.log('timer ticks while C++ ran:', ticks);
