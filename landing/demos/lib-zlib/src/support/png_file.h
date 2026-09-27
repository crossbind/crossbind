#pragma once

#include <zlib.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Just enough PNG (ISO/IEC 15948) to take the image data apart and put it back together: the chunk
// layout, the IHDR fields, the five scanline filters and Adam7 interlacing. The pixels travel as
// "raw" rows (no filter byte) and "filtered" rows (a filter-type byte, then the filtered bytes).
namespace pngfile {

const std::string SIGNATURE("\x89PNG\r\n\x1a\n", 8);
constexpr size_t MAX_RAW = 512u << 20;  // refuse images whose pixels need more than 512 MiB

struct Chunk {
    std::string type;
    size_t offset = 0;  // where its length field starts
    uint32_t length = 0;
    bool crcOk = false;
};

struct Image {
    uint32_t width = 0;
    uint32_t height = 0;
    int bitDepth = 0;
    int colorType = 0;
    int interlace = 0;
    std::vector<Chunk> chunks;
    std::string idat;  // every IDAT chunk's data, joined: one zlib stream
};

struct Pass {
    uint32_t width;
    uint32_t height;
};

inline uint32_t be32(const std::string& data, size_t at) {
    return (static_cast<uint32_t>(static_cast<uint8_t>(data[at])) << 24) | (static_cast<uint32_t>(static_cast<uint8_t>(data[at + 1])) << 16) |
           (static_cast<uint32_t>(static_cast<uint8_t>(data[at + 2])) << 8) | static_cast<uint8_t>(data[at + 3]);
}

inline void putBe32(std::string& out, uint32_t value) {
    out += static_cast<char>(value >> 24);
    out += static_cast<char>(value >> 16);
    out += static_cast<char>(value >> 8);
    out += static_cast<char>(value);
}

inline uint32_t crcOf(const char* data, size_t size) {
    return static_cast<uint32_t>(crc32(0, reinterpret_cast<const Bytef*>(data), static_cast<uInt>(size)));
}

// Appends a chunk: length, type, data, and the CRC-32 of type and data.
inline void putChunk(std::string& out, const std::string& type, const std::string& data) {
    putBe32(out, static_cast<uint32_t>(data.size()));
    const size_t start = out.size();
    out += type;
    out += data;
    putBe32(out, crcOf(out.data() + start, out.size() - start));
}

inline int channels(int colorType) {
    switch (colorType) {
        case 0: return 1;  // greyscale
        case 2: return 3;  // RGB
        case 3: return 1;  // palette index
        case 4: return 2;  // greyscale + alpha
        case 6: return 4;  // RGBA
        default: throw std::runtime_error("unknown PNG colour type " + std::to_string(colorType));
    }
}

inline size_t rowBytes(const Image& image, uint32_t width) {
    return (static_cast<size_t>(width) * image.bitDepth * channels(image.colorType) + 7) / 8;
}

// The filters look back one whole pixel, or one byte below 8 bits per pixel.
inline size_t pixelBytes(const Image& image) {
    return std::max<size_t>(1, static_cast<size_t>(image.bitDepth) * channels(image.colorType) / 8);
}

// One pass for a plain image, the seven Adam7 passes for an interlaced one (some may be empty).
inline std::vector<Pass> passes(const Image& image) {
    if (image.interlace == 0) return {{image.width, image.height}};
    const uint32_t x0[] = {0, 4, 0, 2, 0, 1, 0}, y0[] = {0, 0, 4, 0, 2, 0, 1};
    const uint32_t dx[] = {8, 8, 4, 4, 2, 2, 1}, dy[] = {8, 8, 8, 4, 4, 2, 2};
    std::vector<Pass> list;
    for (int p = 0; p < 7; ++p) {
        const uint32_t w = image.width > x0[p] ? (image.width - x0[p] + dx[p] - 1) / dx[p] : 0;
        const uint32_t h = image.height > y0[p] ? (image.height - y0[p] + dy[p] - 1) / dy[p] : 0;
        list.push_back({w, h});
    }
    return list;
}

// Size of the image data once inflated: every non-empty pass, one filter byte per row.
inline size_t filteredSize(const Image& image) {
    size_t total = 0;
    for (const Pass& pass : passes(image)) {
        if (pass.width && pass.height) total += static_cast<size_t>(pass.height) * (1 + rowBytes(image, pass.width));
        if (total > MAX_RAW) throw std::runtime_error("the image is too large for this tab (over 512 MiB of pixels)");
    }
    return total;
}

inline Image parse(const std::string& data) {
    if (data.size() < 8 || data.compare(0, 8, SIGNATURE) != 0) throw std::runtime_error("not a PNG file: the 8-byte signature is missing");
    Image image;
    size_t at = 8;
    bool ended = false;
    while (at < data.size() && !ended) {
        if (data.size() - at < 12) throw std::runtime_error("the file ends inside a chunk");
        Chunk chunk;
        chunk.offset = at;
        chunk.length = be32(data, at);
        if (chunk.length > data.size() - at - 12) throw std::runtime_error("a chunk runs past the end of the file");
        chunk.type = data.substr(at + 4, 4);
        chunk.crcOk = crcOf(data.data() + at + 4, chunk.length + 4) == be32(data, at + 8 + chunk.length);
        if (chunk.type == "IHDR" && chunk.length == 13) {
            image.width = be32(data, at + 8);
            image.height = be32(data, at + 12);
            image.bitDepth = static_cast<uint8_t>(data[at + 16]);
            image.colorType = static_cast<uint8_t>(data[at + 17]);
            image.interlace = static_cast<uint8_t>(data[at + 20]);
            if (data[at + 18] != 0 || data[at + 19] != 0) throw std::runtime_error("unknown PNG compression or filter method");
        } else if (chunk.type == "IDAT") {
            image.idat.append(data, at + 8, chunk.length);
        } else if (chunk.type == "IEND") {
            ended = true;
        }
        image.chunks.push_back(chunk);
        at += 12 + static_cast<size_t>(chunk.length);
    }
    if (image.chunks.empty() || image.chunks[0].type != "IHDR" || image.width == 0) throw std::runtime_error("the file does not start with a valid IHDR chunk");
    if (image.height == 0 || image.width > (1u << 24) || image.height > (1u << 24)) throw std::runtime_error("the image size in IHDR is not usable");
    const int depth = image.bitDepth;
    const bool depthOk = image.colorType == 0 ? (depth == 1 || depth == 2 || depth == 4 || depth == 8 || depth == 16)
                         : image.colorType == 3 ? (depth == 1 || depth == 2 || depth == 4 || depth == 8)
                                                : (depth == 8 || depth == 16);
    channels(image.colorType);
    if (!depthOk) throw std::runtime_error("bit depth " + std::to_string(depth) + " is not allowed for colour type " + std::to_string(image.colorType));
    if (image.interlace > 1) throw std::runtime_error("unknown interlace method");
    if (image.idat.empty()) throw std::runtime_error("the image has no IDAT data");
    return image;
}

// The inflated image data, which must be exactly as long as the header says.
inline std::string inflateData(const Image& image) {
    const size_t expected = filteredSize(image);
    std::string out(expected, '\0');
    z_stream strm{};
    if (inflateInit(&strm) != Z_OK) throw std::runtime_error("inflateInit failed");
    std::unique_ptr<z_stream, int (*)(z_stream*)> end(&strm, inflateEnd);
    strm.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(image.idat.data()));
    strm.avail_in = static_cast<uInt>(image.idat.size());
    strm.next_out = reinterpret_cast<Bytef*>(&out[0]);
    strm.avail_out = static_cast<uInt>(out.size());
    const int ret = inflate(&strm, Z_FINISH);
    if (ret == Z_BUF_ERROR && strm.avail_out == 0) throw std::runtime_error("the image data holds more rows than IHDR says");
    if (ret != Z_STREAM_END) throw std::runtime_error(strm.msg ? std::string("the image data is corrupt: ") + strm.msg : "the image data ends early");
    if (strm.total_out != expected) throw std::runtime_error("the image data holds fewer rows than IHDR says");
    return out;
}

inline uint8_t paeth(int a, int b, int c) {
    const int p = a + b - c;
    const int pa = std::abs(p - a), pb = std::abs(p - b), pc = std::abs(p - c);
    return static_cast<uint8_t>(pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
}

// Undoes the row filters. `counts` gets how many rows used each filter type (0-4).
inline std::string unfilter(const Image& image, const std::string& filtered, std::array<double, 5>& counts) {
    const size_t bpp = pixelBytes(image);
    std::string raw;
    raw.reserve(filtered.size());
    size_t at = 0;
    for (const Pass& pass : passes(image)) {
        if (!pass.width || !pass.height) continue;
        const size_t length = rowBytes(image, pass.width);
        std::vector<uint8_t> prior(length, 0);
        std::vector<uint8_t> row(length);
        for (uint32_t y = 0; y < pass.height; ++y) {
            const uint8_t type = static_cast<uint8_t>(filtered[at++]);
            if (type > 4) throw std::runtime_error("a row has filter type " + std::to_string(type) + "; PNG has 0-4");
            counts[type] += 1;
            std::memcpy(row.data(), filtered.data() + at, length);
            at += length;
            for (size_t i = 0; i < length; ++i) {
                const int a = i >= bpp ? row[i - bpp] : 0;
                const int b = prior[i];
                const int c = i >= bpp ? prior[i - bpp] : 0;
                if (type == 1) row[i] = static_cast<uint8_t>(row[i] + a);
                else if (type == 2) row[i] = static_cast<uint8_t>(row[i] + b);
                else if (type == 3) row[i] = static_cast<uint8_t>(row[i] + ((a + b) >> 1));
                else if (type == 4) row[i] = static_cast<uint8_t>(row[i] + paeth(a, b, c));
            }
            raw.append(reinterpret_cast<const char*>(row.data()), length);
            prior.swap(row);
        }
    }
    return raw;
}

// Filters every row with type `method` (0-4), or with 5 picks per row the type whose output has the
// smallest sum of absolute values, read as signed bytes (the heuristic libpng uses).
inline std::string filter(const Image& image, const std::string& raw, int method) {
    const size_t bpp = pixelBytes(image);
    std::string out;
    out.reserve(raw.size() + image.height * 7);
    size_t at = 0;
    std::array<std::vector<uint8_t>, 5> candidate;
    for (const Pass& pass : passes(image)) {
        if (!pass.width || !pass.height) continue;
        const size_t length = rowBytes(image, pass.width);
        for (auto& buffer : candidate) buffer.assign(length, 0);
        std::vector<uint8_t> prior(length, 0);
        for (uint32_t y = 0; y < pass.height; ++y) {
            const uint8_t* row = reinterpret_cast<const uint8_t*>(raw.data() + at);
            at += length;
            int best = method;
            long bestSum = -1;
            for (int type = method == 5 ? 0 : method; type <= (method == 5 ? 4 : method); ++type) {
                uint8_t* target = candidate[type].data();
                long sum = 0;
                for (size_t i = 0; i < length; ++i) {
                    const int a = i >= bpp ? row[i - bpp] : 0;
                    const int b = prior[i];
                    const int c = i >= bpp ? prior[i - bpp] : 0;
                    const int predicted = type == 0 ? 0 : type == 1 ? a : type == 2 ? b : type == 3 ? (a + b) >> 1 : paeth(a, b, c);
                    target[i] = static_cast<uint8_t>(row[i] - predicted);
                    sum += target[i] < 128 ? target[i] : 256 - target[i];
                }
                if (bestSum < 0 || sum < bestSum) {
                    bestSum = sum;
                    best = type;
                }
            }
            out += static_cast<char>(best);
            out.append(reinterpret_cast<const char*>(candidate[best].data()), length);
            prior.assign(row, row + length);
        }
    }
    return out;
}

// The image data as one zlib stream, with the largest window and hash tables zlib has.
inline std::string compress(const std::string& filtered, int level, int strategy) {
    z_stream strm{};
    if (deflateInit2(&strm, level, Z_DEFLATED, 15, 9, strategy) != Z_OK) throw std::invalid_argument("bad deflate parameters");
    std::unique_ptr<z_stream, int (*)(z_stream*)> end(&strm, deflateEnd);
    std::string out(deflateBound(&strm, static_cast<uLong>(filtered.size())), '\0');
    strm.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(filtered.data()));
    strm.avail_in = static_cast<uInt>(filtered.size());
    strm.next_out = reinterpret_cast<Bytef*>(&out[0]);
    strm.avail_out = static_cast<uInt>(out.size());
    if (deflate(&strm, Z_FINISH) != Z_STREAM_END) throw std::runtime_error("deflate did not finish");
    out.resize(strm.total_out);
    return out;
}

// The original file with its IDAT chunks replaced by one IDAT holding `data`; every other chunk is
// copied byte for byte, in its place.
inline std::string rebuild(const std::string& original, const Image& image, const std::string& data) {
    std::string out = SIGNATURE;
    bool placed = false;
    for (const Chunk& chunk : image.chunks) {
        if (chunk.type != "IDAT") {
            out.append(original, chunk.offset, 12 + static_cast<size_t>(chunk.length));
        } else if (!placed) {
            putChunk(out, "IDAT", data);
            placed = true;
        }
    }
    return out;
}

}  // namespace pngfile
