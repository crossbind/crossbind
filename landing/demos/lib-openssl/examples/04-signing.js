export const title = 'Generate a key, sign and verify';
export const summary = 'EVP_PKEY_Q_keygen makes a key pair, PEM_write_bio_PUBKEY exports its public half, EVP_DigestSign signs and EVP_DigestVerify checks with nothing but that PEM. The same calls sign with ECDSA P-256, Ed25519 and ML-DSA-65, the post-quantum signature of FIPS 204. Keys are random, so the example prints what stays the same: sizes, strength and the verdicts.';
export const native = 'signing.h';
export const expected = [
    'P-256: EC, 128-bit security, signatures up to 72 bytes, valid true, altered message false',
    'ED25519: ED25519, 128-bit security, signatures up to 64 bytes, valid true, altered message false',
    'ML-DSA-65: ML-DSA-65, 192-bit security, signatures up to 3309 bytes, valid true, altered message false',
];

export default async function example({ KeyPair }, console) {
    const message = 'release 2.4.0, sha256 3a985da74fe225b2';
    for (const algorithm of ['P-256', 'ED25519', 'ML-DSA-65']) {
        const key = await new KeyPair(algorithm);
        const publicKey = await key.publicKeyPem();
        const signature = await key.sign(message);
        const valid = await KeyPair.verify(publicKey, message, signature);
        const altered = await KeyPair.verify(publicKey, message.replace('2.4.0', '2.4.1'), signature);
        const size = await key.maxSignatureSize();
        console.log(`${algorithm}: ${await key.type()}, ${await key.securityBits()}-bit security, signatures up to ${size} bytes, valid ${valid}, altered message ${altered}`);
    }
}
