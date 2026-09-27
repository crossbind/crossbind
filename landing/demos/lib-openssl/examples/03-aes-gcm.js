export const title = 'Encrypt and authenticate with AES-256-GCM';
export const summary = 'EVP_CipherInit_ex2 with AES-256-GCM encrypts and authenticates in one pass; EVP_CTRL_AEAD_GET_TAG reads the 16-byte tag, and with EVP_CTRL_AEAD_SET_TAG decryption refuses anything that changed, including the associated data that travels in the clear. The output is ciphertext then tag, the layout WebCrypto reads.';
export const native = 'aes_gcm.h';
export const expected = [
    'ciphertext 78b3da886495443e7a46341982c948837dbf7b3510d774e5072034',
    'tag 4f8c8f6e9e6177f201ed83f957fbe6d7',
    'meet at the north gate at 7',
    'refused: std::runtime_error: authentication failed: wrong key, nonce or AAD, or the data was changed',
];

export default async function example({ AesGcm }, console) {
    // A fixed test key and nonce, so the output repeats. Use 32 random bytes as the key, and never
    // use a nonce twice with it.
    const gcm = await new AesGcm('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const nonce = '000000000000000000000001';
    const sealed = await gcm.encrypt(nonce, 'meet at the north gate at 7', 'message-1');
    console.log('ciphertext', sealed.slice(0, -32));
    console.log('tag', sealed.slice(-32));
    console.log(await gcm.decrypt(nonce, sealed, 'message-1'));
    try {
        await gcm.decrypt(nonce, sealed, 'message-2');
    } catch (error) {
        console.log('refused:', error.message);
    }
}
