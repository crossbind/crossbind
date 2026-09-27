#pragma once

#include <iconv.h>

#include <cerrno>
#include <memory>
#include <stdexcept>
#include <string>

// Encodes UTF-8 text for a target named the way iconv_open takes it: "ISO-8859-1" stops at the first
// character the encoding lacks, "ISO-8859-1//TRANSLIT" approximates it (€ becomes EUR) and
// "ISO-8859-1//IGNORE" drops it. The descriptor is opened once and reused for every call.
class LegacyEncoder {
public:
    explicit LegacyEncoder(const std::string& target) : cd(open(target), iconv_close), target(target) {}

    std::u16string encode(const std::string& text) {
        // iconv returns how many characters it changed only when a call succeeds, so the whole text
        // goes in one call, into a buffer that grows until it fits.
        for (size_t capacity = text.size() * 2 + 16;; capacity *= 2) {
            iconv(cd.get(), nullptr, nullptr, nullptr, nullptr);  // back to the initial state
            std::string output(capacity, '\0');
            char* in = const_cast<char*>(text.data());
            size_t inLeft = text.size();
            char* out = &output[0];
            size_t outLeft = capacity;
            const size_t status = iconv(cd.get(), &in, &inLeft, &out, &outLeft);
            if (status == static_cast<size_t>(-1) && errno != E2BIG) throw std::runtime_error(missing(text, text.size() - inLeft));
            if (status == static_cast<size_t>(-1) || iconv(cd.get(), nullptr, nullptr, &out, &outLeft) == static_cast<size_t>(-1)) continue;
            changes = status;
            std::u16string bytes(capacity - outLeft, u'\0');
            for (size_t i = 0; i < bytes.size(); ++i) bytes[i] = static_cast<unsigned char>(output[i]);
            return bytes;
        }
    }

    // How many characters the last encode approximated or dropped.
    int changed() const { return static_cast<int>(changes); }

private:
    static iconv_t open(const std::string& target) {
        const iconv_t cd = iconv_open(target.c_str(), "UTF-8");
        if (cd == reinterpret_cast<iconv_t>(-1)) throw std::invalid_argument("iconv cannot encode to " + target);
        return cd;
    }

    std::string missing(const std::string& text, size_t at) const {
        const auto lead = static_cast<unsigned char>(text[at]);
        const size_t length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
        size_t character = 0;
        for (size_t i = 0; i < at; ++i) character += (static_cast<unsigned char>(text[i]) & 0xC0) != 0x80;
        return target + " has no \"" + text.substr(at, length) + "\" (character " + std::to_string(character) + ")";
    }

    std::unique_ptr<void, int (*)(iconv_t)> cd;
    std::string target;
    size_t changes = 0;
};
