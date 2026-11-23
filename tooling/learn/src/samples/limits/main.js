import {
    initNative, largerInt, describe,
} from './native/native.h';

await initNative();

console.log('the larger:', await largerInt(3, 7));
console.log(await describe(7));
console.log(await describe(7, 'km'));
try {
    console.log(await describe('seven'));
} catch (error) {
    console.log(error.message);
}
