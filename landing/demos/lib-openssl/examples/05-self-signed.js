export const title = 'Make a self-signed certificate for localhost';
export const summary = 'The most asked OpenSSL question, answered in C++: X509_new, a random serial, X509V3_EXT_conf_nid for the subjectAltName browsers match, and X509_sign with the key it certifies, the fields `openssl req -x509 -addext subjectAltName=...` writes. The key comes from the signing example, and the certificate example reads the result back.';
export const native = 'self_signed.h';
export const expected = [
    '-----BEGIN CERTIFICATE-----',
    'CN=localhost DNS:localhost, IP Address:127.0.0.1',
    'valid 2026-01-01 00:00:00Z to 2027-01-01 00:00:00Z',
    'EC prime256v1 256 bits, self-signed true',
    'localhost true',
    'example.com false',
];

export default async function example({ SelfSigned, KeyPair, Certificate }, console) {
    const key = await new KeyPair('P-256');
    const pem = await SelfSigned.create(await key.privateKeyPem(), 'localhost', 'DNS:localhost,IP:127.0.0.1', '20260101000000Z', '20270101000000Z');
    console.log(pem.split('\n')[0]);

    const cert = await new Certificate(pem);
    console.log(await cert.subject(), await cert.altNames());
    console.log('valid', await cert.notBefore(), 'to', await cert.notAfter());
    console.log(`${await cert.keyType()} ${await cert.keyBits()} bits, self-signed ${await cert.selfSigned()}`);
    for (const host of ['localhost', 'example.com']) console.log(host, await cert.covers(host));
}
