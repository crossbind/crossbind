#pragma once

#include <iconv.h>

#include <cerrno>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Decodes bytes that arrive in pieces (a fetch body, a WebSocket, a serial port) into UTF-8 text.
// A piece can end in the middle of a multibyte character: iconv then stops with EINVAL, and those
// bytes wait for the next piece. The calls follow Node's StringDecoder: write() every piece, then end().
class StreamDecoder {
public:
    explicit StreamDecoder(const std::string& encoding) : cd(open(encoding), iconv_close), encoding(encoding) {}

    std::string write(const std::u16string& piece) {
        for (char16_t unit : piece) {
            if (unit > 0xFF) throw std::invalid_argument("not a byte string");
            pending += static_cast<char>(unit);
        }
        std::string text;
        std::vector<char> buffer(4096);
        char* in = &pending[0];
        size_t inLeft = pending.size();
        while (inLeft > 0) {
            char* out = buffer.data();
            size_t outLeft = buffer.size();
            const size_t status = iconv(cd.get(), &in, &inLeft, &out, &outLeft);
            text.append(buffer.data(), buffer.size() - outLeft);
            if (status != static_cast<size_t>(-1) || errno == E2BIG) continue;
            if (errno == EINVAL) {  // the piece ends inside a character: keep its bytes for the next one
                cuts += 1;
                break;
            }
            throw std::runtime_error("invalid " + encoding + " input at byte " + std::to_string(position + pending.size() - inLeft));
        }
        position += pending.size() - inLeft;
        pending.erase(0, pending.size() - inLeft);
        return text;
    }

    // The stream is over: bytes still waiting are a character that never finished.
    void end() {
        const size_t left = pending.size();
        pending.clear();
        position = 0;
        iconv(cd.get(), nullptr, nullptr, nullptr, nullptr);
        if (left) throw std::runtime_error(encoding + " stream ends inside a character, " + std::to_string(left) + " byte(s) left over");
    }

    // How many pieces ended inside a character.
    int splits() const { return cuts; }

private:
    static iconv_t open(const std::string& encoding) {
        const iconv_t cd = iconv_open("UTF-8", encoding.c_str());
        if (cd == reinterpret_cast<iconv_t>(-1)) throw std::invalid_argument("iconv cannot decode " + encoding);
        return cd;
    }

    std::unique_ptr<void, int (*)(iconv_t)> cd;
    std::string encoding;
    std::string pending;
    size_t position = 0;
    int cuts = 0;
};
