import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import initNative from '../dist/crossbind-e2e-backend-nodejs-native-conan.native.cjs';

const { ConanApp } = await initNative();
const source = fileURLToPath(import.meta.url);
const verdict = (isPassing, actual) => (isPassing ? 'PASS' : `FAIL ${JSON.stringify(actual).slice(0, 200)}`);

const formatted = ConanApp.format(Math.PI);
const formatError = ConanApp.formatError();
const fetched = ConanApp.fetch(pathToFileURL(source).href);

console.log(`zlib ${ConanApp.zlib()}`);
console.log(`libpng ${ConanApp.libpng()}`);
console.log(`libcurl ${ConanApp.libcurl()}`);
console.log(`crc32: ${verdict(ConanApp.crc32('crossbind') === crc32('crossbind'), ConanApp.crc32('crossbind'))}`);
console.log(`fmt: ${verdict(formatted === '3.14', formatted)}`);
console.log(`exceptions: ${verdict(formatError.startsWith('format_error: '), formatError)}`);
console.log(`file fetch: ${verdict(fetched === readFileSync(source, 'utf8'), fetched)}`);
