#pragma once

#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>

#include <stdexcept>
#include <string>

// A fresh key pair, signatures with it, and verification with nothing but the public key's PEM, as
// the receiving side does it. "P-256" signs with ECDSA over SHA-256, "RSA-2048" with PKCS#1 v1.5
// over SHA-256; "ED25519" and the post-quantum "ML-DSA-44", "ML-DSA-65" and "ML-DSA-87" sign the
// message itself.
class KeyPair {
public:
    explicit KeyPair(const std::string& algorithm) : key(generate(algorithm)) {
        if (!key) fail("cannot generate a " + algorithm + " key");
    }
    ~KeyPair() { EVP_PKEY_free(key); }
    KeyPair(const KeyPair&) = delete;
    KeyPair& operator=(const KeyPair&) = delete;

    // "EC", "RSA", "ED25519", "ML-DSA-65", ...
    std::string type() const { return EVP_PKEY_get0_type_name(key); }

    // The strength OpenSSL rates the key at, in bits.
    int securityBits() const { return EVP_PKEY_get_security_bits(key); }

    // The largest signature the key makes, in bytes.
    int maxSignatureSize() const { return EVP_PKEY_get_size(key); }

    // "-----BEGIN PUBLIC KEY-----": what you hand to whoever verifies.
    std::string publicKeyPem() const {
        BIO* out = BIO_new(BIO_s_mem());
        PEM_write_bio_PUBKEY(out, key);
        return drain(out);
    }

    // "-----BEGIN PRIVATE KEY-----", unencrypted PKCS#8: keep it to yourself.
    std::string privateKeyPem() const {
        BIO* out = BIO_new(BIO_s_mem());
        PEM_write_bio_PrivateKey(out, key, nullptr, nullptr, 0, nullptr, nullptr);
        return drain(out);
    }

    // The signature, in hex.
    std::string sign(const std::string& message) const {
        EVP_MD_CTX* context = EVP_MD_CTX_new();
        size_t size = 0;
        std::string signature;
        bool signed_ = EVP_DigestSignInit_ex(context, nullptr, digestFor(key), nullptr, nullptr, key, nullptr) == 1
            && EVP_DigestSign(context, nullptr, &size, bytes(message), message.size()) == 1;
        if (signed_) {
            signature.resize(size);
            signed_ = EVP_DigestSign(context, reinterpret_cast<unsigned char*>(&signature[0]), &size, bytes(message), message.size()) == 1;
            signature.resize(size);
        }
        EVP_MD_CTX_free(context);
        if (!signed_) fail("signing failed");
        return toHex(signature);
    }

    static bool verify(const std::string& publicKeyPem, const std::string& message, const std::string& signatureHex) {
        BIO* input = BIO_new_mem_buf(publicKeyPem.data(), static_cast<int>(publicKeyPem.size()));
        EVP_PKEY* publicKey = PEM_read_bio_PUBKEY(input, nullptr, nullptr, nullptr);
        BIO_free(input);
        if (!publicKey) fail("not a PEM public key");
        const std::string signature = fromHex(signatureHex);
        EVP_MD_CTX* context = EVP_MD_CTX_new();
        const bool valid = EVP_DigestVerifyInit_ex(context, nullptr, digestFor(publicKey), nullptr, nullptr, publicKey, nullptr) == 1
            && EVP_DigestVerify(context, bytes(signature), signature.size(), bytes(message), message.size()) == 1;
        EVP_MD_CTX_free(context);
        EVP_PKEY_free(publicKey);
        ERR_clear_error();
        return valid;
    }

private:
    EVP_PKEY* key;

    static EVP_PKEY* generate(const std::string& algorithm) {
        if (algorithm == "P-256") return EVP_PKEY_Q_keygen(nullptr, nullptr, "EC", "P-256");
        if (algorithm == "RSA-2048") return EVP_PKEY_Q_keygen(nullptr, nullptr, "RSA", static_cast<size_t>(2048));
        return EVP_PKEY_Q_keygen(nullptr, nullptr, algorithm.c_str());
    }

    // ECDSA and RSA sign a digest of the message; Ed25519 and ML-DSA take the message whole.
    static const char* digestFor(const EVP_PKEY* key) { return EVP_PKEY_is_a(key, "EC") || EVP_PKEY_is_a(key, "RSA") ? "SHA256" : nullptr; }

    static const unsigned char* bytes(const std::string& data) { return reinterpret_cast<const unsigned char*>(data.data()); }

    static std::string drain(BIO* out) {
        char* data = nullptr;
        const long size = BIO_get_mem_data(out, &data);
        std::string text(data, size > 0 ? static_cast<size_t>(size) : 0);
        BIO_free(out);
        return text;
    }

    static std::string toHex(const std::string& data) {
        static const char hex[] = "0123456789abcdef";
        std::string out;
        for (const unsigned char byte : data) {
            out += hex[byte >> 4];
            out += hex[byte & 0x0F];
        }
        return out;
    }

    static std::string fromHex(const std::string& hex) {
        const auto nibble = [](char c) {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            throw std::invalid_argument("not hex");
        };
        if (hex.size() % 2) throw std::invalid_argument("hex has an odd length");
        std::string out(hex.size() / 2, '\0');
        for (size_t i = 0; i < out.size(); i += 1) out[i] = static_cast<char>(nibble(hex[2 * i]) * 16 + nibble(hex[2 * i + 1]));
        return out;
    }

    [[noreturn]] static void fail(const std::string& what) {
        ERR_clear_error();
        throw std::runtime_error(what);
    }
};
