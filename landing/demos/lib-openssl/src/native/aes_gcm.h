#pragma once

#include <openssl/crypto.h>
#include <openssl/err.h>
#include <openssl/evp.h>

#include <memory>
#include <stdexcept>
#include <string>

// AES in GCM mode: encryption and an authentication tag in one pass. The key is 16, 24 or 32 bytes
// (AES-128, -192 or -256) and every message needs a fresh 12-byte nonce; reusing a nonce with the
// same key gives the plaintext away.
class AesGcm {
public:
    explicit AesGcm(const std::string& keyHex) : key(fromHex(keyHex)) {
        if (key.size() != 16 && key.size() != 24 && key.size() != 32) throw std::invalid_argument("AES keys are 16, 24 or 32 bytes");
    }
    ~AesGcm() { OPENSSL_cleanse(&key[0], key.size()); }
    AesGcm(const AesGcm&) = delete;
    AesGcm& operator=(const AesGcm&) = delete;

    // The ciphertext followed by the 16-byte tag, in hex: the layout WebCrypto's AES-GCM uses too.
    // `aad` is authenticated but not encrypted, such as a record id the ciphertext belongs to.
    std::string encrypt(const std::string& nonceHex, const std::string& plaintext, const std::string& aad) {
        Context context(start(1, nonceHex, aad));
        std::string out(plaintext.size() + TAG_SIZE, '\0');
        int written = 0;
        int last = 0;
        if (!EVP_EncryptUpdate(context.get(), bytes(out), &written, bytes(plaintext), static_cast<int>(plaintext.size()))
            || !EVP_EncryptFinal_ex(context.get(), bytes(out) + written, &last)
            || !EVP_CIPHER_CTX_ctrl(context.get(), EVP_CTRL_AEAD_GET_TAG, TAG_SIZE, bytes(out) + written + last)) {
            fail("encryption failed");
        }
        return toHex(out);
    }

    // Throws unless the tag matches, so a changed byte anywhere in the ciphertext, the tag, the nonce
    // or the AAD is refused, never decrypted to garbage.
    std::string decrypt(const std::string& nonceHex, const std::string& sealedHex, const std::string& aad) {
        std::string sealed = fromHex(sealedHex);
        if (sealed.size() < TAG_SIZE) throw std::invalid_argument("shorter than a tag");
        const size_t size = sealed.size() - TAG_SIZE;
        Context context(start(0, nonceHex, aad));
        std::string out(size, '\0');
        int written = 0;
        int last = 0;
        if (!EVP_DecryptUpdate(context.get(), bytes(out), &written, bytes(sealed), static_cast<int>(size))
            || !EVP_CIPHER_CTX_ctrl(context.get(), EVP_CTRL_AEAD_SET_TAG, TAG_SIZE, bytes(sealed) + size)
            || EVP_DecryptFinal_ex(context.get(), bytes(out) + written, &last) != 1) {
            OPENSSL_cleanse(&out[0], out.size());
            fail("authentication failed: wrong key, nonce or AAD, or the data was changed");
        }
        return out;
    }

private:
    static constexpr int TAG_SIZE = 16;
    struct Free {
        void operator()(EVP_CIPHER_CTX* context) const { EVP_CIPHER_CTX_free(context); }
    };
    using Context = std::unique_ptr<EVP_CIPHER_CTX, Free>;

    std::string key;

    EVP_CIPHER_CTX* start(int encrypting, const std::string& nonceHex, const std::string& aad) {
        const std::string nonce = fromHex(nonceHex);
        if (nonce.size() != 12) throw std::invalid_argument("GCM nonces here are 12 bytes");
        const char* name = key.size() == 32 ? "AES-256-GCM" : key.size() == 24 ? "AES-192-GCM" : "AES-128-GCM";
        EVP_CIPHER* cipher = EVP_CIPHER_fetch(nullptr, name, nullptr);
        EVP_CIPHER_CTX* context = EVP_CIPHER_CTX_new();
        int ignored = 0;
        const bool ready = cipher && context && EVP_CipherInit_ex2(context, cipher, bytes(key), bytes(nonce), encrypting, nullptr)
            && (aad.empty() || EVP_CipherUpdate(context, nullptr, &ignored, bytes(aad), static_cast<int>(aad.size())));
        EVP_CIPHER_free(cipher);
        if (!ready) {
            EVP_CIPHER_CTX_free(context);
            fail("cannot start AES-GCM");
        }
        return context;
    }

    static unsigned char* bytes(std::string& data) { return reinterpret_cast<unsigned char*>(&data[0]); }
    static const unsigned char* bytes(const std::string& data) { return reinterpret_cast<const unsigned char*>(data.data()); }

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
