import { initNative, greet } from './native/greet.h';
import { fibonacci } from './native/math.rs';

await initNative();

console.log(await greet('crossbind'));
console.log(await fibonacci(90));
