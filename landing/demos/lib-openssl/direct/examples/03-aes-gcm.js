export const imports = {
    '@crossbind/port-openssl/openssl/evp.h': [
        'EVP_CIPHER_fetch',
        'EVP_CIPHER_free',
        'EVP_CIPHER_CTX_new',
        'EVP_CIPHER_CTX_free',
        'EVP_CipherInit_ex2',
        'EVP_CipherUpdate',
        'EVP_EncryptUpdate',
        'EVP_EncryptFinal_ex',
        'EVP_DecryptUpdate',
        'EVP_DecryptFinal_ex',
        'EVP_CIPHER_CTX_ctrl',
        'allocBuffer',
        'writeBytes',
        'readBytes',
    ],
    '@crossbind/port-openssl/openssl/crypto.h': ['OPENSSL_cleanse'],
};
export const note = 'The same `EVP_Cipher*` calls as the C++. `EVP_CTRL_AEAD_GET_TAG` and `EVP_CTRL_AEAD_SET_TAG` are macros and have no binding, so their values are written out. There is no C++ exception to catch: JavaScript throws its own `Error` when `EVP_DecryptFinal_ex` refuses the tag, so the last line loses the `std::runtime_error: ` prefix the C++ version prints.';
export const expected = [
    'ciphertext 78b3da886495443e7a46341982c948837dbf7b3510d774e5072034',
    'tag 4f8c8f6e9e6177f201ed83f957fbe6d7',
    'meet at the north gate at 7',
    'refused: authentication failed: wrong key, nonce or AAD, or the data was changed',
];

export default async function example({ EVP_CIPHER_fetch, EVP_CIPHER_free, EVP_CIPHER_CTX_new, EVP_CIPHER_CTX_free, EVP_CipherInit_ex2, EVP_CipherUpdate, EVP_EncryptUpdate, EVP_EncryptFinal_ex, EVP_DecryptUpdate, EVP_DecryptFinal_ex, EVP_CIPHER_CTX_ctrl, allocBuffer, writeBytes, readBytes, OPENSSL_cleanse }, console) {
    // Macros in evp.h have no binding; these are their values.
    const EVP_CTRL_AEAD_GET_TAG = 0x10;
    const EVP_CTRL_AEAD_SET_TAG = 0x11;
    const bytes = async (text) => {
        const buffer = await allocBuffer(text.length);
        await writeBytes(buffer, text);
        return buffer;
    };
    const fromHex = (hex) => hex.replace(/../g, (pair) => String.fromCharCode(parseInt(pair, 16)));
    const toHex = (text) => [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

    // A fixed test key and nonce, so the output repeats. Use 32 random bytes as the key, and never
    // use a nonce twice with it.
    const key = await bytes(fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'));
    const nonce = await bytes(fromHex('000000000000000000000001'));
    const cipher = await EVP_CIPHER_fetch(null, 'AES-256-GCM', null);
    const written = await allocBuffer(4);
    // A context for the key and nonce, 1 to encrypt or 0 to decrypt, that has taken the AAD:
    // authenticated, not encrypted.
    const start = async (encrypting, aad) => {
        const context = await EVP_CIPHER_CTX_new();
        await EVP_CipherInit_ex2(context, cipher, key, nonce, encrypting, null);
        await EVP_CipherUpdate(context, null, written, await bytes(aad), aad.length);
        return context;
    };

    // GCM writes as many bytes as it reads and EVP_EncryptFinal_ex adds none; the tag comes apart.
    const message = 'meet at the north gate at 7';
    const ciphertext = await allocBuffer(message.length);
    const tag = await allocBuffer(16);
    const encryption = await start(1, 'message-1');
    await EVP_EncryptUpdate(encryption, ciphertext, written, await bytes(message), message.length);
    await EVP_EncryptFinal_ex(encryption, ciphertext, written);
    await EVP_CIPHER_CTX_ctrl(encryption, EVP_CTRL_AEAD_GET_TAG, 16, tag);
    await EVP_CIPHER_CTX_free(encryption);
    console.log('ciphertext', toHex(await readBytes(ciphertext, message.length)));
    console.log('tag', toHex(await readBytes(tag, 16)));

    // Decryption refuses a changed byte anywhere in the ciphertext, the tag, the nonce or the AAD.
    const decrypt = async (aad) => {
        const plaintext = await allocBuffer(message.length);
        const decryption = await start(0, aad);
        await EVP_DecryptUpdate(decryption, plaintext, written, ciphertext, message.length);
        await EVP_CIPHER_CTX_ctrl(decryption, EVP_CTRL_AEAD_SET_TAG, 16, tag);
        const authentic = (await EVP_DecryptFinal_ex(decryption, plaintext, written)) === 1;
        await EVP_CIPHER_CTX_free(decryption);
        if (!authentic) {
            await OPENSSL_cleanse(plaintext, message.length);
            throw new Error('authentication failed: wrong key, nonce or AAD, or the data was changed');
        }
        return readBytes(plaintext, message.length);
    };
    console.log(await decrypt('message-1'));
    try {
        await decrypt('message-2');
    } catch (error) {
        console.log('refused:', error.message);
    }
    await EVP_CIPHER_free(cipher);
    await OPENSSL_cleanse(key, 32);
}
