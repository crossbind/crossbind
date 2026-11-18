import {
    initNative, compressedSize, zstdVersion,
} from './native/native.h';

await initNative();

const text = 'crossbind '.repeat(100);
console.log('zstd', await zstdVersion());
const packed = await compressedSize(text);
console.log(text.length, 'bytes become', packed);
