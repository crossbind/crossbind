#pragma once

#include <openssl/bio.h>
#include <openssl/bn.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#include <stdexcept>
#include <string>

// The certificate `openssl req -x509 -key key.pem -subj /CN=<name> -addext subjectAltName=<names>`
// makes: version 3, its own issuer, the alternative names and a subject key identifier, signed by
// the key it certifies. Browsers match the alternative names, not the common name.
class SelfSigned {
public:
    // `altNames` as the CLI takes them, "DNS:localhost,IP:127.0.0.1"; the dates as ASN.1 times,
    // "20260101000000Z".
    static std::string create(const std::string& keyPem, const std::string& commonName, const std::string& altNames,
                              const std::string& notBefore, const std::string& notAfter) {
        BIO* input = BIO_new_mem_buf(keyPem.data(), static_cast<int>(keyPem.size()));
        EVP_PKEY* key = PEM_read_bio_PrivateKey(input, nullptr, nullptr, nullptr);
        BIO_free(input);
        if (!key) fail("not a PEM private key");
        X509* cert = X509_new();
        X509_NAME* subject = X509_NAME_new();
        const auto* name = reinterpret_cast<const unsigned char*>(commonName.c_str());
        const bool made = X509_set_version(cert, X509_VERSION_3) && randomSerial(cert)
            && X509_NAME_add_entry_by_txt(subject, "CN", MBSTRING_UTF8, name, -1, -1, 0)
            && X509_set_subject_name(cert, subject) && X509_set_issuer_name(cert, subject)
            && ASN1_TIME_set_string_X509(X509_getm_notBefore(cert), notBefore.c_str())
            && ASN1_TIME_set_string_X509(X509_getm_notAfter(cert), notAfter.c_str()) && X509_set_pubkey(cert, key)
            && extend(cert, NID_subject_alt_name, altNames) && extend(cert, NID_subject_key_identifier, "hash")
            && X509_sign(cert, key, EVP_PKEY_is_a(key, "EC") || EVP_PKEY_is_a(key, "RSA") ? EVP_sha256() : nullptr) > 0;
        std::string pem;
        if (made) {
            BIO* out = BIO_new(BIO_s_mem());
            PEM_write_bio_X509(out, cert);
            char* data = nullptr;
            const long size = BIO_get_mem_data(out, &data);
            pem.assign(data, size > 0 ? static_cast<size_t>(size) : 0);
            BIO_free(out);
        }
        X509_NAME_free(subject);
        X509_free(cert);
        EVP_PKEY_free(key);
        if (!made) fail("cannot make the certificate");
        return pem;
    }

private:
    // A random 159-bit serial, as the CLI picks: Firefox refuses a new certificate that repeats the
    // issuer and serial of one it has seen, which fixed serials on regenerated certificates do.
    static bool randomSerial(X509* cert) {
        BIGNUM* serial = BN_new();
        const bool ok = serial && BN_rand(serial, 159, BN_RAND_TOP_ANY, BN_RAND_BOTTOM_ANY)
            && BN_to_ASN1_INTEGER(serial, X509_get_serialNumber(cert));
        BN_free(serial);
        return ok;
    }

    static bool extend(X509* cert, int nid, const std::string& value) {
        X509V3_CTX context;
        X509V3_set_ctx(&context, cert, cert, nullptr, nullptr, 0);
        X509_EXTENSION* extension = X509V3_EXT_conf_nid(nullptr, &context, nid, value.c_str());
        const bool added = extension && X509_add_ext(cert, extension, -1);
        X509_EXTENSION_free(extension);
        return added;
    }

    [[noreturn]] static void fail(const std::string& what) {
        char reason[256] = "";
        const unsigned long code = ERR_get_error();
        if (code) ERR_error_string_n(code, reason, sizeof reason);
        ERR_clear_error();
        throw std::runtime_error(code ? what + ": " + reason : what);
    }
};
