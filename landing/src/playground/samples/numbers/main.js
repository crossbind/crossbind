import {
    initNative, average, isEven, fibonacci,
} from './native/native.h';

await initNative();

console.log('average:', await average(3, 4));
console.log('is 10 even?', await isEven(10));

// A Number is exact up to 2^53; the BigInt keeps every digit.
const big = await fibonacci(90);
console.log(`fibonacci(90) = ${big}`);
console.log(`as a Number:    ${Number(big)}`);
