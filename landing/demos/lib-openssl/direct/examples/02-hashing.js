export const imports = {
    '@crossbind/port-openssl/openssl/evp.h': [
        'EVP_Q_digest',
        'EVP_Q_mac',
        'EVP_MD_fetch',
        'EVP_MD_free',
        'EVP_MD_CTX_new',
        'EVP_MD_CTX_free',
        'EVP_DigestInit_ex2',
        'EVP_DigestUpdate',
        'EVP_DigestFinal_ex',
        'allocBuffer',
        'writeBytes',
        'readBytes',
        'readNumberAt',
    ],
};
export const note = '`EVP_Q_digest`, `EVP_Q_mac` and the `EVP_Digest*` calls work as in C. Their data parameters are `const void *` or `const unsigned char *`, which take a handle and not a string (and `const unsigned char *` refuses a `cstring` handle as a pointer type mismatch), so text goes in through `allocBuffer` and `writeBytes`. The digest length comes back through a 4-byte out-parameter, read with `readNumberAt`.';
export const expected = [
    'SHA256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'SHA3-256 3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
    'BLAKE2B-512 ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    'HMAC-SHA256 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    'streamed SHA256 cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
];

export default async function example({ EVP_Q_digest, EVP_Q_mac, EVP_MD_fetch, EVP_MD_free, EVP_MD_CTX_new, EVP_MD_CTX_free, EVP_DigestInit_ex2, EVP_DigestUpdate, EVP_DigestFinal_ex, allocBuffer, writeBytes, readBytes, readNumberAt }, console) {
    // Data goes in as a buffer, one character per byte.
    const bytes = async (text) => {
        const buffer = await allocBuffer(text.length);
        await writeBytes(buffer, text);
        return buffer;
    };
    // Room for the longest digest, and for the length OpenSSL writes back (4 bytes in wasm32).
    const digest = await allocBuffer(64);
    const size = await allocBuffer(4);
    const hex = async () => {
        const value = await readBytes(digest, await readNumberAt(size, 0, 'uint32'));
        return [...value].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    };

    const abc = await bytes('abc');
    for (const algorithm of ['SHA256', 'SHA3-256', 'BLAKE2B-512']) {
        if (!(await EVP_Q_digest(null, algorithm, null, abc, 3, digest, size))) throw new Error(`unknown digest ${algorithm}`);
        console.log(algorithm, await hex());
    }
    const key = 'Jefe';
    const data = 'what do ya want for nothing?';
    await EVP_Q_mac(null, 'HMAC', null, 'SHA256', null, await bytes(key), key.length, await bytes(data), data.length, digest, 64, size);
    console.log('HMAC-SHA256', await hex());

    // A million "a" in ten pieces, the way a file arrives.
    const md = await EVP_MD_fetch(null, 'SHA256', null);
    const context = await EVP_MD_CTX_new();
    await EVP_DigestInit_ex2(context, md, null);
    await EVP_MD_free(md);
    const piece = await bytes('a'.repeat(100000));
    for (let i = 0; i < 10; i += 1) await EVP_DigestUpdate(context, piece, 100000);
    await EVP_DigestFinal_ex(context, digest, size);
    await EVP_MD_CTX_free(context);
    console.log('streamed SHA256', await hex());
}
