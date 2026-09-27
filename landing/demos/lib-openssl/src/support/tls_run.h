#pragma once

#include <openssl/crypto.h>
#include <openssl/ech.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <openssl/x509_vfy.h>

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

#include "app_text.h"
#include "pki.h"

// One TLS handshake between an OpenSSL client and an OpenSSL server in the same module. Each side
// reads and writes memory BIOs and this code carries the bytes across, so it sees every record on
// the wire and can change one on the way.
namespace sslapp {

constexpr const char* SECRET_NAME = "secret.example";
constexpr const char* PUBLIC_NAME = "public.example";
constexpr const char* REQUEST = "GET /inbox HTTP/1.1\r\nHost: secret.example\r\n\r\n";
constexpr const char* RESPONSE = "HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\nhello, tab!";

struct TlsOptions {
    std::string groups;   // empty for OpenSSL's default list, otherwise the only groups both ends allow
    bool tls12 = false;   // cap the client at TLS 1.2
    bool ech = false;     // Encrypted Client Hello: the outer name is public.example, the real one secret.example
    bool tamper = false;  // flip one bit of the server's first encrypted record
};

// A CA and the server certificate it issued for secret.example and public.example, valid from a day
// ago for thirty days, with keys of the chosen type.
struct ServerIdentity {
    Key caKey;
    Cert ca;
    Key key;
    Cert cert;
};

inline ServerIdentity makeIdentity(const std::string& keyType) {
    ServerIdentity identity;
    identity.caKey = generateKey(keyType);
    CertificateSpec authority;
    authority.subject = "/CN=TLS lab CA";
    authority.authority = true;
    authority.startOffset = -86400;
    identity.ca = makeCertificate(identity.caKey.get(), authority);
    identity.key = generateKey(keyType);
    CertificateSpec server;
    server.subject = "/CN=secret.example";
    server.altNames = "DNS:secret.example,DNS:public.example";
    server.startOffset = -86400;
    identity.cert = makeCertificate(identity.key.get(), server, identity.ca.get(), identity.caKey.get());
    return identity;
}

// Every message as its receiver reads it, so each is recorded once and in protocol order.
struct Trace {
    SSL* client = nullptr;
    std::vector<std::string> messages;
    bool encrypted[2] = {false, false};  // indexed by receiver: whether the record being read was encrypted
    bool cipherOn[2] = {false, false};   // TLS 1.2: a ChangeCipherSpec turned encryption on
};

inline std::string handshakeName(const unsigned char* message, size_t size) {
    static const unsigned char retry[32] = {0xCF, 0x21, 0xAD, 0x74, 0xE5, 0x9A, 0x61, 0x11, 0xBE, 0x1D, 0x8C, 0x02, 0x1E, 0x65, 0xB8, 0x91,
                                            0xC2, 0xA2, 0x11, 0x16, 0x7A, 0xBB, 0x8C, 0x5E, 0x07, 0x9E, 0x09, 0xE2, 0xC8, 0xA8, 0x33, 0x9C};
    switch (message[0]) {
        case 1: return "ClientHello";
        case 2: return size >= 38 && std::equal(retry, retry + 32, message + 6) ? "HelloRetryRequest" : "ServerHello";
        case 4: return "NewSessionTicket";
        case 8: return "EncryptedExtensions";
        case 11: return "Certificate";
        case 12: return "ServerKeyExchange";
        case 13: return "CertificateRequest";
        case 14: return "ServerHelloDone";
        case 15: return "CertificateVerify";
        case 16: return "ClientKeyExchange";
        case 20: return "Finished";
        case 24: return "KeyUpdate";
        default: return "handshake type " + std::to_string(message[0]);
    }
}

inline void traceMessage(int writing, int, int contentType, const void* buf, size_t size, SSL* ssl, void* arg) {
    if (writing) return;
    Trace& trace = *static_cast<Trace*>(arg);
    const int receiver = ssl == trace.client ? 0 : 1;
    const auto* bytes = static_cast<const unsigned char*>(buf);
    const auto note = [&](const std::string& type, bool encrypted) {
        trace.messages.push_back(Json().text("from", receiver == 0 ? "server" : "client").text("type", type).number("bytes", static_cast<long long>(size)).flag("encrypted", encrypted).str());
    };
    // Record headers come first: TLS 1.3 wraps encrypted records as application data, TLS 1.2
    // encrypts everything after a ChangeCipherSpec. TLS 1.3 still sends one for old middleboxes.
    if (contentType == SSL3_RT_HEADER && size >= 1) {
        trace.encrypted[receiver] = trace.cipherOn[receiver] || bytes[0] == SSL3_RT_APPLICATION_DATA;
        if (bytes[0] == SSL3_RT_CHANGE_CIPHER_SPEC) {
            trace.messages.push_back(Json().text("from", receiver == 0 ? "server" : "client").text("type", "ChangeCipherSpec").number("bytes", 1).flag("encrypted", false).str());
            if (SSL_version(ssl) < TLS1_3_VERSION) trace.cipherOn[receiver] = true;
        }
    } else if (contentType == SSL3_RT_ALERT && size >= 2) {
        note(std::string("Alert: ") + SSL_alert_desc_string_long(bytes[1]), trace.encrypted[receiver]);
    } else if (contentType == SSL3_RT_HANDSHAKE && size >= 1) {
        note(handshakeName(bytes, size), trace.encrypted[receiver]);
    }
}

inline const char* recordName(int type) {
    switch (type) {
        case SSL3_RT_CHANGE_CIPHER_SPEC: return "change_cipher_spec";
        case SSL3_RT_ALERT: return "alert";
        case SSL3_RT_HANDSHAKE: return "handshake";
        case SSL3_RT_APPLICATION_DATA: return "application_data";
        default: return "unknown";
    }
}

// The bytes each side put on the wire, record by record.
struct Wire {
    std::vector<std::string> records;
    std::string toServer;
    std::string toClient;
    bool tamperPending = false;
    std::string tampered;
};

inline std::string takePending(BIO* bio) {
    std::string data(BIO_ctrl_pending(bio), '\0');
    if (!data.empty()) BIO_read(bio, &data[0], static_cast<int>(data.size()));
    return data;
}

// Carries one flight from `out` to `in`. On the way to the client, a pending tamper flips the
// lowest bit of the first byte of the first encrypted record.
inline size_t carry(BIO* out, BIO* in, bool toServer, Wire& wire) {
    std::string bytes = takePending(out);
    size_t at = 0;
    while (at + 5 <= bytes.size()) {
        const int type = static_cast<unsigned char>(bytes[at]);
        const size_t length = static_cast<size_t>(static_cast<unsigned char>(bytes[at + 3])) << 8 | static_cast<unsigned char>(bytes[at + 4]);
        if (!toServer && wire.tamperPending && type == SSL3_RT_APPLICATION_DATA && length > 0) {
            bytes[at + 5] = static_cast<char>(bytes[at + 5] ^ 0x01);
            wire.tamperPending = false;
            wire.tampered = "record " + std::to_string(wire.records.size() + 1) + ", the first byte of " + std::to_string(length) + " encrypted bytes";
        }
        wire.records.push_back(Json().text("from", toServer ? "client" : "server").text("type", recordName(type)).number("bytes", static_cast<long long>(5 + length)).str());
        at += 5 + length;
    }
    (toServer ? wire.toServer : wire.toClient) += bytes;
    if (!bytes.empty()) BIO_write(in, bytes.data(), static_cast<int>(bytes.size()));
    return bytes.size();
}

inline size_t count(const std::string& haystack, const std::string& needle) {
    size_t found = 0;
    for (size_t at = haystack.find(needle); at != std::string::npos; at = haystack.find(needle, at + 1)) found += 1;
    return found;
}

// What an observer reads from the ClientHello and ServerHello on the wire: the offered and chosen
// key shares, the server names in clear text and whether Encrypted Client Hello is on.
struct Hellos {
    std::vector<std::pair<int, size_t>> clientShares;
    std::vector<std::string> serverNames;
    bool echOffered = false;
    int serverGroup = 0;
    size_t serverShare = 0;
};

inline size_t readU16(const unsigned char* data) { return static_cast<size_t>(data[0]) << 8 | data[1]; }

// Walks the extensions of the first hello in one direction's bytes: a record header, a handshake
// header, then the hello body.
template <typename Visit>
inline void extensions(const std::string& wire, bool client, Visit visit) {
    const auto* p = reinterpret_cast<const unsigned char*>(wire.data());
    const size_t size = wire.size();
    if (size < 9 || p[0] != SSL3_RT_HANDSHAKE || p[5] != (client ? 1 : 2)) return;
    size_t at = 9 + 2 + 32;
    if (at >= size) return;
    at += 1 + p[at];
    if (client) {
        if (at + 2 > size) return;
        at += 2 + readU16(p + at);
        if (at >= size) return;
        at += 1 + p[at];
    } else {
        at += 3;
    }
    if (at + 2 > size) return;
    const size_t end = std::min(size, at + 2 + readU16(p + at));
    at += 2;
    while (at + 4 <= end) {
        const size_t length = readU16(p + at + 2);
        if (at + 4 + length > end) return;
        visit(static_cast<int>(readU16(p + at)), p + at + 4, length);
        at += 4 + length;
    }
}

inline Hellos readHellos(const Wire& wire) {
    Hellos hellos;
    extensions(wire.toServer, true, [&](int type, const unsigned char* data, size_t length) {
        if (type == 0x0033) {
            for (size_t i = 2; i + 4 <= length; i += 4 + readU16(data + i + 2)) hellos.clientShares.emplace_back(static_cast<int>(readU16(data + i)), readU16(data + i + 2));
        } else if (type == 0x0000) {
            for (size_t i = 2; i + 3 <= length; i += 3 + readU16(data + i + 1)) {
                const size_t n = std::min(readU16(data + i + 1), length - i - 3);
                hellos.serverNames.emplace_back(reinterpret_cast<const char*>(data + i + 3), n);
            }
        } else if (type == 0xfe0d) {
            hellos.echOffered = true;
        }
    });
    extensions(wire.toClient, false, [&](int type, const unsigned char* data, size_t length) {
        if (type == 0x0033 && length >= 2) {
            hellos.serverGroup = static_cast<int>(readU16(data));
            hellos.serverShare = length >= 4 ? readU16(data + 2) : 0;
        }
    });
    return hellos;
}

inline const char* echStatusName(int status) {
    switch (status) {
        case SSL_ECH_STATUS_SUCCESS: return "success";
        case SSL_ECH_STATUS_GREASE: return "grease";
        case SSL_ECH_STATUS_FAILED: return "failed";
        case SSL_ECH_STATUS_NOT_TRIED: return "not tried";
        case SSL_ECH_STATUS_BAD_NAME: return "bad name";
        case SSL_ECH_STATUS_NOT_CONFIGURED: return "not configured";
        case SSL_ECH_STATUS_FAILED_ECH: return "failed, retry config sent";
        default: return "other";
    }
}

// The server's ECH key pair for public.example, loaded the way a server loads the ech.pem that
// `openssl ech` writes, and the ECHConfigList a DNS HTTPS record would publish for clients: the
// base64 of the ECHCONFIG block in that PEM.
//
// OpenSSL 4.0.2 needs the PEM round trip: an entry made by OSSL_ECHSTORE_new_config keeps the
// length-prefixed ECHConfigList as its encoding and derives the HPKE info from it, while clients
// that read the published list use the ECHConfig alone, as RFC 9849 has it, so the server takes
// their offer for GREASE. OSSL_ECHSTORE_ALL has the same prefix twice and does not read back.
struct EchKeys {
    OSSL_ECHSTORE* server = nullptr;
    std::string configList;
    ~EchKeys() { OSSL_ECHSTORE_free(server); }
};

inline void makeEchKeys(EchKeys& keys) {
    OSSL_ECHSTORE* generated = OSSL_ECHSTORE_new(nullptr, nullptr);
    OSSL_HPKE_SUITE suite = OSSL_HPKE_SUITE_DEFAULT;
    BIO* out = BIO_new(BIO_s_mem());
    const bool written = generated && OSSL_ECHSTORE_new_config(generated, OSSL_ECH_CURRENT_VERSION, 0, PUBLIC_NAME, suite) == 1
        && OSSL_ECHSTORE_write_pem(generated, 0, out) == 1;
    OSSL_ECHSTORE_free(generated);
    const std::string pem = drain(out);
    keys.server = OSSL_ECHSTORE_new(nullptr, nullptr);
    BIO* in = BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size()));
    const bool loaded = written && keys.server && OSSL_ECHSTORE_read_pem(keys.server, in, OSSL_ECH_NO_RETRY) == 1;
    BIO_free(in);
    if (!loaded) fail("cannot make the ECH keys");
    const std::string begin = "-----BEGIN ECHCONFIG-----";
    const size_t start = pem.find(begin);
    const size_t end = pem.find("-----END ECHCONFIG-----");
    if (start == std::string::npos || end == std::string::npos) fail("no ECHConfigList in the ECH store");
    for (size_t i = start + begin.size(); i < end; i += 1) {
        if (pem[i] != '\n' && pem[i] != '\r') keys.configList += pem[i];
    }
}

struct Contexts {
    SSL_CTX* server = nullptr;
    SSL_CTX* client = nullptr;
    OSSL_ECHSTORE* clientEch = nullptr;
    ~Contexts() {
        OSSL_ECHSTORE_free(clientEch);
        SSL_CTX_free(client);
        SSL_CTX_free(server);
    }
};

inline void configure(Contexts& contexts, const ServerIdentity& identity, const TlsOptions& options, const EchKeys* ech) {
    contexts.server = SSL_CTX_new(TLS_server_method());
    contexts.client = SSL_CTX_new(TLS_client_method());
    bool ready = contexts.server && contexts.client && SSL_CTX_use_certificate(contexts.server, identity.cert.get()) == 1
        && SSL_CTX_use_PrivateKey(contexts.server, identity.key.get()) == 1
        && X509_STORE_add_cert(SSL_CTX_get_cert_store(contexts.client), identity.ca.get()) == 1;
    if (ready) SSL_CTX_set_verify(contexts.client, SSL_VERIFY_PEER, nullptr);
    if (ready && !options.groups.empty()) {
        ready = SSL_CTX_set1_groups_list(contexts.client, options.groups.c_str()) == 1 && SSL_CTX_set1_groups_list(contexts.server, options.groups.c_str()) == 1;
    }
    if (ready && options.tls12) ready = SSL_CTX_set_max_proto_version(contexts.client, TLS1_2_VERSION) == 1;
    if (ready && ech) {
        contexts.clientEch = OSSL_ECHSTORE_new(nullptr, nullptr);
        BIO* in = BIO_new_mem_buf(ech->configList.data(), static_cast<int>(ech->configList.size()));
        ready = contexts.clientEch && OSSL_ECHSTORE_read_echconfiglist(contexts.clientEch, in) == 1 && SSL_CTX_set1_echstore(contexts.server, ech->server) == 1
            && SSL_CTX_set1_echstore(contexts.client, contexts.clientEch) == 1;
        BIO_free(in);
    }
    if (!ready) fail("cannot configure the TLS contexts");
}

struct Side {
    SSL* ssl = nullptr;
    BIO* in = nullptr;
    BIO* out = nullptr;
    bool done = false;
    std::string error;
    ~Side() { SSL_free(ssl); }
};

inline void open(Side& side, SSL_CTX* context, Trace& trace) {
    side.ssl = SSL_new(context);
    side.in = BIO_new(BIO_s_mem());
    side.out = BIO_new(BIO_s_mem());
    if (!side.ssl || !side.in || !side.out) fail("cannot open a TLS connection");
    BIO_set_mem_eof_return(side.in, -1);
    SSL_set_bio(side.ssl, side.in, side.out);
    SSL_set_msg_callback(side.ssl, traceMessage);
    SSL_set_msg_callback_arg(side.ssl, &trace);
}

// Advances one side's handshake; a failure keeps OpenSSL's reason.
inline void step(Side& side) {
    if (side.done || !side.error.empty()) return;
    const int result = SSL_do_handshake(side.ssl);
    if (result == 1) {
        side.done = true;
    } else if (SSL_get_error(side.ssl, result) != SSL_ERROR_WANT_READ) {
        const std::string reason = takeError();
        side.error = reason.empty() ? "handshake failed" : reason;
    }
}

inline std::string runHandshake(const ServerIdentity& identity, const TlsOptions& options) {
    EchKeys ech;
    if (options.ech) makeEchKeys(ech);
    Contexts contexts;
    configure(contexts, identity, options, options.ech ? &ech : nullptr);
    Trace trace;
    Wire wire;
    wire.tamperPending = options.tamper;
    Side client;
    Side server;
    open(client, contexts.client, trace);
    open(server, contexts.server, trace);
    trace.client = client.ssl;
    SSL_set_tlsext_host_name(client.ssl, SECRET_NAME);
    SSL_set1_host(client.ssl, SECRET_NAME);
    SSL_set_connect_state(client.ssl);
    SSL_set_accept_state(server.ssl);

    for (int round = 0; round < 8 && !(client.done && server.done); round += 1) {
        step(client);
        const size_t sent = carry(client.out, server.in, true, wire);
        step(server);
        const size_t answered = carry(server.out, client.in, false, wire);
        if (!sent && !answered && (!client.error.empty() || !server.error.empty())) break;
    }

    // Application data both ways: the request, then the response. The server's session tickets
    // travel ahead of the response, so the client reads them here too.
    std::string received;
    std::string reply;
    if (client.done && server.done) {
        SSL_write(client.ssl, REQUEST, static_cast<int>(std::char_traits<char>::length(REQUEST)));
        carry(client.out, server.in, true, wire);
        std::string buffer(4096, '\0');
        const int read = SSL_read(server.ssl, &buffer[0], static_cast<int>(buffer.size()));
        if (read > 0) received.assign(buffer.data(), static_cast<size_t>(read));
        SSL_write(server.ssl, RESPONSE, static_cast<int>(std::char_traits<char>::length(RESPONSE)));
        carry(server.out, client.in, false, wire);
        const int answer = SSL_read(client.ssl, &buffer[0], static_cast<int>(buffer.size()));
        if (answer > 0) reply.assign(buffer.data(), static_cast<size_t>(answer));
        ERR_clear_error();
    }

    const Hellos hellos = readHellos(wire);
    std::vector<std::string> shares;
    // SSL_group_to_name takes a NID, or TLSEXT_nid_unknown with the IANA group id the wire carries.
    for (const auto& share : hellos.clientShares) {
        const char* name = SSL_group_to_name(client.ssl, TLSEXT_nid_unknown | share.first);
        shares.push_back(Json().text("group", name ? name : std::to_string(share.first)).number("bytes", static_cast<long long>(share.second)).str());
    }
    std::vector<std::string> names;
    for (const auto& name : hellos.serverNames) names.push_back(quote(name));
    const char* serverGroup = hellos.serverGroup ? SSL_group_to_name(client.ssl, TLSEXT_nid_unknown | hellos.serverGroup) : nullptr;

    const bool connected = client.done && server.done;
    const char* signature = nullptr;
    if (connected) SSL_get0_peer_signature_name(client.ssl, &signature);
    const char* group = connected ? SSL_get0_group_name(client.ssl) : nullptr;
    const SSL_CIPHER* cipher = connected ? SSL_get_current_cipher(client.ssl) : nullptr;
    const bool sawCertificate = SSL_get0_peer_certificate(client.ssl) != nullptr;
    const std::string wireText = wire.toServer + wire.toClient;

    Json json;
    json.flag("ok", connected && received == REQUEST && reply == RESPONSE)
        .text("version", connected ? SSL_get_version(client.ssl) : "")
        .text("cipher", cipher ? SSL_CIPHER_get_name(cipher) : "")
        .text("group", group ? group : "")
        .text("signature", signature ? signature : "")
        .text("verify", sawCertificate ? X509_verify_cert_error_string(SSL_get_verify_result(client.ssl)) : "")
        .text("certificate", keyType(identity.key.get()))
        .raw("clientShares", array(shares))
        .text("serverGroup", serverGroup ? serverGroup : "")
        .number("serverShare", static_cast<long long>(hellos.serverShare))
        .raw("serverNames", array(names))
        .flag("echOffered", hellos.echOffered)
        .raw("messages", array(trace.messages))
        .raw("records", array(wire.records))
        .number("bytesToServer", static_cast<long long>(wire.toServer.size()))
        .number("bytesToClient", static_cast<long long>(wire.toClient.size()))
        .number("secretNameOnWire", static_cast<long long>(count(wireText, SECRET_NAME)))
        .number("publicNameOnWire", static_cast<long long>(count(wireText, PUBLIC_NAME)))
        .text("request", received)
        .text("response", reply)
        .number("requestOnWire", static_cast<long long>(count(wireText, "GET /inbox")))
        .text("tampered", wire.tampered)
        .text("clientError", client.error)
        .text("serverError", server.error);
    if (options.ech) {
        char* inner = nullptr;
        char* outer = nullptr;
        const int status = SSL_ech_get1_status(client.ssl, &inner, &outer);
        json.raw("ech", Json().text("status", echStatusName(status)).text("inner", inner ? inner : "").text("outer", outer ? outer : "").text("configList", ech.configList).str());
        OPENSSL_free(inner);
        OPENSSL_free(outer);
    }
    ERR_clear_error();
    return json.str();
}

}  // namespace sslapp
