import { initNative, greet, add } from './native/native.h';

await initNative();

console.log(await greet('crossbind'));
console.log('2 + 3 =', await add(2, 3));
