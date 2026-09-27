export const title = 'Hash and HMAC';
export const summary = 'EVP_Q_digest hashes data already in memory with any digest by name, EVP_DigestUpdate takes it in pieces as a file or a download arrives, and EVP_Q_mac makes the HMAC that webhook and API request signatures use. WebCrypto stops at SHA-1 and SHA-2; SHA-3 and BLAKE2 come from OpenSSL here. Every line is the published test vector of its standard.';
export const native = 'hashing.h';
export const expected = [
    'SHA256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'SHA3-256 3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
    'BLAKE2B-512 ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    'HMAC-SHA256 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    'streamed SHA256 cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
];

export default async function example({ Digest }, console) {
    for (const algorithm of ['SHA256', 'SHA3-256', 'BLAKE2B-512']) console.log(algorithm, await Digest.of(algorithm, 'abc'));
    console.log('HMAC-SHA256', await Digest.hmac('SHA256', 'Jefe', 'what do ya want for nothing?'));

    // A million "a" in ten pieces, the way a file arrives.
    const digest = await new Digest('SHA256');
    for (let piece = 0; piece < 10; piece += 1) await digest.update('a'.repeat(100000));
    console.log('streamed SHA256', await digest.hex());
}
