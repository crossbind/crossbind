#pragma once

// ZSTD_getFrameHeader is in zstd's static API; safe with this statically linked, pinned library.
#ifndef ZSTD_STATIC_LINKING_ONLY
#define ZSTD_STATIC_LINKING_ONLY
#endif
#include <zstd.h>

#include <algorithm>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "../support/tar.h"

// Opens .zst and .tar.zst files where they are: the file is streamed through zstd and the tar
// headers are read as the bytes go by, so nothing is unpacked and memory stays flat. Paths are in
// the module's filesystem; the page mounts a dropped file there first.
class ZstOpener {
public:
    // Writes a small .tar.zst built here (three generated text files, checksummed) and returns its size.
    static int writeSample(const std::string& path) {
        const std::vector<std::pair<std::string, std::string>> files = {{"a.txt", sampleText("a.txt", 1000)}, {"b.txt", sampleText("b.txt", 2000)}, {"c.txt", sampleText("c.txt", 3000)}};
        const std::string tar = tarzst::archive(files, 1758585600ull);
        std::unique_ptr<ZSTD_CCtx, size_t (*)(ZSTD_CCtx*)> cctx(ZSTD_createCCtx(), ZSTD_freeCCtx);
        if (!cctx) throw std::runtime_error("zstd could not allocate a compression context");
        tarzst::check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_compressionLevel, 19));
        tarzst::check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_checksumFlag, 1));
        std::string frame(ZSTD_compressBound(tar.size()), '\0');
        frame.resize(tarzst::check(ZSTD_compress2(cctx.get(), &frame[0], frame.size(), tar.data(), tar.size())));
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "wb"), std::fclose);
        if (!file || std::fwrite(frame.data(), 1, frame.size(), file.get()) != frame.size()) throw std::runtime_error("cannot write " + path);
        return static_cast<int>(frame.size());
    }

    // The first frame's header: {"skippable","windowSize","contentSize" (null when not stored),"checksum","dictionaryId"}.
    static std::string frameInfo(const std::string& path) {
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "rb"), std::fclose);
        if (!file) throw std::runtime_error("cannot open " + path);
        std::string head(ZSTD_FRAMEHEADERSIZE_MAX, '\0');
        head.resize(std::fread(&head[0], 1, head.size(), file.get()));
        ZSTD_FrameHeader header;
        const size_t status = ZSTD_getFrameHeader(&header, head.data(), head.size());
        if (ZSTD_isError(status) || status > 0) throw std::runtime_error("not a zstd file: it does not start with a zstd frame header");
        const bool unknown = header.frameContentSize == ZSTD_CONTENTSIZE_UNKNOWN;
        return "{\"skippable\":" + std::string(header.frameType == ZSTD_skippableFrame ? "true" : "false") +
               ",\"windowSize\":" + std::to_string(header.windowSize) + ",\"contentSize\":" + (unknown ? std::string("null") : std::to_string(header.frameContentSize)) +
               ",\"checksum\":" + (header.checksumFlag ? "true" : "false") + ",\"dictionaryId\":" + std::to_string(header.dictID) + "}";
    }

    // What is inside: {"format":"tar"|"raw","bytes":<decoded size>,"count":N,"entries":[{"name","size","mtime","type"}]}.
    // The first 2,000 members are listed; `count` covers all of them.
    static std::string listTar(const std::string& path) {
        const size_t listed = 2000;
        tarzst::Walker walker;
        std::string entries = "[";
        size_t count = 0;
        unsigned long long decoded = 0;
        walker.onEntry = [&](const tarzst::Entry& entry) {
            if (count < listed) {
                entries += std::string(count ? ",{" : "{") + "\"name\":" + tarzst::jsonString(entry.name) + ",\"size\":" + std::to_string(entry.size) +
                           ",\"mtime\":" + std::to_string(entry.mtime) + ",\"type\":\"" + entry.type + "\"}";
            }
            count += 1;
            return false;
        };
        tarzst::decompressFile(path, [&](const char* data, size_t size) {
            decoded += size;
            if (walker.isTar() && !walker.finished()) walker.feed(data, size);
            return true;
        });
        const bool tar = walker.isTar() && count > 0;
        return "{\"format\":\"" + std::string(tar ? "tar" : "raw") + "\",\"bytes\":" + std::to_string(decoded) + ",\"count\":" + std::to_string(tar ? count : 0) +
               ",\"entries\":" + (tar ? entries + "]" : std::string("[]")) + "}";
    }

    // Up to maxBytes of one member, as text. An empty name reads the start of a plain .zst.
    static std::string extractText(const std::string& path, const std::string& name, int maxBytes) {
        const size_t limit = static_cast<size_t>(std::max(maxBytes, 1));
        std::string out;
        bool found = name.empty();
        bool done = false;
        tarzst::Walker walker;
        walker.onEntry = [&](const tarzst::Entry& entry) {
            if (found) {
                done = true;
                return false;
            }
            if (entry.name != name) return false;
            found = true;
            return true;
        };
        walker.onData = [&](const char* data, size_t size) {
            out.append(data, std::min(size, limit - out.size()));
            return out.size() < limit;
        };
        tarzst::decompressFile(path, [&](const char* data, size_t size) {
            if (name.empty()) {
                out.append(data, std::min(size, limit - out.size()));
                return out.size() < limit;
            }
            return walker.feed(data, size) && !done && !walker.finished();
        });
        if (!found) throw std::runtime_error("no member named " + name);
        for (char& character : out) {
            const unsigned char value = static_cast<unsigned char>(character);
            if (value < 0x20 && character != '\n' && character != '\t') character = '.';
        }
        return out;
    }

private:
    static std::string sampleText(const std::string& name, size_t size) {
        std::string text;
        for (int line = 1; text.size() < size; line += 1) {
            text += name + " line " + std::to_string(line) + ": zstd streamed this member out of a .tar.zst without unpacking it.\n";
        }
        text.resize(size);
        return text;
    }
};
