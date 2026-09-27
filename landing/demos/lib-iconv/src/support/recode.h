#pragma once

#include <iconv.h>

#include <cerrno>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// The conversion loop the apps share. It never throws on bad input: it reports where and why a strict
// conversion stopped, because the apps try many encodings and most attempts are expected to fail.
namespace recode {

struct Result {
    bool ok = false;
    std::string output;  // everything converted before the stop
    int error = 0;       // EILSEQ, EINVAL, or 0
    size_t at = 0;       // input offset of the stop
    size_t changed = 0;  // characters transliterated or dropped (//TRANSLIT, //IGNORE)
};

// Browsers read the bytes a Windows code page leaves undefined (0x81 in windows-1252, for one) as the
// C1 control with the same number; those are the WHATWG single-byte indexes. libiconv rejects such
// bytes, but iconvctl(ICONV_SET_FALLBACKS) lets a caller decide: these fallbacks map them both ways
// and flag anything else, so the conversion stays strict.
class Descriptor;

namespace detail {

inline void c1Character(const char* bytes, size_t count, void (*write)(const unsigned int*, size_t, void*), void* argument, void* data) {
    const auto byte = static_cast<unsigned char>(bytes[0]);
    if (count == 1 && byte >= 0x80 && byte <= 0x9F) {
        const unsigned int character = byte;
        write(&character, 1, argument);
        return;
    }
    *static_cast<bool*>(data) = true;
}

inline void c1Byte(unsigned int code, void (*write)(const char*, size_t, void*), void* argument, void* data) {
    if (code >= 0x80 && code <= 0x9F) {
        const char byte = static_cast<char>(code);
        write(&byte, 1, argument);
        return;
    }
    *static_cast<bool*>(data) = true;
}

}  // namespace detail

class Descriptor {
public:
    Descriptor(const std::string& to, const std::string& from) : cd(iconv_open(to.c_str(), from.c_str())) {}
    Descriptor(const Descriptor&) = delete;
    Descriptor& operator=(const Descriptor&) = delete;
    ~Descriptor() {
        if (valid()) iconv_close(cd);
    }
    bool valid() const { return cd != reinterpret_cast<iconv_t>(-1); }
    iconv_t get() const { return cd; }

    // Reads and writes undefined Windows code page bytes as C1 controls, as browsers do.
    void readLikeBrowsers() {
        iconv_fallbacks fallbacks = {detail::c1Character, detail::c1Byte, nullptr, nullptr, &fallbackMissed};
        iconvctl(cd, ICONV_SET_FALLBACKS, &fallbacks);
    }
    bool missed() const { return fallbackMissed; }
    void clearMissed() { fallbackMissed = false; }

private:
    iconv_t cd;
    bool fallbackMissed = false;
};

// One iconv call over the whole input, so the count of changed characters is exact, then the call
// without input that ends a stateful encoding. The output buffer grows until everything fits.
inline Result run(Descriptor& cd, const std::string& input) {
    for (size_t capacity = input.size() * 2 + 16;; capacity *= 2) {
        Result result;
        cd.clearMissed();
        iconv(cd.get(), nullptr, nullptr, nullptr, nullptr);
        std::vector<char> output(capacity);
        char* in = const_cast<char*>(input.data());
        size_t inLeft = input.size();
        char* out = output.data();
        size_t outLeft = capacity;
        const size_t status = iconv(cd.get(), &in, &inLeft, &out, &outLeft);
        const int error = status == static_cast<size_t>(-1) ? errno : cd.missed() ? EILSEQ : 0;
        if (error == E2BIG) continue;
        if (!error && iconv(cd.get(), nullptr, nullptr, &out, &outLeft) == static_cast<size_t>(-1)) continue;
        result.ok = error == 0;
        result.output.assign(output.data(), capacity - outLeft);
        result.error = error;
        result.at = input.size() - inLeft;
        result.changed = error ? 0 : status;
        return result;
    }
}

inline Result convert(const std::string& input, const std::string& from, const std::string& to, bool likeBrowsers = false) {
    Descriptor cd(to, from);
    if (!cd.valid()) throw std::invalid_argument("iconv cannot convert " + from + " to " + to);
    if (likeBrowsers) cd.readLikeBrowsers();
    return run(cd, input);
}

}  // namespace recode
