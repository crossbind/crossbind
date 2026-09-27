#pragma once

#include <zlib.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// ZIP (PKWARE's APPNOTE.TXT) on top of zlib. zlib has no ZIP API of its own, and its contrib/minizip
// is not part of this build, but it has the two pieces that matter: raw deflate (windowBits -15) for
// the entries and crc32 for their checksums. The central directory at the end of the file lists the
// entries; each entry's data follows its local header.
namespace zipformat {

constexpr size_t CHUNK = 64 << 10;

struct Entry {
    std::string name;
    uint16_t flags = 0;
    uint16_t method = 0;
    uint16_t time = 0;
    uint16_t date = 0;
    uint32_t crc = 0;
    uint64_t compressed = 0;
    uint64_t size = 0;
    uint64_t offset = 0;
    bool directory() const { return !name.empty() && name.back() == '/'; }
    bool encrypted() const { return (flags & 1) != 0; }
};

struct Archive {
    std::vector<Entry> entries;
    std::string comment;
    bool zip64 = false;
    long long shift = 0;  // bytes in front of the archive, such as a self-extracting stub
};

inline uint16_t le16(const unsigned char* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
inline uint32_t le32(const unsigned char* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24); }
inline uint64_t le64(const unsigned char* p) { return le32(p) | (static_cast<uint64_t>(le32(p + 4)) << 32); }

inline void put16(std::string& out, uint32_t value) {
    out += static_cast<char>(value & 0xff);
    out += static_cast<char>((value >> 8) & 0xff);
}

inline void put32(std::string& out, uint32_t value) {
    put16(out, value & 0xffff);
    put16(out, value >> 16);
}

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

inline File open(const std::string& path, const char* mode) {
    File file(std::fopen(path.c_str(), mode), std::fclose);
    if (!file) throw std::runtime_error("cannot open " + path);
    return file;
}

inline void readAt(FILE* file, long long offset, unsigned char* buffer, size_t size) {
    if (offset < 0 || fseeko(file, offset, SEEK_SET) != 0 || std::fread(buffer, 1, size, file) != size) throw std::runtime_error("the file ends before a record it points to");
}

inline Archive readDirectory(FILE* file) {
    if (fseeko(file, 0, SEEK_END) != 0) throw std::runtime_error("cannot seek in the file");
    const long long size = ftello(file);
    if (size < 22) throw std::runtime_error("not a ZIP file: too short for an end-of-central-directory record");
    // The end record is 22 bytes followed by a comment of up to 65,535 bytes, so it is in the tail.
    const size_t tail = static_cast<size_t>(std::min<long long>(size, 22 + 65535));
    std::vector<unsigned char> end(tail);
    readAt(file, size - static_cast<long long>(tail), end.data(), tail);
    long long found = -1;
    for (size_t i = tail - 22 + 1; i-- > 0;) {
        if (le32(&end[i]) == 0x06054b50 && i + 22 + le16(&end[i + 20]) <= tail) {
            found = static_cast<long long>(i);
            break;
        }
    }
    if (found < 0) throw std::runtime_error("not a ZIP file: there is no end-of-central-directory record");
    const unsigned char* record = &end[static_cast<size_t>(found)];
    const long long recordAt = size - static_cast<long long>(tail) + found;
    Archive archive;
    archive.comment.assign(reinterpret_cast<const char*>(record + 22), le16(record + 20));
    uint64_t count = le16(record + 10);
    uint64_t directorySize = le32(record + 12);
    uint64_t directoryAt = le32(record + 16);
    // ZIP64 puts a 20-byte locator in front of the end record, pointing at 64-bit copies of the fields.
    unsigned char locator[20];
    if (recordAt >= 20) {
        readAt(file, recordAt - 20, locator, 20);
        if (le32(locator) == 0x07064b50) {
            unsigned char zip64[56];
            readAt(file, static_cast<long long>(le64(locator + 8)), zip64, 56);
            if (le32(zip64) != 0x06064b50) throw std::runtime_error("the ZIP64 end record is missing");
            count = le64(zip64 + 32);
            directorySize = le64(zip64 + 40);
            directoryAt = le64(zip64 + 48);
            archive.zip64 = true;
        }
    }
    if (!archive.zip64) archive.shift = recordAt - static_cast<long long>(directoryAt + directorySize);
    if (archive.shift < 0 || directorySize > (256u << 20)) throw std::runtime_error("the central directory does not fit in the file");
    std::vector<unsigned char> directory(static_cast<size_t>(directorySize));
    if (directorySize) readAt(file, static_cast<long long>(directoryAt) + archive.shift, directory.data(), directory.size());
    size_t p = 0;
    for (uint64_t i = 0; i < count; ++i) {
        if (p + 46 > directory.size() || le32(&directory[p]) != 0x02014b50) throw std::runtime_error("the central directory is damaged at entry " + std::to_string(i + 1));
        const unsigned char* h = &directory[p];
        Entry entry;
        entry.flags = le16(h + 8);
        entry.method = le16(h + 10);
        entry.time = le16(h + 12);
        entry.date = le16(h + 14);
        entry.crc = le32(h + 16);
        entry.compressed = le32(h + 20);
        entry.size = le32(h + 24);
        entry.offset = le32(h + 42);
        const size_t nameLength = le16(h + 28), extraLength = le16(h + 30), commentLength = le16(h + 32);
        if (p + 46 + nameLength + extraLength + commentLength > directory.size()) throw std::runtime_error("the central directory is damaged at entry " + std::to_string(i + 1));
        entry.name.assign(reinterpret_cast<const char*>(h + 46), nameLength);
        // ZIP64 extended information: 64-bit values for whichever fields above hold 0xFFFFFFFF, in this order.
        for (size_t x = p + 46 + nameLength, extraEnd = x + extraLength; x + 4 <= extraEnd;) {
            const uint16_t id = le16(&directory[x]), length = le16(&directory[x + 2]);
            if (x + 4 + length > extraEnd) break;
            if (id == 0x0001) {
                size_t q = x + 4;
                const size_t fieldEnd = x + 4 + length;
                if (entry.size == 0xFFFFFFFF && q + 8 <= fieldEnd) {
                    entry.size = le64(&directory[q]);
                    q += 8;
                }
                if (entry.compressed == 0xFFFFFFFF && q + 8 <= fieldEnd) {
                    entry.compressed = le64(&directory[q]);
                    q += 8;
                }
                if (entry.offset == 0xFFFFFFFF && q + 8 <= fieldEnd) entry.offset = le64(&directory[q]);
            }
            x += 4 + length;
        }
        archive.entries.push_back(entry);
        p += 46 + nameLength + extraLength + commentLength;
    }
    return archive;
}

// What streaming an entry produced: its size and CRC-32 so far, and whether that was all of it.
struct Stream {
    uint64_t bytes = 0;
    uint32_t crc = 0;
    bool complete = false;
};

// Hands an entry's bytes to `sink` in pieces, stored or inflated from raw deflate; `sink` returns
// false to stop early.
inline Stream stream(FILE* file, const Archive& archive, const Entry& entry, const std::function<bool(const unsigned char*, size_t)>& sink) {
    if (entry.encrypted()) throw std::runtime_error("it is encrypted");
    if (entry.method != 0 && entry.method != 8) {
        throw std::runtime_error("it uses compression method " + std::to_string(entry.method) + "; zlib reads 8 (deflate) and 0 (stored)");
    }
    unsigned char local[30];
    readAt(file, static_cast<long long>(entry.offset) + archive.shift, local, 30);
    if (le32(local) != 0x04034b50) throw std::runtime_error("its local header is missing");
    if (fseeko(file, static_cast<long long>(entry.offset) + archive.shift + 30 + le16(local + 26) + le16(local + 28), SEEK_SET) != 0) {
        throw std::runtime_error("cannot seek to its data");
    }
    std::vector<unsigned char> input(CHUNK);
    std::vector<unsigned char> output(CHUNK);
    Stream result;
    result.crc = static_cast<uint32_t>(crc32(0, Z_NULL, 0));
    uint64_t left = entry.compressed;
    const auto deliver = [&](const unsigned char* data, size_t size) {
        result.crc = static_cast<uint32_t>(crc32(result.crc, data, static_cast<uInt>(size)));
        result.bytes += size;
        if (result.bytes > entry.size) throw std::runtime_error("it holds more data than its declared size");
        return size == 0 || sink(data, size);
    };
    if (entry.method == 0) {
        while (left > 0) {
            const size_t count = std::fread(input.data(), 1, static_cast<size_t>(std::min<uint64_t>(CHUNK, left)), file);
            if (count == 0) throw std::runtime_error("the file ends inside it");
            left -= count;
            if (!deliver(input.data(), count)) return result;
        }
        result.complete = true;
        return result;
    }
    z_stream strm{};
    if (inflateInit2(&strm, -15) != Z_OK) throw std::runtime_error("inflateInit2 failed");  // raw deflate: no zlib header
    std::unique_ptr<z_stream, int (*)(z_stream*)> end(&strm, inflateEnd);
    int ret = Z_OK;
    do {
        if (strm.avail_in == 0) {
            const size_t count = std::fread(input.data(), 1, static_cast<size_t>(std::min<uint64_t>(CHUNK, left)), file);
            if (count == 0) throw std::runtime_error("its deflate data ends early");
            left -= count;
            strm.next_in = input.data();
            strm.avail_in = static_cast<uInt>(count);
        }
        strm.next_out = output.data();
        strm.avail_out = static_cast<uInt>(CHUNK);
        ret = inflate(&strm, Z_NO_FLUSH);
        if (ret != Z_OK && ret != Z_STREAM_END) throw std::runtime_error(strm.msg ? strm.msg : "its deflate data is corrupt");
        if (!deliver(output.data(), CHUNK - strm.avail_out)) return result;
    } while (ret != Z_STREAM_END);
    result.complete = true;
    return result;
}

// A new archive: each file deflated as raw deflate at level 6 unless that would not make it smaller,
// in which case it is stored; names ending in '/' are folders.
inline std::string write(const std::vector<std::pair<std::string, std::string>>& files, uint16_t time, uint16_t date, const std::string& comment) {
    std::string out;
    std::string directory;
    for (const auto& file : files) {
        const std::string& name = file.first;
        const std::string& data = file.second;
        const bool folder = !name.empty() && name.back() == '/';
        const uint32_t crc = static_cast<uint32_t>(crc32(0, reinterpret_cast<const Bytef*>(data.data()), static_cast<uInt>(data.size())));
        std::string deflated;
        if (!folder) {
            z_stream strm{};
            if (deflateInit2(&strm, 6, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY) != Z_OK) throw std::runtime_error("deflateInit2 failed");
            std::unique_ptr<z_stream, int (*)(z_stream*)> end(&strm, deflateEnd);
            deflated.assign(deflateBound(&strm, static_cast<uLong>(data.size())), '\0');
            strm.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(data.data()));
            strm.avail_in = static_cast<uInt>(data.size());
            strm.next_out = reinterpret_cast<Bytef*>(&deflated[0]);
            strm.avail_out = static_cast<uInt>(deflated.size());
            if (deflate(&strm, Z_FINISH) != Z_STREAM_END) throw std::runtime_error("deflate did not finish");
            deflated.resize(strm.total_out);
        }
        const bool stored = folder || deflated.size() >= data.size();
        const std::string& payload = stored ? data : deflated;
        const uint32_t method = stored ? 0 : 8;
        const uint32_t needed = stored ? 10 : 20;
        const uint32_t offset = static_cast<uint32_t>(out.size());
        put32(out, 0x04034b50);
        put16(out, needed);
        put16(out, 0);
        put16(out, method);
        put16(out, time);
        put16(out, date);
        put32(out, crc);
        put32(out, static_cast<uint32_t>(payload.size()));
        put32(out, static_cast<uint32_t>(data.size()));
        put16(out, static_cast<uint32_t>(name.size()));
        put16(out, 0);
        out += name;
        out += payload;
        put32(directory, 0x02014b50);
        put16(directory, (3 << 8) | 20);  // made by Unix, ZIP 2.0
        put16(directory, needed);
        put16(directory, 0);
        put16(directory, method);
        put16(directory, time);
        put16(directory, date);
        put32(directory, crc);
        put32(directory, static_cast<uint32_t>(payload.size()));
        put32(directory, static_cast<uint32_t>(data.size()));
        put16(directory, static_cast<uint32_t>(name.size()));
        put16(directory, 0);
        put16(directory, 0);
        put16(directory, 0);
        put16(directory, 0);
        put32(directory, folder ? (040755u << 16) | 0x10 : (0100644u << 16));  // Unix mode, plus the MS-DOS folder bit
        put32(directory, offset);
        directory += name;
    }
    const uint32_t directoryAt = static_cast<uint32_t>(out.size());
    out += directory;
    put32(out, 0x06054b50);
    put16(out, 0);
    put16(out, 0);
    put16(out, static_cast<uint32_t>(files.size()));
    put16(out, static_cast<uint32_t>(files.size()));
    put32(out, static_cast<uint32_t>(directory.size()));
    put32(out, directoryAt);
    put16(out, static_cast<uint32_t>(comment.size()));
    out += comment;
    return out;
}

// Text for JSON: valid UTF-8 kept, stray bytes as '?', an incomplete sequence at the very end dropped,
// and control characters other than newline and tab shown as '.' when `dots` is set.
inline std::string text(const std::string& bytes, bool dots) {
    std::string out;
    for (size_t i = 0; i < bytes.size();) {
        const unsigned char c = static_cast<unsigned char>(bytes[i]);
        const size_t n = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 0;
        if (n > 1 && i + n > bytes.size()) break;
        bool valid = n > 0;
        for (size_t k = 1; valid && k < n; ++k) valid = (static_cast<unsigned char>(bytes[i + k]) & 0xC0) == 0x80;
        if (!valid) {
            out += '?';
            i += 1;
        } else if (n == 1 && dots && c < 0x20 && c != '\n' && c != '\t') {
            out += '.';
            i += 1;
        } else {
            out.append(bytes, i, n);
            i += n;
        }
    }
    return out;
}

inline std::string json(const std::string& bytes, bool dots = false) {
    static const char* const hex = "0123456789abcdef";
    std::string out = "\"";
    for (const char character : text(bytes, dots)) {
        const unsigned char c = static_cast<unsigned char>(character);
        if (c == '"' || c == '\\') {
            out += '\\';
            out += character;
        } else if (c == '\n') {
            out += "\\n";
        } else if (c == '\t') {
            out += "\\t";
        } else if (c < 0x20) {
            out += "\\u00";
            out += hex[c >> 4];
            out += hex[c & 15];
        } else {
            out += character;
        }
    }
    return out + "\"";
}

// An MS-DOS date and time as "YYYY-MM-DD HH:MM:SS", the local time the archiver recorded.
inline std::string dosTime(uint16_t date, uint16_t time) {
    char buffer[24];
    std::snprintf(buffer, sizeof buffer, "%04d-%02d-%02d %02d:%02d:%02d", 1980 + (date >> 9), (date >> 5) & 15, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
    return buffer;
}

}  // namespace zipformat
