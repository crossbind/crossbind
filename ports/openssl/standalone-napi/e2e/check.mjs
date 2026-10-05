import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import {
    initNative, OpenSSL_version, OPENSSL_VERSION, AllSymbols, OPENSSL_VERSION_STR, EVP_Digest, EVP_sha256, HMAC,
    RAND_bytes,
} from '@crossbind/port-openssl-standalone-napi';

await initNative();

// The expected values come from elsewhere: the version from package.json, the digests from Node's own crypto.
const SHA256_BYTES = 32;
const { allocBuffer, writeBuffer, readBuffer, readNumberAt } = AllSymbols;
const data = Buffer.from('hello crossbind');
const key = Buffer.from('key');
const bufferOf = (bytes) => {
    const buffer = allocBuffer(bytes.length);
    writeBuffer(buffer, bytes);
    return buffer;
};
const hexOf = (buffer) => Buffer.from(readBuffer(buffer, SHA256_BYTES)).toString('hex');

const digest = allocBuffer(SHA256_BYTES);
const digestLength = allocBuffer(4);
assert.equal(EVP_Digest(bufferOf(data), data.length, digest, digestLength, EVP_sha256(), null), 1);
assert.equal(readNumberAt(digestLength, 0, 'uint32'), SHA256_BYTES);
assert.equal(hexOf(digest), createHash('sha256').update(data).digest('hex'));

const mac = allocBuffer(SHA256_BYTES);
assert.ok(HMAC(EVP_sha256(), bufferOf(key), key.length, bufferOf(data), data.length, mac, allocBuffer(4)));
assert.equal(hexOf(mac), createHmac('sha256', key).update(data).digest('hex'));
assert.equal(RAND_bytes(allocBuffer(16), 16), 1);

assert.equal(OPENSSL_VERSION_STR, process.env.NATIVE_VERSION);
assert.ok(OpenSSL_version(OPENSSL_VERSION).startsWith(`OpenSSL ${process.env.NATIVE_VERSION} `));
assert.equal(createRequire(import.meta.url)('@crossbind/port-openssl-standalone-napi').EVP_Digest, EVP_Digest);
console.log(`ok: ${OpenSSL_version(OPENSSL_VERSION)} on ${process.platform}-${process.arch}`);
