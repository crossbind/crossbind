#pragma once

#include <iconv.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/recode.h"
#include "../support/text.h"

// Reads a file from the module's filesystem strictly: in one encoding with the exact spot where the
// bytes stop making sense, or in every encoding this build has, so a file of unknown origin shows
// which ones can read it. Only the first maxBytes are read; a character cut by that limit is not an error.
class FileDecoder {
public:
    // {"size","read","text","error":""|"invalid"|"incomplete","at","line","column"}: `text` is what
    // decoded before any error; `at` is a byte offset into the file, `line` and `column` count from 1.
    static std::string decode(const std::string& path, const std::string& encoding, int maxBytes) {
        const Loaded file = load(path, maxBytes);
        const recode::Result result = read(file, encoding);
        const std::string error = result.ok ? "" : result.error == EINVAL ? "incomplete" : "invalid";
        size_t line = 1;
        size_t column = 1;
        for (char32_t c : text::codePoints(result.output)) {
            if (c == '\n') {
                line += 1;
                column = 1;
            } else {
                column += 1;
            }
        }
        return "{\"size\":" + std::to_string(file.size) + ",\"read\":" + std::to_string(file.bytes.size()) + ",\"text\":" + text::json(result.output) +
               ",\"error\":\"" + error + "\",\"at\":" + std::to_string(result.at) + ",\"line\":" + std::to_string(line) + ",\"column\":" + std::to_string(column) + "}";
    }

    // Every encoding of the build: [{"encoding","ok","at","preview"}], `preview` being the first line
    // (at most 48 characters) of what decoded. Byte-order and escape pseudo-encodings are left out.
    static std::string scan(const std::string& path, int maxBytes) {
        const Loaded file = load(path, maxBytes);
        std::vector<std::string> names;
        iconvlist(addCanonical, &names);
        std::string json = "[";
        for (size_t i = 0; i < names.size(); i += 1) {
            const recode::Result result = read(file, names[i]);
            json += std::string(i ? "," : "") + "{\"encoding\":\"" + names[i] + "\",\"ok\":" + (result.ok ? "true" : "false") + ",\"at\":" + std::to_string(result.at) +
                    ",\"preview\":" + text::json(firstLine(result.output)) + "}";
        }
        return json + "]";
    }

private:
    struct Loaded {
        std::string bytes;
        size_t size = 0;
    };

    static Loaded load(const std::string& path, int maxBytes) {
        std::unique_ptr<FILE, int (*)(FILE*)> handle(std::fopen(path.c_str(), "rb"), std::fclose);
        if (!handle) throw std::runtime_error("cannot open " + path);
        Loaded file;
        std::fseek(handle.get(), 0, SEEK_END);
        file.size = static_cast<size_t>(std::ftell(handle.get()));
        std::fseek(handle.get(), 0, SEEK_SET);
        file.bytes.resize(std::min(file.size, static_cast<size_t>(std::max(maxBytes, 0))));
        file.bytes.resize(std::fread(&file.bytes[0], 1, file.bytes.size(), handle.get()));
        return file;
    }

    // Strict, except that a multibyte character cut off by the read limit is not held against the file.
    static recode::Result read(const Loaded& file, const std::string& encoding) {
        recode::Result result = recode::convert(file.bytes, encoding, "UTF-8");
        if (!result.ok && result.error == EINVAL && file.bytes.size() < file.size) result.ok = true;
        return result;
    }

    static std::string firstLine(const std::string& decoded) {
        std::string line;
        size_t count = 0;
        for (size_t at = 0; at < decoded.size() && decoded[at] != '\n' && count < 48; count += 1) {
            const size_t length = text::sequenceLength(static_cast<unsigned char>(decoded[at]));
            line += decoded.substr(at, length);
            at += length;
        }
        return line;
    }

    static int addCanonical(unsigned int count, const char* const* names, void* data) {
        static const char* const skipped[] = {"UCS-2-INTERNAL", "UCS-2-SWAPPED", "UCS-4-INTERNAL", "UCS-4-SWAPPED", "C99", "JAVA"};
        const std::string canonical = iconv_canonicalize(names[0]);
        for (const char* name : skipped) {
            if (canonical == name) return 0;
        }
        static_cast<std::vector<std::string>*>(data)->push_back(canonical);
        (void)count;
        return 0;
    }
};
