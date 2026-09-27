export const imports = {
    '@crossbind/port-openssl/openssl/x509.h': [
        'X509_new',
        'X509_free',
        'X509_set_version',
        'X509_get_serialNumber',
        'X509_NAME_new',
        'X509_NAME_free',
        'X509_NAME_add_entry_by_txt',
        'X509_set_subject_name',
        'X509_set_issuer_name',
        'X509_getm_notBefore',
        'X509_getm_notAfter',
        'X509_set_pubkey',
        'X509_add_ext',
        'X509_EXTENSION_free',
        'X509_sign',
        'X509_get_subject_name',
        'X509_NAME_print_ex',
        'X509_get_ext_by_NID',
        'X509_get_ext',
        'X509_get0_notBefore',
        'X509_get0_notAfter',
        'X509_get0_pubkey',
        'X509_self_signed',
    ],
    '@crossbind/port-openssl/openssl/x509v3.h': ['v3_ext_ctx', 'X509V3_set_ctx', 'X509V3_EXT_conf_nid', 'X509V3_EXT_print', 'X509_check_host'],
    '@crossbind/port-openssl/openssl/asn1.h': ['BN_to_ASN1_INTEGER', 'ASN1_TIME_set_string_X509', 'ASN1_TIME_print_ex'],
    '@crossbind/port-openssl/openssl/bn.h': ['BN_new', 'BN_rand', 'BN_free'],
    '@crossbind/port-openssl/openssl/evp.h': [
        'EVP_PKEY_CTX_new_from_name',
        'EVP_PKEY_keygen_init',
        'EVP_PKEY_CTX_set_group_name',
        'EVP_PKEY_generate',
        'EVP_PKEY_CTX_free',
        'EVP_PKEY_free',
        'EVP_PKEY_get0_type_name',
        'EVP_PKEY_get_group_name',
        'EVP_PKEY_get_bits',
        'EVP_sha256',
        'allocBuffer',
        'allocPointer',
        'readPointerAt',
        'writeBytes',
        'readBytes',
        'readCString',
    ],
    '@crossbind/port-openssl/openssl/pem.h': ['PEM_write_bio_X509', 'PEM_read_bio_X509'],
    '@crossbind/port-openssl/openssl/bio.h': ['BIO_new', 'BIO_s_mem', 'BIO_puts', 'BIO_ctrl_pending', 'BIO_read', 'BIO_free'],
};
export const note = 'Every call the C++ makes is reachable. `X509V3_CTX` is a struct that crossbind binds as the class `v3_ext_ctx`: JavaScript creates one and `X509V3_set_ctx` fills it in C, which the subject key identifier needs (without it `X509V3_EXT_conf_nid` returns null). The key is used as generated rather than passed in as PEM, and macros such as `X509_VERSION_3` and `MBSTRING_UTF8` are written out as numbers.';
export const expected = [
    '-----BEGIN CERTIFICATE-----',
    'CN=localhost DNS:localhost, IP Address:127.0.0.1',
    'valid 2026-01-01 00:00:00Z to 2027-01-01 00:00:00Z',
    'EC prime256v1 256 bits, self-signed true',
    'localhost true',
    'example.com false',
];

export default async function example({ X509_new, X509_free, X509_set_version, X509_get_serialNumber, X509_NAME_new, X509_NAME_free, X509_NAME_add_entry_by_txt, X509_set_subject_name, X509_set_issuer_name, X509_getm_notBefore, X509_getm_notAfter, X509_set_pubkey, X509_add_ext, X509_EXTENSION_free, X509_sign, X509_get_subject_name, X509_NAME_print_ex, X509_get_ext_by_NID, X509_get_ext, X509_get0_notBefore, X509_get0_notAfter, X509_get0_pubkey, X509_self_signed, allocBuffer, allocPointer, readPointerAt, writeBytes, readBytes, readCString, v3_ext_ctx, X509V3_set_ctx, X509V3_EXT_conf_nid, X509V3_EXT_print, X509_check_host, BN_to_ASN1_INTEGER, ASN1_TIME_set_string_X509, ASN1_TIME_print_ex, BN_new, BN_rand, BN_free, EVP_PKEY_CTX_new_from_name, EVP_PKEY_keygen_init, EVP_PKEY_CTX_set_group_name, EVP_PKEY_generate, EVP_PKEY_CTX_free, EVP_PKEY_free, EVP_PKEY_get0_type_name, EVP_PKEY_get_group_name, EVP_PKEY_get_bits, EVP_sha256, PEM_write_bio_X509, PEM_read_bio_X509, BIO_new, BIO_s_mem, BIO_puts, BIO_ctrl_pending, BIO_read, BIO_free }, console) {
    // Macros have no binding: their values from x509.h, asn1.h, bn.h and obj_mac.h.
    const X509_VERSION_3 = 2;
    const MBSTRING_UTF8 = 0x1000;
    const BN_RAND_TOP_ANY = -1;
    const BN_RAND_BOTTOM_ANY = 0;
    const NID_subject_alt_name = 85;
    const NID_subject_key_identifier = 82;
    const XN_FLAG_RFC2253 = 0x1110317;
    const ASN1_DTFLGS_ISO8601 = 0x01;
    // OpenSSL prints into a BIO: `printed` passes a memory BIO first and returns what went in.
    const printed = async (print, ...args) => {
        const out = await BIO_new(await BIO_s_mem());
        await print(out, ...args);
        const size = await BIO_ctrl_pending(out);
        const text = await allocBuffer(size);
        await BIO_read(out, text, size);
        await BIO_free(out);
        return readBytes(text, size);
    };

    // A P-256 key, made as in the signing example.
    const generator = await EVP_PKEY_CTX_new_from_name(null, 'EC', null);
    await EVP_PKEY_keygen_init(generator);
    await EVP_PKEY_CTX_set_group_name(generator, 'P-256');
    const slot = await allocPointer(1);
    await EVP_PKEY_generate(generator, slot);
    await EVP_PKEY_CTX_free(generator);
    const key = await readPointerAt(slot, 0);

    // What `openssl req -x509 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1`
    // writes: version 3, a random 159-bit serial, its own issuer and the names browsers match.
    const cert = await X509_new();
    await X509_set_version(cert, X509_VERSION_3);
    const serial = await BN_new();
    await BN_rand(serial, 159, BN_RAND_TOP_ANY, BN_RAND_BOTTOM_ANY);
    await BN_to_ASN1_INTEGER(serial, await X509_get_serialNumber(cert));
    await BN_free(serial);
    const commonName = 'localhost';
    const nameBytes = await allocBuffer(commonName.length);
    await writeBytes(nameBytes, commonName);
    const name = await X509_NAME_new();
    await X509_NAME_add_entry_by_txt(name, 'CN', MBSTRING_UTF8, nameBytes, commonName.length, -1, 0);
    await X509_set_subject_name(cert, name);
    await X509_set_issuer_name(cert, name);
    await X509_NAME_free(name);
    await ASN1_TIME_set_string_X509(await X509_getm_notBefore(cert), '20260101000000Z');
    await ASN1_TIME_set_string_X509(await X509_getm_notAfter(cert), '20270101000000Z');
    await X509_set_pubkey(cert, key);
    // X509V3_CTX is a struct crossbind binds as the class v3_ext_ctx; X509V3_set_ctx fills it in C.
    const context = await new v3_ext_ctx();
    await X509V3_set_ctx(context, cert, cert, null, null, 0);
    for (const [nid, value] of [[NID_subject_alt_name, 'DNS:localhost,IP:127.0.0.1'], [NID_subject_key_identifier, 'hash']]) {
        const extension = await X509V3_EXT_conf_nid(null, context, nid, value);
        await X509_add_ext(cert, extension, -1);
        await X509_EXTENSION_free(extension);
    }
    await X509_sign(cert, key, await EVP_sha256());
    const pem = await printed(PEM_write_bio_X509, cert);
    await X509_free(cert);
    await EVP_PKEY_free(key);
    console.log(pem.split('\n')[0]);

    // Read back, as the certificate example reads one.
    const input = await BIO_new(await BIO_s_mem());
    await BIO_puts(input, pem);
    const copy = await PEM_read_bio_X509(input, null, null, null);
    await BIO_free(input);
    const subject = await printed(X509_NAME_print_ex, await X509_get_subject_name(copy), 0, XN_FLAG_RFC2253);
    const altNames = await X509_get_ext(copy, await X509_get_ext_by_NID(copy, NID_subject_alt_name, -1));
    console.log(subject, await printed(X509V3_EXT_print, altNames, 0, 0));
    const notBefore = await printed(ASN1_TIME_print_ex, await X509_get0_notBefore(copy), ASN1_DTFLGS_ISO8601);
    const notAfter = await printed(ASN1_TIME_print_ex, await X509_get0_notAfter(copy), ASN1_DTFLGS_ISO8601);
    console.log('valid', notBefore, 'to', notAfter);
    const publicKey = await X509_get0_pubkey(copy);
    const group = await allocBuffer(80);
    await EVP_PKEY_get_group_name(publicKey, group, 80, null);
    const type = await EVP_PKEY_get0_type_name(publicKey);
    const bits = await EVP_PKEY_get_bits(publicKey);
    const selfSigned = (await X509_self_signed(copy, 1)) === 1;
    console.log(`${type} ${await readCString(group)} ${bits} bits, self-signed ${selfSigned}`);
    for (const host of ['localhost', 'example.com']) console.log(host, (await X509_check_host(copy, host, host.length, 0, null)) === 1);
    await X509_free(copy);
}
