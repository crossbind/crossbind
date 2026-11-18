import { initNative, Block } from './native/native.h';

await initNative();

const first = await new Block(64);
const second = await new Block(8);
console.log('alive:', await Block.alive());

await first.delete();
console.log('after delete:', await Block.alive());
console.log('still there:', await second.megabytes(), 'MB');
