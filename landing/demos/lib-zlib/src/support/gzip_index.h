#pragma once

#include <zlib.h>

#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Random access into gzip, zlib and raw deflate files: the technique of zlib's examples/zran.c
// (version 1.7, Mark Adler), with its buffers on the heap because the wasm stack is 64 KB.
//
// One pass decompresses the file with inflate(Z_BLOCK), which stops at every deflate block boundary.
// About every `span` bytes of output it records an access point: where the block starts in the file
// (a byte, plus 0-7 bits of the byte before it) and the 32 KiB of output before it. A read then seeks
// to the last access point before the wanted offset, feeds the leftover bits back with inflatePrime(),
// restores the history with inflateSetDictionary() and decompresses from there.
namespace gzindex {

constexpr unsigned WINDOW = 32768;  // deflate's history
constexpr size_t CHUNK = 16384;     // file read size
constexpr int RAW = -15;
constexpr int ZLIB = 15;
constexpr int GZIP = 31;

struct Point {
    long long out = 0;  // offset in the uncompressed data
    long long in = 0;   // offset in the file of the first full byte of the block
    int bits = 0;       // 0, or the number of bits (1-7) from the byte at in - 1
    std::vector<unsigned char> window;
};

struct Index {
    int mode = 0;          // RAW, ZLIB or GZIP
    long long length = 0;  // uncompressed bytes
    long long end = 0;     // where the compressed data ends; gunzip ignores anything after it, and so does this
    long long file = 0;    // the file's size
    std::vector<Point> points;
};

// What a read inflated to answer: the bytes it skipped past plus the bytes it returned.
struct Read {
    std::string data;
    long long decoded = 0;
    int point = 0;
};

using Stream = std::unique_ptr<z_stream, int (*)(z_stream*)>;

inline std::string errorText(int code, const z_stream& strm) {
    if (strm.msg) return strm.msg;
    switch (code) {
        case Z_BUF_ERROR: return "the compressed data ends early";
        case Z_DATA_ERROR: return "the compressed data is corrupt";
        case Z_MEM_ERROR: return "out of memory";
        case Z_NEED_DICT: return "the stream needs a preset dictionary";
        default: return "zlib error " + std::to_string(code);
    }
}

// What went wrong, and where, in words a person who dropped a file can use.
inline std::string failure(const Index& index, int code, const z_stream& strm, long long at, long long produced) {
    const std::string reason = errorText(code, strm);
    if (index.mode == RAW && produced == 0) return "not gzip, zlib or raw deflate data (" + reason + ")";
    const std::string format = index.mode == GZIP ? "gzip" : index.mode == ZLIB ? "zlib" : "raw deflate";
    if (code == Z_BUF_ERROR) return "the " + format + " data ends early, after " + std::to_string(produced) + " bytes of output";
    // A checksum is only compared at the end, so it cannot say where the damage is.
    if (reason == "incorrect data check" || reason == "incorrect length check") return "the " + format + " data does not match the checksum stored with it";
    return "the " + format + " data is damaged near byte " + std::to_string(at) + ": " + reason;
}

inline void addPoint(Index& index, const z_stream& strm, long long in, long long out, long long beg, const std::vector<unsigned char>& window) {
    Point point;
    point.out = out;
    point.in = in;
    point.bits = strm.data_type & 7;
    const unsigned dict = out - beg > WINDOW ? WINDOW : static_cast<unsigned>(out - beg);
    point.window.resize(dict);
    // `window` is written round and round; the newest bytes end where inflate stopped.
    const unsigned recent = WINDOW - strm.avail_out;
    unsigned copy = recent > dict ? dict : recent;
    std::memcpy(point.window.data() + dict - copy, window.data() + recent - copy, copy);
    copy = dict - copy;
    std::memcpy(point.window.data(), window.data() + WINDOW - copy, copy);
    index.points.push_back(std::move(point));
}

inline Index build(FILE* in, long long span) {
    Index index;
    z_stream strm{};
    Stream end(nullptr, inflateEnd);
    std::vector<unsigned char> input(CHUNK);
    std::vector<unsigned char> window(WINDOW);
    long long totin = 0;
    long long totout = 0;
    long long beg = 0;
    long long last = 0;
    int ret = Z_OK;
    do {
        if (strm.avail_in == 0) {
            strm.avail_in = static_cast<uInt>(std::fread(input.data(), 1, CHUNK, in));
            totin += strm.avail_in;
            strm.next_in = input.data();
            if (strm.avail_in < CHUNK && std::ferror(in)) throw std::runtime_error("cannot read the file");
            if (index.mode == 0) {
                // zlib starts with a CM of 8 in the low nibble, gzip with 1f; anything else is raw deflate.
                index.mode = strm.avail_in == 0 ? RAW : (input[0] & 0xf) == 8 ? ZLIB : input[0] == 0x1f ? GZIP : RAW;
                if (inflateInit2(&strm, index.mode) != Z_OK) throw std::runtime_error("inflateInit2 failed");
                end.reset(&strm);
            }
        }
        if (strm.avail_out == 0) {
            strm.avail_out = WINDOW;
            strm.next_out = window.data();
        }
        if (index.mode == RAW && index.points.empty()) {
            strm.data_type = 0x80;  // raw data has no header: the first block starts at byte 0
        } else {
            const unsigned before = strm.avail_out;
            ret = inflate(&strm, Z_BLOCK);
            totout += before - strm.avail_out;
        }
        // Bit 7 of data_type: at the end of a header or a block. Bit 6: that block was the last.
        if ((strm.data_type & 0xc0) == 0x80 && (index.points.empty() || totout - last >= span)) {
            addPoint(index, strm, totin - strm.avail_in, totout, beg, window);
            last = totout;
        }
        if (ret == Z_STREAM_END && index.mode == GZIP) {
            index.end = totin - strm.avail_in;
            // Another member follows only if the next two bytes start a gzip header; like gunzip, treat
            // anything else after a member (zero padding, say) as not part of the data.
            if (strm.avail_in < 2) {
                if (strm.avail_in == 1) input[0] = strm.next_in[0];
                const size_t more = std::fread(input.data() + strm.avail_in, 1, CHUNK - strm.avail_in, in);
                if (std::ferror(in)) throw std::runtime_error("cannot read the file");
                totin += static_cast<long long>(more);
                strm.next_in = input.data();
                strm.avail_in += static_cast<uInt>(more);
            }
            if (strm.avail_in >= 2 && strm.next_in[0] == 0x1f && strm.next_in[1] == 0x8b) {
                ret = inflateReset2(&strm, GZIP);  // another gzip member follows
                beg = totout;                      // its history starts empty
            }
        }
    } while (ret == Z_OK);
    if (ret != Z_STREAM_END) throw std::runtime_error(failure(index, ret, strm, totin - strm.avail_in, totout));
    if (index.mode != GZIP) index.end = totin - strm.avail_in;
    index.length = totout;
    if (fseeko(in, 0, SEEK_END) != 0) throw std::runtime_error("cannot seek in the file");
    index.file = ftello(in);
    return index;
}

// Up to `length` bytes from uncompressed `offset`. With `fromStart`, it ignores every access point
// but the first and decompresses from the beginning, as a reader without an index has to.
inline Read extract(FILE* in, const Index& index, long long offset, size_t length, bool fromStart) {
    if (index.points.empty() || index.points[0].out != 0) throw std::logic_error("not a usable index");
    Read result;
    if (length == 0 || offset < 0 || offset >= index.length) return result;
    int lo = 0;
    if (!fromStart) {
        int hi = static_cast<int>(index.points.size());
        lo = -1;
        while (hi - lo > 1) {
            const int mid = (lo + hi) >> 1;
            if (offset < index.points[mid].out) hi = mid;
            else lo = mid;
        }
    }
    const Point& point = index.points[lo];
    result.point = lo;
    if (fseeko(in, point.in - (point.bits ? 1 : 0), SEEK_SET) == -1) throw std::runtime_error("cannot seek in the file");
    int ch = 0;
    if (point.bits && (ch = std::getc(in)) == EOF) throw std::runtime_error("the file is shorter than its index");
    z_stream strm{};
    if (inflateInit2(&strm, RAW) != Z_OK) throw std::runtime_error("inflateInit2 failed");
    Stream end(&strm, inflateEnd);
    if (point.bits) inflatePrime(&strm, point.bits, ch >> (8 - point.bits));
    if (!point.window.empty()) inflateSetDictionary(&strm, point.window.data(), static_cast<uInt>(point.window.size()));

    std::vector<unsigned char> input(CHUNK);
    std::vector<unsigned char> discard(WINDOW);
    result.data.assign(length, '\0');
    long long skip = offset - point.out;
    size_t left = length;
    int ret = Z_OK;
    do {
        if (skip) {
            strm.avail_out = skip < WINDOW ? static_cast<unsigned>(skip) : WINDOW;
            strm.next_out = discard.data();
        } else {
            strm.avail_out = left < (1u << 30) ? static_cast<unsigned>(left) : (1u << 30);
            strm.next_out = reinterpret_cast<Bytef*>(&result.data[length - left]);
        }
        if (strm.avail_in == 0) {
            strm.avail_in = static_cast<uInt>(std::fread(input.data(), 1, CHUNK, in));
            if (strm.avail_in < CHUNK && std::ferror(in)) throw std::runtime_error("cannot read the file");
            strm.next_in = input.data();
        }
        unsigned got = strm.avail_out;
        ret = inflate(&strm, Z_NO_FLUSH);
        got -= strm.avail_out;
        result.decoded += got;
        if (skip) {
            skip -= got;
        } else {
            left -= got;
            if (left == 0) break;
        }
        if (ret == Z_STREAM_END && index.mode == GZIP) {
            // Skip the 8-byte trailer and the next member's header, then carry on as raw deflate.
            unsigned drop = 8;
            if (strm.avail_in >= drop) {
                strm.avail_in -= drop;
                strm.next_in += drop;
            } else {
                drop -= strm.avail_in;
                strm.avail_in = 0;
                do {
                    if (std::getc(in) == EOF) throw std::runtime_error("the file ends inside a gzip trailer");
                } while (--drop);
            }
            const long long position = ftello(in) - static_cast<long long>(strm.avail_in);
            if (position < index.end && (strm.avail_in || std::ungetc(std::getc(in), in) != EOF)) {
                inflateReset2(&strm, GZIP);
                do {
                    if (strm.avail_in == 0) {
                        strm.avail_in = static_cast<uInt>(std::fread(input.data(), 1, CHUNK, in));
                        if (strm.avail_in < CHUNK && std::ferror(in)) throw std::runtime_error("cannot read the file");
                        strm.next_in = input.data();
                    }
                    strm.avail_out = WINDOW;
                    strm.next_out = discard.data();
                    ret = inflate(&strm, Z_BLOCK);
                } while (ret == Z_OK && (strm.data_type & 0x80) == 0);
                if (ret != Z_OK) break;
                inflateReset2(&strm, RAW);
            }
        }
    } while (ret == Z_OK);
    if (ret != Z_OK && ret != Z_STREAM_END) throw std::runtime_error(errorText(ret, strm));
    result.data.resize(length - left);
    return result;
}

}  // namespace gzindex
