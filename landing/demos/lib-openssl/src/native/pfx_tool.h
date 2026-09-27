#pragma once

#include <openssl/err.h>
#include <openssl/pkcs12.h>
#include <openssl/x509.h>

#include <stdexcept>
#include <string>
#include <vector>

#include "../support/app_text.h"
#include "../support/pkcs12_info.h"
#include "../support/pki.h"

// The PFX app on crossbind.dev/ports/openssl/: .p12 and .pfx files opened into PEM, and PEM packed
// back into either kind, with what protects each part named as `openssl pkcs12 -info` names it.
// Files travel as base64; nothing is written anywhere.
class PfxTool {
public:
    PfxTool() = default;
    PfxTool(const PfxTool&) = delete;
    PfxTool& operator=(const PfxTool&) = delete;

    // The key, the certificate and the chain as PEM, with the file's MAC and ciphers. A file that
    // needs the legacy provider is read with it, and says so.
    std::string unpack(const std::string& p12Base64, const std::string& password) {
        const sslapp::Pkcs12 p12 = sslapp::readPkcs12(sslapp::fromBase64(p12Base64));
        if (PKCS12_verify_mac(p12.get(), password.c_str(), -1) != 1) {
            sslapp::takeError();
            throw std::runtime_error("wrong password: the file's MAC does not verify");
        }
        Parts parts;
        std::string withoutLegacy;
        std::vector<std::string> safes;
        if (parts.parse(p12.get(), password)) {
            safes = sslapp::safesText(p12.get(), password);
        } else {
            withoutLegacy = sslapp::takeError();
            sslapp::LegacyProvider legacy;
            if (!parts.parse(p12.get(), password)) sslapp::fail("cannot read the file even with the legacy provider");
            safes = sslapp::safesText(p12.get(), password);
        }
        return describe(p12.get(), parts, safes, withoutLegacy);
    }

    // A .p12 of the key, the certificate and any chain certificates, as base64. `legacy` writes
    // what `openssl pkcs12 -export -legacy` writes.
    std::string pack(const std::string& keyPem, const std::string& certPem, const std::string& chainPem, const std::string& password,
                     const std::string& friendlyName, bool legacy) {
        const sslapp::Key key = sslapp::readPrivateKey(keyPem);
        const sslapp::Cert cert = sslapp::readCertificate(certPem);
        const std::vector<sslapp::Cert> chain = sslapp::readCertificates(chainPem);
        if (X509_check_private_key(cert.get(), key.get()) != 1) {
            sslapp::takeError();
            throw std::invalid_argument("the private key does not belong to the certificate");
        }
        if (!legacy) return sslapp::toBase64(sslapp::writePkcs12(sslapp::makePkcs12(key.get(), cert.get(), chain, password, friendlyName, false).get()));
        sslapp::LegacyProvider provider;
        return sslapp::toBase64(sslapp::writePkcs12(sslapp::makePkcs12(key.get(), cert.get(), chain, password, friendlyName, true).get()));
    }

    // A sample file to try the app on: a fresh P-256 key and a self-signed certificate for
    // sample.example, valid for 90 days.
    std::string sample(const std::string& password, bool legacy) {
        const sslapp::Key key = sslapp::generateKey("P-256");
        sslapp::CertificateSpec spec;
        spec.subject = "/O=Example/CN=sample.example";
        spec.altNames = "DNS:sample.example";
        spec.days = 90;
        const sslapp::Cert cert = sslapp::makeCertificate(key.get(), spec);
        return pack(sslapp::privateKeyPem(key.get()), sslapp::certificatePem(cert.get()), "", password, "sample.example", legacy);
    }

private:
    // What PKCS12_parse hands back, freed with this object.
    struct Parts {
        EVP_PKEY* key = nullptr;
        X509* cert = nullptr;
        STACK_OF(X509)* chain = nullptr;
        ~Parts() { clear(); }
        void clear() {
            EVP_PKEY_free(key);
            X509_free(cert);
            sk_X509_pop_free(chain, X509_free);
            key = nullptr;
            cert = nullptr;
            chain = nullptr;
        }
        bool parse(PKCS12* p12, const std::string& password) {
            clear();
            return PKCS12_parse(p12, password.c_str(), &key, &cert, &chain) == 1 && key && cert;
        }
    };

    static std::string describe(PKCS12* p12, const Parts& parts, const std::vector<std::string>& safes, const std::string& withoutLegacy) {
        std::vector<std::string> lines;
        for (const auto& line : safes) lines.push_back(sslapp::quote(line));
        std::vector<std::string> chain;
        for (int i = 0; i < sk_X509_num(parts.chain); i += 1) {
            X509* extra = sk_X509_value(parts.chain, i);
            chain.push_back(sslapp::Json()
                                .text("subject", sslapp::distinguishedName(X509_get_subject_name(extra)))
                                .text("fingerprint", sslapp::fingerprint(extra))
                                .text("pem", sslapp::certificatePem(extra))
                                .str());
        }
        int aliasLength = 0;
        const unsigned char* alias = X509_alias_get0(parts.cert, &aliasLength);
        sslapp::Json json;
        json.flag("legacyProvider", !withoutLegacy.empty())
            .text("withoutLegacy", withoutLegacy)
            .text("mac", sslapp::macText(p12))
            .raw("safes", sslapp::array(lines))
            .text("friendlyName", alias ? std::string(reinterpret_cast<const char*>(alias), static_cast<size_t>(aliasLength)) : "")
            .text("keyType", sslapp::keyType(parts.key))
            .number("keyBits", EVP_PKEY_get_bits(parts.key))
            .text("keyPem", sslapp::privateKeyPem(parts.key))
            .raw("certificate", sslapp::describeCertificate(parts.cert))
            .text("certPem", sslapp::certificatePem(parts.cert))
            .raw("chain", sslapp::array(chain))
            .flag("keyMatches", X509_check_private_key(parts.cert, parts.key) == 1);
        ERR_clear_error();
        return json.str();
    }
};
