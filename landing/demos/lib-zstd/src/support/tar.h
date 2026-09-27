#pragma once

#ifndef ZSTD_STATIC_LINKING_ONLY
#define ZSTD_STATIC_LINKING_ONLY
#endif
#include <zstd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Streaming .tar.zst: zstd decodes the file in ZSTD_DStreamOutSize() steps and the tar headers are
// read as they go by, so memory stays flat whatever the archive size.
namespace tarzst {

inline size_t check(size_t code) {
    if (ZSTD_isError(code)) throw std::runtime_error(ZSTD_getErrorName(code));
    return code;
}

inline std::string octal(unsigned long long value, int digits) {
    std::string text(static_cast<size_t>(digits), '0');
    for (int index = digits - 1; index >= 0 && value; index -= 1, value >>= 3) text[static_cast<size_t>(index)] = static_cast<char>('0' + (value & 7));
    return text;
}

// One POSIX ustar header for a regular file.
inline std::string fileHeader(const std::string& name, size_t size, unsigned long long mtime) {
    std::string block(512, '\0');
    const auto put = [&block](size_t offset, const std::string& text) { block.replace(offset, text.size(), text); };
    put(0, name.substr(0, 100));
    put(100, octal(0644, 7));
    put(108, octal(0, 7));
    put(116, octal(0, 7));
    put(124, octal(size, 11));
    put(136, octal(mtime, 11));
    put(148, "        ");
    block[156] = '0';
    put(257, "ustar");
    put(263, "00");
    put(265, "crossbind");
    put(297, "crossbind");
    unsigned long long sum = 0;
    for (unsigned char character : block) sum += character;
    put(148, octal(sum, 6));
    block[154] = '\0';
    block[155] = ' ';
    return block;
}

inline std::string archive(const std::vector<std::pair<std::string, std::string>>& files, unsigned long long mtime) {
    std::string tar;
    for (const auto& file : files) {
        tar += fileHeader(file.first, file.second.size(), mtime);
        tar += file.second;
        tar.append((512 - file.second.size() % 512) % 512, '\0');
    }
    tar.append(1024, '\0');
    return tar;
}

// Hands the decoded bytes of a .zst file to `sink` chunk by chunk; the sink returns false to stop early.
inline void decompressFile(const std::string& path, const std::function<bool(const char*, size_t)>& sink) {
    std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "rb"), std::fclose);
    if (!file) throw std::runtime_error("cannot open " + path);
    std::unique_ptr<ZSTD_DCtx, size_t (*)(ZSTD_DCtx*)> dctx(ZSTD_createDCtx(), ZSTD_freeDCtx);
    if (!dctx) throw std::runtime_error("zstd could not allocate a decompression context");
    // `zstd --long=30` frames need a 1 GiB window, the most wasm32 can address.
    check(ZSTD_DCtx_setParameter(dctx.get(), ZSTD_d_windowLogMax, 30));
    std::vector<char> in(ZSTD_DStreamInSize());
    std::vector<char> out(ZSTD_DStreamOutSize());
    size_t pending = 0;
    bool any = false;
    size_t count = 0;
    while ((count = std::fread(in.data(), 1, in.size(), file.get())) > 0) {
        any = true;
        ZSTD_inBuffer input = {in.data(), count, 0};
        while (input.pos < input.size) {
            ZSTD_outBuffer output = {out.data(), out.size(), 0};
            pending = check(ZSTD_decompressStream(dctx.get(), &output, &input));
            if (output.pos && !sink(out.data(), output.pos)) return;
        }
    }
    if (!any) throw std::runtime_error("the file is empty");
    if (pending != 0) throw std::runtime_error("the file ends in the middle of a zstd frame");
}

struct Entry {
    std::string name;
    unsigned long long size = 0;
    unsigned long long mtime = 0;
    std::string type;
};

// Reads tar members out of a byte stream. `onEntry` returns true to receive the member's bytes
// through `onData`; either callback returns false to stop. GNU long names and pax path/size records
// override the header that follows them.
class Walker {
public:
    std::function<bool(const Entry&)> onEntry;
    std::function<bool(const char*, size_t)> onData;

    bool isTar() const { return tar; }
    bool finished() const { return ended; }

    bool feed(const char* data, size_t size) {
        size_t at = 0;
        while (at < size && !ended) {
            if (remaining > 0) {
                const size_t take = static_cast<size_t>(std::min<unsigned long long>(remaining, size - at));
                const size_t useful = static_cast<size_t>(std::min<unsigned long long>(payload, take));
                if (useful) {
                    if (collecting) {
                        meta.append(data + at, useful);
                    } else if (capturing && !onData(data + at, useful)) {
                        return false;
                    }
                    payload -= useful;
                }
                remaining -= take;
                at += take;
                if (remaining == 0 && collecting) finishMeta();
                continue;
            }
            const size_t take = std::min(static_cast<size_t>(512) - block.size(), size - at);
            block.append(data + at, take);
            at += take;
            if (block.size() < 512) break;
            const bool keepGoing = header();
            block.clear();
            if (!keepGoing) return false;
        }
        return true;
    }

private:
    static unsigned long long number(const char* field, size_t length) {
        if (static_cast<unsigned char>(field[0]) & 0x80) {  // GNU base-256 for sizes above 8 GiB
            unsigned long long value = static_cast<unsigned char>(field[0]) & 0x7F;
            for (size_t index = 1; index < length; index += 1) value = (value << 8) | static_cast<unsigned char>(field[index]);
            return value;
        }
        unsigned long long value = 0;
        for (size_t index = 0; index < length && field[index]; index += 1) {
            if (field[index] >= '0' && field[index] <= '7') value = value * 8 + static_cast<unsigned long long>(field[index] - '0');
        }
        return value;
    }

    static std::string text(const char* field, size_t length) { return std::string(field, strnlen(field, length)); }

    bool checksumMatches() const {
        unsigned long long sum = 0;
        for (size_t index = 0; index < 512; index += 1) sum += (index >= 148 && index < 156) ? ' ' : static_cast<unsigned char>(block[index]);
        return sum == number(block.data() + 148, 8);
    }

    bool header() {
        if (block.find_first_not_of('\0') == std::string::npos) {
            ended = true;  // the end-of-archive marker
            return true;
        }
        if (!checksumMatches()) {
            if (!seenHeader) tar = false;
            ended = true;
            return true;
        }
        seenHeader = true;
        const char* raw = block.data();
        const char type = raw[156];
        const unsigned long long size = number(raw + 124, 12);
        remaining = (size + 511) / 512 * 512;
        payload = size;
        capturing = false;
        collecting = type == 'L' || type == 'x' || type == 'g';
        metaType = type;
        meta.clear();
        if (collecting) {
            if (remaining == 0) finishMeta();
            return true;
        }
        Entry entry;
        const bool posix = std::memcmp(raw + 257, "ustar\0", 6) == 0;
        const std::string prefix = posix ? text(raw + 345, 155) : std::string();
        entry.name = !pendingName.empty() ? pendingName : (prefix.empty() ? text(raw, 100) : prefix + "/" + text(raw, 100));
        entry.size = pendingSize ? pendingSize : size;
        entry.mtime = number(raw + 136, 12);
        entry.type = type == '0' || type == '\0' || type == '7' ? "file" : type == '5' ? "directory" : type == '2' ? "symlink" : type == '1' ? "hardlink" : "other";
        if (pendingSize) {
            remaining = (pendingSize + 511) / 512 * 512;
            payload = pendingSize;
        }
        pendingName.clear();
        pendingSize = 0;
        capturing = onEntry ? onEntry(entry) : false;
        return true;
    }

    // GNU 'L' carries the next member's name; pax 'x' records carry "<len> path=..." and "<len> size=...".
    void finishMeta() {
        collecting = false;
        if (metaType == 'L') {
            pendingName = std::string(meta.c_str());
            return;
        }
        if (metaType != 'x') return;
        size_t at = 0;
        while (at < meta.size()) {
            const size_t space = meta.find(' ', at);
            if (space == std::string::npos) break;
            const size_t length = static_cast<size_t>(std::strtoull(meta.c_str() + at, nullptr, 10));
            if (length == 0 || at + length > meta.size()) break;
            const std::string record = meta.substr(space + 1, at + length - space - 2);
            const size_t equals = record.find('=');
            if (equals != std::string::npos) {
                const std::string key = record.substr(0, equals);
                const std::string value = record.substr(equals + 1);
                if (key == "path") pendingName = value;
                if (key == "size") pendingSize = std::strtoull(value.c_str(), nullptr, 10);
            }
            at += length;
        }
    }

    std::string block;
    std::string meta;
    std::string pendingName;
    unsigned long long pendingSize = 0;
    unsigned long long remaining = 0;
    unsigned long long payload = 0;
    char metaType = 0;
    bool capturing = false;
    bool collecting = false;
    bool seenHeader = false;
    bool tar = true;
    bool ended = false;
};

inline std::string jsonString(const std::string& value) {
    std::string out = "\"";
    for (unsigned char character : value) {
        if (character == '"' || character == '\\') {
            out += '\\';
            out += static_cast<char>(character);
        } else if (character < 0x20) {
            static const char* const hex = "0123456789abcdef";
            out += "\\u00";
            out += hex[character >> 4];
            out += hex[character & 15];
        } else {
            out += static_cast<char>(character);
        }
    }
    return out + "\"";
}

}  // namespace tarzst
