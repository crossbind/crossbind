#pragma once

#include <iconv.h>

#include <cerrno>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Strict conversion between UTF-8 text and the bytes of any encoding libiconv knows. Bytes cross the
// binding as a byte string: one UTF-16 code unit (0-255) per byte.
class Charset {
public:
    static std::u16string encode(const std::string& text, const std::string& encoding) {
        const std::string bytes = convert(text, "UTF-8", encoding);
        std::u16string units(bytes.size(), u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) units[i] = static_cast<unsigned char>(bytes[i]);
        return units;
    }

    static std::string decode(const std::u16string& bytes, const std::string& encoding) {
        std::string input(bytes.size(), '\0');
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string");
            input[i] = static_cast<char>(bytes[i]);
        }
        return convert(input, encoding, "UTF-8");
    }

private:
    static std::string convert(const std::string& input, const std::string& from, const std::string& to) {
        const iconv_t opened = iconv_open(to.c_str(), from.c_str());
        if (opened == reinterpret_cast<iconv_t>(-1)) throw std::invalid_argument("iconv cannot convert " + from + " to " + to);
        std::unique_ptr<void, int (*)(iconv_t)> cd(opened, iconv_close);
        std::string output;
        std::vector<char> buffer(4096);
        char* in = const_cast<char*>(input.data());
        size_t inLeft = input.size();
        for (;;) {
            char* out = buffer.data();
            size_t outLeft = buffer.size();
            // Once the input is used up, a call without input ends a stateful encoding (ISO-2022-JP
            // switches back to ASCII); for the others it writes nothing.
            const bool finishing = inLeft == 0;
            const size_t status = finishing ? iconv(cd.get(), nullptr, nullptr, &out, &outLeft) : iconv(cd.get(), &in, &inLeft, &out, &outLeft);
            output.append(buffer.data(), buffer.size() - outLeft);
            if (status != static_cast<size_t>(-1)) {
                if (finishing) return output;
            } else if (errno != E2BIG) {  // E2BIG only means the buffer is full, and it was just emptied
                const size_t at = input.size() - inLeft;
                if (errno == EINVAL) throw std::runtime_error("incomplete " + from + " input at byte " + std::to_string(at));
                if (from != "UTF-8") throw std::runtime_error("invalid " + from + " input at byte " + std::to_string(at));
                throw std::runtime_error(missing(input, at, to));
            }
        }
    }

    // Text coming from JavaScript is valid UTF-8, so EILSEQ means the target has no such character.
    static std::string missing(const std::string& text, size_t at, const std::string& to) {
        const auto lead = static_cast<unsigned char>(text[at]);
        const size_t length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
        unsigned long codePoint = length == 1 ? lead : lead & (0xFF >> (length + 1));
        for (size_t i = 1; i < length; ++i) codePoint = (codePoint << 6) | (static_cast<unsigned char>(text[at + i]) & 0x3F);
        size_t character = 0;
        for (size_t i = 0; i < at; ++i) character += (static_cast<unsigned char>(text[i]) & 0xC0) != 0x80;
        char name[16];
        std::snprintf(name, sizeof name, "U+%04lX", codePoint);
        return "cannot encode " + std::string(name) + " at character " + std::to_string(character) + " in " + to;
    }
};
