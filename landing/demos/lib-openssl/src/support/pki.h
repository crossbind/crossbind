#pragma once

#include <openssl/bn.h>
#include <openssl/evp.h>
#include <openssl/objects.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#include <memory>
#include <string>
#include <vector>

#include "app_text.h"

// Keys, certificates and certificate requests for the apps: made, read, written and described the
// way the openssl command line does it.
namespace sslapp {

struct FreeKey {
    void operator()(EVP_PKEY* key) const { EVP_PKEY_free(key); }
};
struct FreeCert {
    void operator()(X509* cert) const { X509_free(cert); }
};
struct FreeRequest {
    void operator()(X509_REQ* request) const { X509_REQ_free(request); }
};
using Key = std::unique_ptr<EVP_PKEY, FreeKey>;
using Cert = std::unique_ptr<X509, FreeCert>;
using Request = std::unique_ptr<X509_REQ, FreeRequest>;

// What `openssl x509 -text` passes to X509_print_ex when no -nameopt is given.
constexpr unsigned long CLI_NAME_FLAGS = XN_FLAG_SEP_CPLUS_SPC | XN_FLAG_FN_SN | ASN1_STRFLGS_ESC_CTRL | ASN1_STRFLGS_UTF8_CONVERT
    | ASN1_STRFLGS_DUMP_UNKNOWN | ASN1_STRFLGS_DUMP_DER;

// "RSA-2048", "RSA-3072", "P-256", "P-384", "ED25519", "ED448", "ML-DSA-44", "ML-DSA-65", "ML-DSA-87".
inline Key generateKey(const std::string& type) {
    EVP_PKEY* key = nullptr;
    if (type == "RSA-2048" || type == "RSA-3072" || type == "RSA-4096") {
        key = EVP_PKEY_Q_keygen(nullptr, nullptr, "RSA", static_cast<size_t>(std::stoul(type.substr(4))));
    } else if (type == "P-256" || type == "P-384" || type == "P-521") {
        key = EVP_PKEY_Q_keygen(nullptr, nullptr, "EC", type.c_str());
    } else {
        key = EVP_PKEY_Q_keygen(nullptr, nullptr, type.c_str());
    }
    if (!key) fail("cannot generate a " + type + " key");
    return Key(key);
}

// An Ed25519 key from its 32-byte seed, for RFC 8032's test vectors and repeatable test keys.
inline Key ed25519FromSeed(const std::string& seedHex) {
    const std::string seed = fromHex(seedHex);
    EVP_PKEY* key = EVP_PKEY_new_raw_private_key(EVP_PKEY_ED25519, nullptr, reinterpret_cast<const unsigned char*>(seed.data()), seed.size());
    if (!key) fail("an Ed25519 seed is 32 bytes");
    return Key(key);
}

inline Key readPrivateKey(const std::string& pem) {
    const std::string text = unindent(pem);
    BIO* in = BIO_new_mem_buf(text.data(), static_cast<int>(text.size()));
    EVP_PKEY* key = PEM_read_bio_PrivateKey(in, nullptr, nullptr, nullptr);
    BIO_free(in);
    if (!key) fail("not a PEM private key");
    return Key(key);
}

// Every certificate in the text, in order: a single certificate or a whole chain.
inline std::vector<Cert> readCertificates(const std::string& pem) {
    const std::string text = unindent(pem);
    BIO* in = BIO_new_mem_buf(text.data(), static_cast<int>(text.size()));
    std::vector<Cert> certs;
    while (X509* cert = PEM_read_bio_X509(in, nullptr, nullptr, nullptr)) certs.emplace_back(cert);
    BIO_free(in);
    ERR_clear_error();
    return certs;
}

inline Cert readCertificate(const std::string& pem) {
    std::vector<Cert> certs = readCertificates(pem);
    if (certs.empty()) fail("not a PEM certificate");
    return std::move(certs.front());
}

inline std::string privateKeyPem(EVP_PKEY* key) {
    BIO* out = BIO_new(BIO_s_mem());
    PEM_write_bio_PrivateKey(out, key, nullptr, nullptr, 0, nullptr, nullptr);
    return drain(out);
}

inline std::string publicKeyPem(EVP_PKEY* key) {
    BIO* out = BIO_new(BIO_s_mem());
    PEM_write_bio_PUBKEY(out, key);
    return drain(out);
}

inline std::string certificatePem(X509* cert) {
    BIO* out = BIO_new(BIO_s_mem());
    PEM_write_bio_X509(out, cert);
    return drain(out);
}

// ECDSA and RSA sign a SHA-256 digest; Ed25519, Ed448 and ML-DSA sign the data itself.
inline const EVP_MD* signingDigest(const EVP_PKEY* key) { return EVP_PKEY_is_a(key, "EC") || EVP_PKEY_is_a(key, "RSA") ? EVP_sha256() : nullptr; }

// "EC prime256v1", "RSA", "ED25519", "ML-DSA-65"
inline std::string keyType(const EVP_PKEY* key) {
    std::string type = EVP_PKEY_get0_type_name(key);
    char group[80];
    if (EVP_PKEY_get_group_name(key, group, sizeof group, nullptr)) type += std::string(" ") + group;
    return type;
}

// "/C=US/O=Example/CN=localhost", the form `openssl req -subj` takes. The leading slash may go.
inline X509_NAME* parseSubject(const std::string& subject) {
    X509_NAME* name = X509_NAME_new();
    size_t position = !subject.empty() && subject[0] == '/' ? 1 : 0;
    while (position < subject.size()) {
        size_t end = subject.find('/', position);
        if (end == std::string::npos) end = subject.size();
        const std::string part = subject.substr(position, end - position);
        const size_t equals = part.find('=');
        const std::string field = part.substr(0, equals);
        const std::string value = equals == std::string::npos ? "" : part.substr(equals + 1);
        const auto* bytes = reinterpret_cast<const unsigned char*>(value.c_str());
        if (equals == std::string::npos || !X509_NAME_add_entry_by_txt(name, field.c_str(), MBSTRING_UTF8, bytes, -1, -1, 0)) {
            X509_NAME_free(name);
            fail("cannot read the subject part " + quote(part) + "; write it as /CN=example.com/O=Example");
        }
        position = end + 1;
    }
    if (X509_NAME_entry_count(name) == 0) {
        X509_NAME_free(name);
        fail("the subject is empty; write it as /CN=example.com");
    }
    return name;
}

inline bool addExtension(X509* cert, X509* issuer, int nid, const std::string& value) {
    X509V3_CTX context;
    X509V3_set_ctx(&context, issuer ? issuer : cert, cert, nullptr, nullptr, 0);
    X509_EXTENSION* extension = X509V3_EXT_conf_nid(nullptr, &context, nid, value.c_str());
    const bool added = extension && X509_add_ext(cert, extension, -1);
    X509_EXTENSION_free(extension);
    return added;
}

struct CertificateSpec {
    std::string subject;       // "/CN=localhost"
    std::string altNames;      // "DNS:localhost,IP:127.0.0.1", or empty
    std::string notBefore;     // an ASN.1 time, "20260101000000Z", or empty for now
    std::string notAfter;      // an ASN.1 time, or empty for `days` after notBefore
    long days = 30;
    long startOffset = 0;      // seconds added to now when notBefore is empty
    long serial = 0;           // 0 picks a random 159-bit serial, as the CLI does
    bool authority = false;    // a CA certificate: basicConstraints CA:TRUE and keyCertSign
};

inline bool setSerial(X509* cert, long serial) {
    if (serial > 0) return ASN1_INTEGER_set(X509_get_serialNumber(cert), serial) == 1;
    BIGNUM* random = BN_new();
    const bool set = random && BN_rand(random, 159, BN_RAND_TOP_ANY, BN_RAND_BOTTOM_ANY) && BN_to_ASN1_INTEGER(random, X509_get_serialNumber(cert));
    BN_free(random);
    return set;
}

inline bool setValidity(X509* cert, const CertificateSpec& spec) {
    const bool start = spec.notBefore.empty() ? X509_gmtime_adj(X509_getm_notBefore(cert), spec.startOffset) != nullptr
                                              : ASN1_TIME_set_string_X509(X509_getm_notBefore(cert), spec.notBefore.c_str()) == 1;
    if (!spec.notAfter.empty()) return start && ASN1_TIME_set_string_X509(X509_getm_notAfter(cert), spec.notAfter.c_str()) == 1;
    return start && X509_time_adj_ex(X509_getm_notAfter(cert), static_cast<int>(spec.days), spec.startOffset, nullptr) != nullptr;
}

// A certificate for `key`, signed by `issuerKey` under `issuer`'s name, or self-signed without an
// issuer. Extensions come in the order `openssl req -x509 -addext` and `openssl x509 -req` write
// them: the requested ones, then the subject and authority key identifiers.
inline Cert makeCertificate(EVP_PKEY* key, const CertificateSpec& spec, X509* issuer = nullptr, EVP_PKEY* issuerKey = nullptr) {
    Cert cert(X509_new());
    X509_NAME* subject = parseSubject(spec.subject);
    bool made = X509_set_version(cert.get(), X509_VERSION_3) && setSerial(cert.get(), spec.serial) && X509_set_subject_name(cert.get(), subject)
        && X509_set_issuer_name(cert.get(), issuer ? X509_get_subject_name(issuer) : subject) && setValidity(cert.get(), spec)
        && X509_set_pubkey(cert.get(), key);
    X509_NAME_free(subject);
    if (made && spec.authority) {
        made = addExtension(cert.get(), issuer, NID_basic_constraints, "critical,CA:TRUE")
            && addExtension(cert.get(), issuer, NID_key_usage, "critical,keyCertSign,cRLSign");
    }
    if (made && !spec.altNames.empty()) made = addExtension(cert.get(), issuer, NID_subject_alt_name, spec.altNames);
    if (made) made = addExtension(cert.get(), issuer, NID_subject_key_identifier, "hash");
    if (made && issuer) made = addExtension(cert.get(), issuer, NID_authority_key_identifier, "keyid");
    EVP_PKEY* signer = issuerKey ? issuerKey : key;
    if (made) made = X509_sign(cert.get(), signer, signingDigest(signer)) > 0;
    if (!made) fail("cannot make the certificate");
    return cert;
}

// A certificate signing request, as `openssl req -new -key key.pem -subj ... -addext subjectAltName=...`.
inline Request makeRequest(EVP_PKEY* key, const std::string& subject, const std::string& altNames) {
    Request request(X509_REQ_new());
    X509_NAME* name = parseSubject(subject);
    bool made = X509_REQ_set_version(request.get(), X509_REQ_VERSION_1) && X509_REQ_set_subject_name(request.get(), name)
        && X509_REQ_set_pubkey(request.get(), key);
    X509_NAME_free(name);
    if (made && !altNames.empty()) {
        X509V3_CTX context;
        X509V3_set_ctx(&context, nullptr, nullptr, request.get(), nullptr, 0);
        STACK_OF(X509_EXTENSION)* extensions = sk_X509_EXTENSION_new_null();
        X509_EXTENSION* names = X509V3_EXT_conf_nid(nullptr, &context, NID_subject_alt_name, altNames.c_str());
        made = names && sk_X509_EXTENSION_push(extensions, names) > 0 && X509_REQ_add_extensions(request.get(), extensions);
        if (names && sk_X509_EXTENSION_num(extensions) == 0) X509_EXTENSION_free(names);
        sk_X509_EXTENSION_pop_free(extensions, X509_EXTENSION_free);
    }
    if (made) made = X509_REQ_sign(request.get(), key, signingDigest(key)) > 0;
    if (!made) fail("cannot make the certificate request");
    return request;
}

inline std::string requestPem(X509_REQ* request) {
    BIO* out = BIO_new(BIO_s_mem());
    PEM_write_bio_X509_REQ(out, request);
    return drain(out);
}

inline std::string fingerprint(X509* cert) {
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int size = 0;
    if (!X509_digest(cert, EVP_sha256(), digest, &size)) fail("cannot hash the certificate");
    return toHex(digest, size, true, ':');
}

inline std::string distinguishedName(const X509_NAME* name) {
    BIO* out = BIO_new(BIO_s_mem());
    X509_NAME_print_ex(out, name, 0, XN_FLAG_RFC2253);
    return drain(out);
}

inline std::string isoTime(const ASN1_TIME* time) {
    BIO* out = BIO_new(BIO_s_mem());
    ASN1_TIME_print_ex(out, time, ASN1_DTFLGS_ISO8601);
    return drain(out);
}

inline std::string altNamesOf(const X509_EXTENSION* extension) {
    if (!extension) return "";
    BIO* out = BIO_new(BIO_s_mem());
    X509V3_EXT_print(out, const_cast<X509_EXTENSION*>(extension), 0, 0);
    return drain(out);
}

// Everything the inspector shows about a certificate, `openssl x509 -text` included.
inline std::string describeCertificate(X509* cert) {
    EVP_PKEY* key = X509_get0_pubkey(cert);
    const int index = X509_get_ext_by_NID(cert, NID_subject_alt_name, -1);
    const ASN1_INTEGER* serial = X509_get0_serialNumber(cert);
    BIGNUM* number = ASN1_INTEGER_to_BN(serial, nullptr);
    char* serialHex = number ? BN_bn2hex(number) : nullptr;
    const std::string serialText = serialHex ? serialHex : "";
    OPENSSL_free(serialHex);
    BN_free(number);
    BIO* text = BIO_new(BIO_s_mem());
    X509_print_ex(text, cert, CLI_NAME_FLAGS, X509_FLAG_COMPAT);
    Json json;
    json.text("kind", "certificate")
        .text("subject", distinguishedName(X509_get_subject_name(cert)))
        .text("issuer", distinguishedName(X509_get_issuer_name(cert)))
        .text("serial", serialText)
        .text("notBefore", isoTime(X509_get0_notBefore(cert)))
        .text("notAfter", isoTime(X509_get0_notAfter(cert)))
        .text("altNames", index < 0 ? "" : altNamesOf(X509_get_ext(cert, index)))
        .text("keyType", keyType(key))
        .number("keyBits", EVP_PKEY_get_bits(key))
        .text("signature", OBJ_nid2ln(X509_get_signature_nid(cert)))
        .flag("selfSigned", X509_self_signed(cert, 1) == 1)
        .flag("authority", X509_check_ca(cert) > 0)
        .text("fingerprint", fingerprint(cert))
        .text("text", drain(text));
    ERR_clear_error();
    return json.str();
}

inline std::string describeRequest(X509_REQ* request) {
    EVP_PKEY* key = X509_REQ_get0_pubkey(request);
    std::string altNames;
    STACK_OF(X509_EXTENSION)* extensions = X509_REQ_get_extensions(request);
    for (int i = 0; i < sk_X509_EXTENSION_num(extensions); i += 1) {
        X509_EXTENSION* extension = sk_X509_EXTENSION_value(extensions, i);
        if (OBJ_obj2nid(X509_EXTENSION_get_object(extension)) == NID_subject_alt_name) altNames = altNamesOf(extension);
    }
    sk_X509_EXTENSION_pop_free(extensions, X509_EXTENSION_free);
    BIO* text = BIO_new(BIO_s_mem());
    X509_REQ_print_ex(text, request, CLI_NAME_FLAGS, X509_FLAG_COMPAT);
    Json json;
    json.text("kind", "certificate request")
        .text("subject", distinguishedName(X509_REQ_get_subject_name(request)))
        .text("altNames", altNames)
        .text("keyType", keyType(key))
        .number("keyBits", EVP_PKEY_get_bits(key))
        .text("signature", OBJ_nid2ln(X509_REQ_get_signature_nid(request)))
        .flag("signatureValid", X509_REQ_verify(request, key) == 1)
        .text("text", drain(text));
    ERR_clear_error();
    return json.str();
}

// A key described without its secret: `openssl pkey -text_pub` prints the same public part.
inline std::string describeKey(EVP_PKEY* key, bool isPrivate) {
    BIO* text = BIO_new(BIO_s_mem());
    EVP_PKEY_print_public(text, key, 0, nullptr);
    Json json;
    json.text("kind", isPrivate ? "private key" : "public key")
        .text("keyType", keyType(key))
        .number("keyBits", EVP_PKEY_get_bits(key))
        .number("securityBits", EVP_PKEY_get_security_bits(key))
        .text("publicKeyPem", publicKeyPem(key))
        .text("text", drain(text));
    ERR_clear_error();
    return json.str();
}

}  // namespace sslapp
