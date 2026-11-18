import {
    initNative, zlibVersion, compressBound,
} from 'conan:zlib/zlib.h';

await initNative();

console.log('zlib', await zlibVersion());

const size = 1000;
console.log(size, 'bytes pack into', await compressBound(size));
