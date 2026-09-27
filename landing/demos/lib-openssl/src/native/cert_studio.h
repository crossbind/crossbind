#pragma once

#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>

#include <stdexcept>
#include <string>
#include <vector>

#include "../support/app_text.h"
#include "../support/pki.h"

// The certificate studio on crossbind.dev/ports/openssl/: a key, then a self-signed certificate
// or a certificate signing request for it, and an inspector for whatever PEM is pasted in. Keys
// are made and used inside the module; only what the page asks for comes back out.
class CertStudio {
public:
    CertStudio() = default;
    CertStudio(const CertStudio&) = delete;
    CertStudio& operator=(const CertStudio&) = delete;

    std::string version() const { return OpenSSL_version(OPENSSL_VERSION); }

    // A new private key as unencrypted PKCS#8 PEM: "RSA-2048", "RSA-3072", "P-256", "P-384",
    // "ED25519", "ED448", "ML-DSA-44", "ML-DSA-65" or "ML-DSA-87".
    std::string generateKey(const std::string& type) { return sslapp::privateKeyPem(sslapp::generateKey(type).get()); }

    // The Ed25519 key with this 32-byte seed, as RFC 8032's test vectors give keys.
    std::string ed25519FromSeed(const std::string& seedHex) { return sslapp::privateKeyPem(sslapp::ed25519FromSeed(seedHex).get()); }

    // A self-signed certificate. `subject` as `openssl req -subj` takes it, "/CN=localhost";
    // `altNames` as "DNS:localhost,IP:127.0.0.1". The dates are ASN.1 times such as
    // "20260101000000Z", or empty for now and `days` later; serial 0 picks a random one.
    std::string selfSign(const std::string& keyPem, const std::string& subject, const std::string& altNames, int days,
                         const std::string& notBefore, const std::string& notAfter, int serial) {
        const sslapp::Key key = sslapp::readPrivateKey(keyPem);
        sslapp::CertificateSpec spec;
        spec.subject = subject;
        spec.altNames = altNames;
        spec.days = days;
        spec.notBefore = notBefore;
        spec.notAfter = notAfter;
        spec.serial = serial;
        return sslapp::certificatePem(sslapp::makeCertificate(key.get(), spec).get());
    }

    // A certificate signing request to send to a CA; the key stays here.
    std::string makeRequest(const std::string& keyPem, const std::string& subject, const std::string& altNames) {
        const sslapp::Key key = sslapp::readPrivateKey(keyPem);
        return sslapp::requestPem(sslapp::makeRequest(key.get(), subject, altNames).get());
    }

    // The signature of a UTF-8 message, in hex. Ed25519 and ML-DSA sign the message itself, so the
    // same key and message always give the same Ed25519 signature.
    std::string sign(const std::string& keyPem, const std::string& message) {
        const sslapp::Key key = sslapp::readPrivateKey(keyPem);
        EVP_MD_CTX* context = EVP_MD_CTX_new();
        size_t size = 0;
        std::string signature;
        const auto* data = reinterpret_cast<const unsigned char*>(message.data());
        const EVP_MD* digest = sslapp::signingDigest(key.get());
        bool signed_ = EVP_DigestSignInit_ex(context, nullptr, digest ? EVP_MD_get0_name(digest) : nullptr, nullptr, nullptr, key.get(), nullptr) == 1
            && EVP_DigestSign(context, nullptr, &size, data, message.size()) == 1;
        if (signed_) {
            signature.resize(size);
            signed_ = EVP_DigestSign(context, reinterpret_cast<unsigned char*>(&signature[0]), &size, data, message.size()) == 1;
            signature.resize(size);
        }
        EVP_MD_CTX_free(context);
        if (!signed_) sslapp::fail("cannot sign");
        return sslapp::toHex(signature);
    }

    // Whatever the text holds, described as a JSON array: every certificate of a chain, a
    // certificate request, a private key (its public half only) or a public key.
    std::string inspect(const std::string& pem) {
        const std::string text = sslapp::unindent(pem);
        std::vector<std::string> items;
        for (const sslapp::Cert& cert : sslapp::readCertificates(text)) items.push_back(sslapp::describeCertificate(cert.get()));
        if (!items.empty()) return sslapp::array(items);
        BIO* in = BIO_new_mem_buf(text.data(), static_cast<int>(text.size()));
        const std::string label = labelOf(text);
        if (label.find("CERTIFICATE REQUEST") != std::string::npos) {
            X509_REQ* request = PEM_read_bio_X509_REQ(in, nullptr, nullptr, nullptr);
            if (request) items.push_back(sslapp::describeRequest(request));
            X509_REQ_free(request);
        } else if (label.find("PRIVATE KEY") != std::string::npos) {
            EVP_PKEY* key = PEM_read_bio_PrivateKey(in, nullptr, nullptr, nullptr);
            if (key) items.push_back(sslapp::describeKey(key, true));
            EVP_PKEY_free(key);
        } else if (label.find("PUBLIC KEY") != std::string::npos) {
            EVP_PKEY* key = PEM_read_bio_PUBKEY(in, nullptr, nullptr, nullptr);
            if (key) items.push_back(sslapp::describeKey(key, false));
            EVP_PKEY_free(key);
        }
        BIO_free(in);
        if (items.empty()) sslapp::fail(label.empty() ? "no PEM block found: paste text that starts with -----BEGIN" : "cannot read the " + label + " block");
        return sslapp::array(items);
    }

    // Whether the private key belongs to the first certificate or request in the text.
    bool keyMatches(const std::string& pem, const std::string& keyPem) {
        const sslapp::Key key = sslapp::readPrivateKey(keyPem);
        const std::string text = sslapp::unindent(pem);
        std::vector<sslapp::Cert> certs = sslapp::readCertificates(text);
        int matches = 0;
        if (!certs.empty()) {
            matches = X509_check_private_key(certs.front().get(), key.get());
        } else {
            BIO* in = BIO_new_mem_buf(text.data(), static_cast<int>(text.size()));
            X509_REQ* request = PEM_read_bio_X509_REQ(in, nullptr, nullptr, nullptr);
            BIO_free(in);
            if (!request) sslapp::fail("no certificate or certificate request to compare with");
            matches = X509_REQ_check_private_key(request, key.get());
            X509_REQ_free(request);
        }
        sslapp::takeError();
        return matches == 1;
    }

private:
    // "CERTIFICATE REQUEST" from "-----BEGIN CERTIFICATE REQUEST-----".
    static std::string labelOf(const std::string& text) {
        const std::string begin = "-----BEGIN ";
        const size_t start = text.find(begin);
        if (start == std::string::npos) return "";
        const size_t end = text.find("-----", start + begin.size());
        return end == std::string::npos ? "" : text.substr(start + begin.size(), end - start - begin.size());
    }
};
