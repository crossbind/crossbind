import {
    initNative, invert, checksum,
    allocBuffer, writeBuffer, readBuffer,
} from './native/native.h';

await initNative();

const pixels = await allocBuffer(4);
await writeBuffer(pixels, new Uint8Array([0, 64, 128, 255]));

await invert(pixels, 4);
console.log([...await readBuffer(pixels, 4)]);
console.log('checksum:', await checksum(pixels, 4));
