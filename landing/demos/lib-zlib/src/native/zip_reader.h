#pragma once

#include <zlib.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "../support/zip_format.h"

// Opens a .zip where it is, and everything that is a ZIP inside: .docx, .xlsx, .epub, .jar, .apk. The
// central directory is read from the end of the file, and one entry at a time is inflated (raw
// deflate) and checked against its CRC-32, so nothing is unpacked to disk. Paths are in the module's
// filesystem.
class ZipReader {
public:
    // Writes a small archive built here (a folder, a text file, a CSV and a file deflate cannot
    // shrink) and returns its size.
    static double writeSample(const std::string& path) {
        std::string csv = "reading,sensor,celsius\n";
        for (int i = 0; i < 1000; ++i) csv += std::to_string(i + 1) + ",sensor-" + std::to_string(i % 4) + "," + std::to_string(18 + (i * 7) % 9) + "\n";
        std::string noise(4096, '\0');
        uint32_t state = 11;
        for (char& byte : noise) {
            state = state * 1664525u + 1013904223u;
            byte = static_cast<char>(state >> 24);
        }
        const std::string readme =
            "This archive was written by C++ code using zlib.\n"
            "Each file is raw deflate (deflateInit2 with windowBits -15) with its CRC-32;\n"
            "a file that deflate cannot shrink is stored as it is, like data/noise.bin.\n";
        const std::vector<std::pair<std::string, std::string>> files = {{"README.txt", readme}, {"data/", ""}, {"data/readings.csv", csv}, {"data/noise.bin", noise}};
        const uint16_t date = ((2026 - 1980) << 9) | (1 << 5) | 1;  // 2026-01-01, 00:00:00
        const std::string zip = zipformat::write(files, 0, date, "Written with zlib by the crossbind demo.");
        zipformat::File file = zipformat::open(path, "wb");
        if (std::fwrite(zip.data(), 1, zip.size(), file.get()) != zip.size()) throw std::runtime_error("cannot write " + path);
        return static_cast<double>(zip.size());
    }

    // {"count","comment","zip64","entries":[{"name","size","compressed","method","crc","modified","folder","encrypted"}]};
    // the first 2,000 entries are listed, `count` covers all of them.
    static std::string list(const std::string& path) {
        zipformat::File file = zipformat::open(path, "rb");
        const zipformat::Archive archive = zipformat::readDirectory(file.get());
        std::string entries = "[";
        const size_t shown = std::min<size_t>(archive.entries.size(), 2000);
        for (size_t i = 0; i < shown; ++i) {
            const zipformat::Entry& entry = archive.entries[i];
            entries += std::string(i ? ",{" : "{") + "\"name\":" + zipformat::json(entry.name) + ",\"size\":" + std::to_string(entry.size) +
                       ",\"compressed\":" + std::to_string(entry.compressed) + ",\"method\":" + std::to_string(entry.method) + ",\"crc\":\"" + hex(entry.crc) +
                       "\",\"modified\":\"" + zipformat::dosTime(entry.date, entry.time) + "\",\"folder\":" + (entry.directory() ? "true" : "false") +
                       ",\"encrypted\":" + (entry.encrypted() ? "true" : "false") + "}";
        }
        return "{\"count\":" + std::to_string(archive.entries.size()) + ",\"comment\":" + zipformat::json(archive.comment) + ",\"zip64\":" +
               (archive.zip64 ? "true" : "false") + ",\"entries\":" + entries + "]}";
    }

    // Up to `maxBytes` of one entry as text, its first 64 bytes in hex, and whether the whole entry
    // matches its CRC-32: {"size","text","head","crcOk"}. Entries over 1 GiB are not read to the end,
    // and their crcOk is null.
    static std::string read(const std::string& path, const std::string& name, int maxBytes) {
        const size_t limit = static_cast<size_t>(std::max(0, std::min(maxBytes, 1 << 20)));
        zipformat::File file = zipformat::open(path, "rb");
        const zipformat::Archive archive = zipformat::readDirectory(file.get());
        const auto entry = std::find_if(archive.entries.begin(), archive.entries.end(), [&](const zipformat::Entry& e) { return e.name == name; });
        if (entry == archive.entries.end()) throw std::runtime_error("no entry named " + name);
        const bool whole = entry->size <= (1ull << 30);
        std::string head;
        const zipformat::Stream result = zipformat::stream(file.get(), archive, *entry, [&](const unsigned char* data, size_t size) {
            if (head.size() < limit) head.append(reinterpret_cast<const char*>(data), std::min(size, limit - head.size()));
            return whole || head.size() < limit;
        });
        std::string bytes;
        for (size_t i = 0; i < head.size() && i < 64; ++i) bytes += hex(static_cast<unsigned char>(head[i])).substr(6);
        const std::string crcOk = !result.complete ? "null" : result.crc == entry->crc && result.bytes == entry->size ? "true" : "false";
        return "{\"size\":" + std::to_string(entry->size) + ",\"text\":" + zipformat::json(head, true) + ",\"head\":\"" + bytes + "\",\"crcOk\":" + crcOk + "}";
    }

    // Every entry decompressed and checked against its CRC-32, as `unzip -t` does:
    // {"checked","bytes","stopped","failed":[{"name","reason"}]}. Stops after 4 GiB of output.
    static std::string test(const std::string& path) {
        const double cap = 4.0 * (1u << 30);
        zipformat::File file = zipformat::open(path, "rb");
        const zipformat::Archive archive = zipformat::readDirectory(file.get());
        double bytes = 0;
        int checked = 0;
        bool stopped = false;
        std::string failed = "[";
        for (const zipformat::Entry& entry : archive.entries) {
            if (entry.directory() && entry.size == 0) continue;
            std::string reason;
            try {
                const zipformat::Stream result = zipformat::stream(file.get(), archive, entry, [&](const unsigned char*, size_t size) {
                    bytes += static_cast<double>(size);
                    return bytes <= cap;
                });
                if (!result.complete) stopped = true;
                else if (result.crc != entry.crc || result.bytes != entry.size) reason = "the CRC-32 or the size does not match";
            } catch (const std::exception& error) {
                reason = error.what();
            }
            if (stopped) break;
            checked += 1;
            if (!reason.empty()) failed += std::string(failed.size() > 1 ? ",{" : "{") + "\"name\":" + zipformat::json(entry.name) + ",\"reason\":" + zipformat::json(reason) + "}";
        }
        return "{\"checked\":" + std::to_string(checked) + ",\"bytes\":" + std::to_string(static_cast<long long>(bytes)) + ",\"stopped\":" + (stopped ? "true" : "false") +
               ",\"failed\":" + failed + "]}";
    }

private:
    static std::string hex(uint32_t value) {
        static const char* const digits = "0123456789abcdef";
        std::string out(8, '0');
        for (int i = 7; i >= 0; --i, value >>= 4) out[static_cast<size_t>(i)] = digits[value & 15];
        return out;
    }
};
