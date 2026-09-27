#pragma once

#include <openssl/err.h>
#include <openssl/evp.h>

#include <stdexcept>
#include <string>

// Digests and HMAC by algorithm name: "SHA256", "SHA3-256", "BLAKE2B-512", "SHA512-256", "SM3" or
// any other digest OpenSSL's default provider has. Text goes in as its UTF-8 bytes.
class Digest {
public:
    // Streaming: update with the data in as many pieces as it arrives in, then read the digest once.
    explicit Digest(const std::string& algorithm) : context(EVP_MD_CTX_new()) {
        EVP_MD* md = EVP_MD_fetch(nullptr, algorithm.c_str(), nullptr);
        const bool ready = md && EVP_DigestInit_ex2(context, md, nullptr);
        EVP_MD_free(md);
        if (!ready) fail("unknown digest " + algorithm);
    }
    ~Digest() { EVP_MD_CTX_free(context); }
    Digest(const Digest&) = delete;
    Digest& operator=(const Digest&) = delete;

    void update(const std::string& data) {
        if (!EVP_DigestUpdate(context, data.data(), data.size())) fail("digest update failed");
    }

    std::string hex() {
        unsigned char digest[EVP_MAX_MD_SIZE];
        unsigned int size = 0;
        if (!EVP_DigestFinal_ex(context, digest, &size)) fail("digest already read");
        return toHex(digest, size);
    }

    // One call for data that is already in memory.
    static std::string of(const std::string& algorithm, const std::string& data) {
        unsigned char digest[EVP_MAX_MD_SIZE];
        size_t size = 0;
        if (!EVP_Q_digest(nullptr, algorithm.c_str(), nullptr, data.data(), data.size(), digest, &size)) fail("unknown digest " + algorithm);
        return toHex(digest, size);
    }

    // HMAC with the named digest, as webhooks and API request signatures use it.
    static std::string hmac(const std::string& algorithm, const std::string& key, const std::string& data) {
        unsigned char mac[EVP_MAX_MD_SIZE];
        size_t size = 0;
        const auto* bytes = reinterpret_cast<const unsigned char*>(data.data());
        if (!EVP_Q_mac(nullptr, "HMAC", nullptr, algorithm.c_str(), nullptr, key.data(), key.size(), bytes, data.size(), mac, sizeof mac, &size)) {
            fail("HMAC with " + algorithm + " failed");
        }
        return toHex(mac, size);
    }

private:
    EVP_MD_CTX* context;

    static std::string toHex(const unsigned char* data, size_t size) {
        static const char hex[] = "0123456789abcdef";
        std::string out;
        for (size_t i = 0; i < size; i += 1) {
            out += hex[data[i] >> 4];
            out += hex[data[i] & 0x0F];
        }
        return out;
    }

    [[noreturn]] static void fail(const std::string& what) {
        ERR_clear_error();
        throw std::runtime_error(what);
    }
};
