# @crossbind/port-openssl
**Precompiled OpenSSL library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-openssl">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-openssl?style=for-the-badge" />
</a>
<a href="https://github.com/openssl/openssl">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-openssl%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=OpenSSL" />
</a>
<a href="https://github.com/openssl/openssl/blob/master/LICENSE.txt">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-openssl?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/openssl](https://crossbind.dev/ports/openssl/#apps)** run this package in your browser:

- **Certificate studio.** An RSA, ECDSA, Ed25519 or post-quantum ML-DSA-65 key, a self-signed certificate or a certificate request for it, and any PEM read back the way `openssl x509 -text` prints it. From RFC 8032's first Ed25519 test key it makes, byte for byte, the certificate Python's `cryptography` and OpenSSL 3.6.2's `openssl req -x509` make from the same names, serial and dates: SHA-256 `72:F7:5A:B2:…:D2:7E:C7:E3`.
- **TLS lab.** An OpenSSL client and server shake hands inside the tab over memory BIOs while the page lists every message. By default they agree on TLS 1.3, `TLS_AES_256_GCM_SHA384` and the hybrid post-quantum group `X25519MLKEM768`: a 1,216-byte key share out and 1,120 bytes back. With Encrypted Client Hello on, `secret.example` is in none of the bytes on the wire; one flipped bit ends the handshake with a `bad record mac` alert.
- **PFX unpacker.** A `.p12` or `.pfx` opened into PEM, with the ciphers and MAC that protect each part named as `openssl pkcs12 -info` names them. A file exported with `-legacy` stops with `error:0308010C:digital envelope routines::unsupported` until the legacy provider is loaded; the app loads it for such files only and can pack the contents back as a modern AES-256 file.

Their C++ wrappers, and the self-check the site build runs against published test vectors, the host's OpenSSL 3.6.2, Python's `cryptography` and the browser's own WebCrypto, are in [`landing/demos/lib-openssl`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-openssl).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-openssl @crossbind/port-openssl-wasm @crossbind/port-openssl-android @crossbind/port-openssl-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import opensslWasm from '@crossbind/port-openssl-wasm/crossbind.config.js';
+import opensslAndroid from '@crossbind/port-openssl-android/crossbind.config.js';
+import opensslIos from '@crossbind/port-openssl-ios/crossbind.config.js';

export default {
    dependencies: [
+        opensslWasm,
+        opensslAndroid,
+        opensslIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one reads a certificate from PEM text and answers what people open certificates for: whom it is for, who issued it, when it expires, which host names it covers and its fingerprint. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/certificate.h
#pragma once

#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#include <stdexcept>
#include <string>

// A certificate read from PEM text, and the fields `openssl x509 -text` shows first.
class Certificate {
public:
    explicit Certificate(const std::string& pem) {
        const std::string text = unindent(pem);
        BIO* input = BIO_new_mem_buf(text.data(), static_cast<int>(text.size()));
        cert = PEM_read_bio_X509(input, nullptr, nullptr, nullptr);
        BIO_free(input);
        if (!cert) fail("not a PEM certificate");
    }
    ~Certificate() { X509_free(cert); }
    Certificate(const Certificate&) = delete;
    Certificate& operator=(const Certificate&) = delete;

    // Names as RFC 2253 writes them, most specific first: "CN=example.com,O=Example,C=US".
    std::string subject() const { return distinguishedName(X509_get_subject_name(cert)); }
    std::string issuer() const { return distinguishedName(X509_get_issuer_name(cert)); }

    // "2026-05-30 00:00:00Z"
    std::string notBefore() const { return isoTime(X509_get0_notBefore(cert)); }
    std::string notAfter() const { return isoTime(X509_get0_notAfter(cert)); }

    // The subjectAltName extension as the CLI prints it: "DNS:example.com, IP Address:192.0.2.1".
    std::string altNames() const {
        const int index = X509_get_ext_by_NID(cert, NID_subject_alt_name, -1);
        if (index < 0) return "";
        BIO* out = BIO_new(BIO_s_mem());
        X509V3_EXT_print(out, X509_get_ext(cert, index), 0, 0);
        return drain(out);
    }

    // "EC prime256v1", "RSA", "ED25519", "ML-DSA-65", ...
    std::string keyType() const {
        EVP_PKEY* key = X509_get0_pubkey(cert);
        std::string type = EVP_PKEY_get0_type_name(key);
        char group[80];
        if (EVP_PKEY_get_group_name(key, group, sizeof group, nullptr)) type += std::string(" ") + group;
        return type;
    }

    int keyBits() const { return EVP_PKEY_get_bits(X509_get0_pubkey(cert)); }

    // Whether a TLS client would accept this certificate for the host name, wildcards included.
    bool covers(const std::string& host) const { return X509_check_host(cert, host.data(), host.size(), 0, nullptr) == 1; }

    // Issued by itself, with a signature its own key verifies.
    bool selfSigned() const { return X509_self_signed(cert, 1) == 1; }

    // The SHA-256 fingerprint, written like `openssl x509 -fingerprint -sha256`.
    std::string sha256() const {
        unsigned char digest[EVP_MAX_MD_SIZE];
        unsigned int size = 0;
        if (!X509_digest(cert, EVP_sha256(), digest, &size)) fail("digest failed");
        static const char hex[] = "0123456789ABCDEF";
        std::string out;
        for (unsigned int i = 0; i < size; i += 1) {
            if (i) out += ':';
            out += hex[digest[i] >> 4];
            out += hex[digest[i] & 0x0F];
        }
        return out;
    }

private:
    X509* cert = nullptr;

    // PEM lines must start in the first column; text pasted from YAML, JSON or an indented
    // template literal often does not.
    static std::string unindent(const std::string& text) {
        std::string out;
        bool lineStart = true;
        for (const char character : text) {
            if (lineStart && (character == ' ' || character == '\t')) continue;
            out += character;
            lineStart = character == '\n';
        }
        return out;
    }

    static std::string distinguishedName(const X509_NAME* value) {
        BIO* out = BIO_new(BIO_s_mem());
        X509_NAME_print_ex(out, value, 0, XN_FLAG_RFC2253);
        return drain(out);
    }

    static std::string isoTime(const ASN1_TIME* value) {
        BIO* out = BIO_new(BIO_s_mem());
        ASN1_TIME_print_ex(out, value, ASN1_DTFLGS_ISO8601);
        return drain(out);
    }

    static std::string drain(BIO* out) {
        char* data = nullptr;
        const long size = BIO_get_mem_data(out, &data);
        std::string text(data, size > 0 ? static_cast<size_t>(size) : 0);
        BIO_free(out);
        return text;
    }

    // OpenSSL queues its errors; the first one says what went wrong.
    [[noreturn]] static void fail(const std::string& what) {
        char reason[256] = "";
        const unsigned long code = ERR_get_error();
        if (code) ERR_error_string_n(code, reason, sizeof reason);
        ERR_clear_error();
        throw std::runtime_error(code ? what + ": " + reason : what);
    }
};
```

Then call it from JavaScript:

```js
import { initNative, Certificate } from './native/certificate.h';

await initNative();
// A test certificate for shop.example.com, issued by a test CA.
const pem = `-----BEGIN CERTIFICATE-----
MIICIjCCAcigAwIBAgICEAEwCgYIKoZIzj0EAwIwQzELMAkGA1UEBhMCVVMxFTAT
BgNVBAoMDEV4YW1wbGUgU2hvcDEdMBsGA1UEAwwURXhhbXBsZSBTaG9wIFRlc3Qg
Q0EwHhcNMjYwMzAxMDAwMDAwWhcNMjYwNTMwMDAwMDAwWjA/MQswCQYDVQQGEwJV
UzEVMBMGA1UECgwMRXhhbXBsZSBTaG9wMRkwFwYDVQQDDBBzaG9wLmV4YW1wbGUu
Y29tMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZR6VvLcXeY1MN21YB02ab2Qc
OzohfHo98QuwSjxUrEEni8Yj0oXx53RyQtlAUlDkddzJOt6ldz90XgKXuWIOGKOB
rzCBrDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggr
BgEFBQcDATA3BgNVHREEMDAughBzaG9wLmV4YW1wbGUuY29tghR3d3cuc2hvcC5l
eGFtcGxlLmNvbYcEwAACCjAdBgNVHQ4EFgQU1y3zWDMZI93FAyhp8QnFGfs10k4w
HwYDVR0jBBgwFoAUPExNl7RaXtxsfW/VdAj+Rlc4gpIwCgYIKoZIzj0EAwIDSAAw
RQIgZtZXDYEsjrz91CjoZyFE5coj51aR5sZi/wKllD1qYq8CIQCOKkQWCapO2G/A
p1aRCXKO+JxjPWGnkYe0B8RLljl9Pw==
-----END CERTIFICATE-----`;
const cert = await new Certificate(pem);
console.log(await cert.subject()); // CN=shop.example.com,O=Example Shop,C=US
console.log('issued by', await cert.issuer()); // issued by CN=Example Shop Test CA,O=Example Shop,C=US
console.log('valid', await cert.notBefore(), 'to', await cert.notAfter()); // valid 2026-03-01 00:00:00Z to 2026-05-30 00:00:00Z
console.log(await cert.altNames()); // DNS:shop.example.com, DNS:www.shop.example.com, IP Address:192.0.2.10
console.log(`${await cert.keyType()} ${await cert.keyBits()} bits, self-signed ${await cert.selfSigned()}`); // EC prime256v1 256 bits, self-signed false
for (const host of ['www.shop.example.com', 'shop.example.org']) console.log(host, await cert.covers(host)); // www.shop.example.com true, then shop.example.org false
console.log(await cert.sha256()); // 68:2D:81:9E:75:7E:2C:15:C1:92:FB:84:3D:BE:AA:99:B4:54:58:D4:5F:A3:F3:3A:C8:13:1E:9D:03:9C:89:3C
```

- Certificates cross the binding as PEM text. OpenSSL's PEM reader wants every line to start in the first column, which PEM pasted from YAML or written in an indented template literal does not, so the wrapper trims each line first.
- WebCrypto has no X.509 parser; in a browser, this is how an app reads a certificate. When OpenSSL fails, the wrapper throws OpenSSL's first queued error, so for text that is not a certificate JavaScript catches `std::runtime_error: not a PEM certificate: error:0480006C:PEM routines::no start line`.
- `covers` is `X509_check_host`, the check a TLS client runs against the alternative names, wildcards included.

### More examples
Each one runs in your browser on [crossbind.dev/ports/openssl](https://crossbind.dev/ports/openssl/#usage), next to the code shown there:

- [Hash and HMAC](https://crossbind.dev/ports/openssl/#02-hashing): `EVP_Q_digest` with SHA-256, SHA3-256 and BLAKE2b-512, `EVP_DigestUpdate` for data that arrives in pieces, and `EVP_Q_mac` for HMAC. Every line is its standard's published test vector.
- [Encrypt and authenticate with AES-256-GCM](https://crossbind.dev/ports/openssl/#03-aes-gcm): `EVP_CipherInit_ex2`, the tag through `EVP_CTRL_AEAD_GET_TAG` and `EVP_CTRL_AEAD_SET_TAG`, and a refused decryption when the associated data changes. WebCrypto decrypts what it writes.
- [Generate a key, sign and verify](https://crossbind.dev/ports/openssl/#04-signing): `EVP_PKEY_Q_keygen`, `EVP_DigestSign` and `EVP_DigestVerify` with ECDSA P-256, Ed25519 and the post-quantum ML-DSA-65 of FIPS 204.
- [Make a self-signed certificate for localhost](https://crossbind.dev/ports/openssl/#05-self-signed): `X509_sign` with a random serial and the `subjectAltName` browsers match, read back with the certificate example.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/openssl/wasm/) · [Android](https://crossbind.dev/ports/openssl/android/) · [iOS](https://crossbind.dev/ports/openssl/ios/) · [WASI](https://crossbind.dev/ports/openssl/wasi/), which also has a command-line program built with `crossbind build -p wasi`: file digests in `sha256sum`'s format, a `sha256sum -c` style check and webhook HMACs.

## What this build includes
- OpenSSL 4.0.2 as two static libraries, `libssl` and `libcrypto`, built with OpenSSL's own `Configure` and `no-apps no-docs no-tests no-shared`.
- What the apps and examples above run in the browser, checked on every site build: TLS 1.3 and TLS 1.2; the key exchange groups `X25519MLKEM768` (OpenSSL's default), `MLKEM768`, `X25519` and P-256; Encrypted Client Hello; Ed25519, ECDSA, RSA and ML-DSA-65 keys, signatures and certificates; X.509 certificates, certificate requests and PKCS#12; AES-256-GCM; SHA-2, SHA-3, BLAKE2 and HMAC.
- The legacy provider, which has RC2, the cipher of old PKCS#12 files, is compiled in and off until `OSSL_PROVIDER_load(NULL, "legacy")`. Loading any provider by name stops OpenSSL from loading its default provider on its own, so load `"default"` explicitly as well.
- No CA certificates in the browser: the WebAssembly package carries Mozilla's bundle as of 15 July 2025 (143 roots, `ssl/certs/cacert.pem`), but only the Android, iOS and WASI builds declare it as runtime data. A browser app that verifies public certificates brings its own roots.
- No `openssl.cnf` either: OpenSSL runs on its built-in defaults. Keys and nonces draw on the browser's `crypto.getRandomValues`.
- The module behind the five examples and three apps is 4,037,192 bytes of WebAssembly and 137,522 bytes of JavaScript. Most of it is libcrypto with its default provider, which any use of EVP brings in: a module that only hashed and encrypted measured 2,761,152 bytes, one that only read the version 224,494, and libssl adds about 0.9 MB.
- OpenSSL 4 changes met on the way: `X509_get_subject_name` returns a `const X509_NAME*`, so build a name with `X509_NAME_new` and set it with `X509_set_subject_name`; and `-text` output now wraps hex dumps at 16 bytes, 24 for signatures, and gives an EC key's size as `256 bit field, 128 bit security level`.
- The `openssl` command is not in the library packages; `@crossbind/port-openssl-bin-wasi` ships it as an `openssl-wasi` command for offline work, without `s_client` and `s_server`.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-openssl-wasm`](https://www.npmjs.com/package/@crossbind/port-openssl-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-openssl-android`](https://www.npmjs.com/package/@crossbind/port-openssl-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-openssl-ios`](https://www.npmjs.com/package/@crossbind/port-openssl-ios) | device (`arm64`), simulator (`arm64`) |
| WASI library | [`@crossbind/port-openssl-wasi`](https://www.npmjs.com/package/@crossbind/port-openssl-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-openssl-bin-wasi`](https://www.npmjs.com/package/@crossbind/port-openssl-bin-wasi) | the upstream `openssl` CLI as an `openssl-wasi` command (wasmtime 47+) |

## License
This project includes the precompiled OpenSSL library, which is distributed under the [Apache License 2.0](https://github.com/openssl/openssl/blob/master/LICENSE.txt).

OpenSSL Homepage: [https://openssl-library.org/](https://openssl-library.org/)
