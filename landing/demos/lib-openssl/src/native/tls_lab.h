#pragma once

#include <openssl/crypto.h>

#include <map>
#include <string>

#include "../support/tls_run.h"

// The TLS lab on crossbind.dev/ports/openssl/: an OpenSSL client and server shake hands inside the
// module over memory BIOs, and every message, record and negotiated parameter comes back as JSON.
class TlsLab {
public:
    TlsLab() = default;
    TlsLab(const TlsLab&) = delete;
    TlsLab& operator=(const TlsLab&) = delete;

    std::string version() const { return OpenSSL_version(OPENSSL_VERSION); }

    // `certificate` is the server key type: "ED25519", "P-256", "RSA-2048" or "ML-DSA-65".
    // `groups` is empty for OpenSSL's default key exchange list, or "X25519", "MLKEM768", "P-256".
    std::string handshake(const std::string& certificate, const std::string& groups, bool tls12, bool ech, bool tamper) {
        sslapp::TlsOptions options;
        options.groups = groups;
        options.tls12 = tls12;
        options.ech = ech;
        options.tamper = tamper;
        return sslapp::runHandshake(identity(certificate), options);
    }

private:
    std::map<std::string, sslapp::ServerIdentity> identities;

    // Keys are made once per type: RSA and ML-DSA key generation take a moment.
    const sslapp::ServerIdentity& identity(const std::string& type) {
        auto found = identities.find(type);
        if (found == identities.end()) found = identities.emplace(type, sslapp::makeIdentity(type)).first;
        return found->second;
    }
};
