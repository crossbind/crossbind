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
