#pragma once

#include <zlib.h>

#include <array>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/png_file.h"

// A lossless PNG optimizer. PNG compresses its pixels with zlib: each row is filtered (predicted from
// its neighbours) and the rows are deflated as one stream. This inflates that stream, filters the rows
// again and deflates them again at level 9, and keeps whichever combination comes out smallest. Every
// chunk but IDAT is copied byte for byte, so colours and metadata stay as they were, and the result is
// decoded again and compared with the original pixels before it is written. Paths are in the module's
// filesystem.
class PngSqueezer {
public:
    // Writes a generated 512 x 384 RGB chart the way a fast encoder writes one (no filtering, zlib
    // level 1) and returns the file's size.
    static double writeSample(const std::string& path) {
        pngfile::Image image;
        image.width = SAMPLE_WIDTH;
        image.height = SAMPLE_HEIGHT;
        image.bitDepth = 8;
        image.colorType = 2;
        const std::string data = pngfile::compress(pngfile::filter(image, sampleRows(), 0), 1, Z_DEFAULT_STRATEGY);
        std::string header;
        pngfile::putBe32(header, image.width);
        pngfile::putBe32(header, image.height);
        header += std::string{8, 2, 0, 0, 0};
        std::string png = pngfile::SIGNATURE;
        pngfile::putChunk(png, "IHDR", header);
        pngfile::putChunk(png, "IDAT", data);
        pngfile::putChunk(png, "IEND", "");
        writeFile(path, png);
        return static_cast<double>(png.size());
    }

    // {"width","height","bitDepth","colorType","interlaced","chunks":[{"type","length","crcOk"}],
    //  "idatChunks","idatBytes","rawBytes","filters":[rows using None, Sub, Up, Average, Paeth],"zlibLevel":0-3}
    static std::string inspect(const std::string& path) {
        const std::string data = readFile(path);
        const pngfile::Image image = pngfile::parse(data);
        std::array<double, 5> counts{};
        const std::string raw = pngfile::unfilter(image, pngfile::inflateData(image), counts);
        std::string chunks = "[";
        int idatChunks = 0;
        for (size_t i = 0; i < image.chunks.size(); ++i) {
            const pngfile::Chunk& chunk = image.chunks[i];
            if (chunk.type == "IDAT") idatChunks += 1;
            chunks += std::string(i ? ",{" : "{") + "\"type\":\"" + printable(chunk.type) + "\",\"length\":" + std::to_string(chunk.length) +
                      ",\"crcOk\":" + (chunk.crcOk ? "true" : "false") + "}";
        }
        std::string filters = "[";
        for (size_t i = 0; i < counts.size(); ++i) filters += (i ? "," : "") + std::to_string(static_cast<long long>(counts[i]));
        // The second byte of a zlib stream records the level the encoder claimed: 0 fastest to 3 maximum.
        const int level = image.idat.size() > 1 ? static_cast<uint8_t>(image.idat[1]) >> 6 : -1;
        return "{\"width\":" + std::to_string(image.width) + ",\"height\":" + std::to_string(image.height) + ",\"bitDepth\":" + std::to_string(image.bitDepth) +
               ",\"colorType\":" + std::to_string(image.colorType) + ",\"interlaced\":" + (image.interlace ? "true" : "false") + ",\"chunks\":" + chunks +
               "],\"idatChunks\":" + std::to_string(idatChunks) + ",\"idatBytes\":" + std::to_string(image.idat.size()) + ",\"rawBytes\":" + std::to_string(raw.size()) +
               ",\"filters\":" + filters + "],\"zlibLevel\":" + std::to_string(level) + "}";
    }

    // Deflates the file's own filtered rows and five filter choices at level 9, then the smallest of
    // those again with Z_FILTERED, zlib's strategy for filtered image data, and writes the smallest PNG
    // to `output` (the original bytes when nothing beats them). A choice that reproduces the file's own
    // rows is not deflated twice: its trial says "reused".
    // {"original","bytes","improved","best":{"filter","strategy","idat"},"trials":[{"filter","strategy","idat","ms","reused"}]}
    static std::string optimize(const std::string& input, const std::string& output) {
        const std::string original = readFile(input);
        const pngfile::Image image = pngfile::parse(original);
        const std::string found = pngfile::inflateData(image);
        std::array<double, 5> counts{};
        const std::string raw = pngfile::unfilter(image, found, counts);
        const char* const filterNames[] = {"none", "sub", "up", "average", "paeth", "adaptive", "as found"};
        std::string best;
        std::string bestRows;
        int bestFilter = 6;
        int bestStrategy = Z_DEFAULT_STRATEGY;
        std::string trials = "[";
        const auto record = [&](int method, int strategy, size_t size, double ms, bool reused) {
            trials += std::string(trials.size() > 1 ? ",{" : "{") + "\"filter\":\"" + filterNames[method] + "\",\"strategy\":\"" +
                      (strategy == Z_FILTERED ? "filtered" : "default") + "\",\"idat\":" + std::to_string(size) + ",\"ms\":" +
                      std::to_string(static_cast<long long>(ms + 0.5)) + ",\"reused\":" + (reused ? "true" : "false") + "}";
        };
        const auto attempt = [&](int method, const std::string& rows, int strategy) {
            const auto started = std::chrono::steady_clock::now();
            std::string data = pngfile::compress(rows, 9, strategy);
            record(method, strategy, data.size(), std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count(), false);
            if (best.empty() || data.size() < best.size()) {
                best = std::move(data);
                bestRows = rows;
                bestFilter = method;
                bestStrategy = strategy;
            }
        };
        attempt(6, found, Z_DEFAULT_STRATEGY);
        const size_t foundSize = best.size();
        for (int method : {0, 1, 2, 4, 5}) {
            const std::string rows = pngfile::filter(image, raw, method);
            if (rows == found) record(method, Z_DEFAULT_STRATEGY, foundSize, 0, true);
            else attempt(method, rows, Z_DEFAULT_STRATEGY);
        }
        attempt(bestFilter, std::string(bestRows), Z_FILTERED);
        const char* const strategyNames[] = {"default", "filtered"};
        const int bestStrategyIndex = bestStrategy == Z_FILTERED ? 1 : 0;
        const std::string rebuilt = pngfile::rebuild(original, image, best);
        if (!sameRows(image, raw, rebuilt)) throw std::logic_error("the rebuilt PNG does not decode to the same pixels");
        const bool improved = rebuilt.size() < original.size();
        writeFile(output, improved ? rebuilt : original);
        return "{\"original\":" + std::to_string(original.size()) + ",\"bytes\":" + std::to_string(improved ? rebuilt.size() : original.size()) +
               ",\"improved\":" + (improved ? "true" : "false") + ",\"best\":{\"filter\":\"" + filterNames[bestFilter] + "\",\"strategy\":\"" +
               strategyNames[bestStrategyIndex] + "\",\"idat\":" + std::to_string(best.size()) + "},\"trials\":" + trials + "]}";
    }

    // Whether two PNGs have the same header fields and the same pixel rows once the filters are undone.
    static bool samePixels(const std::string& first, const std::string& second) {
        const std::string data = readFile(first);
        const pngfile::Image image = pngfile::parse(data);
        std::array<double, 5> counts{};
        return sameRows(image, pngfile::unfilter(image, pngfile::inflateData(image), counts), readFile(second));
    }

private:
    static constexpr uint32_t SAMPLE_WIDTH = 512;
    static constexpr uint32_t SAMPLE_HEIGHT = 384;

    static bool sameRows(const pngfile::Image& image, const std::string& raw, const std::string& otherFile) {
        const pngfile::Image other = pngfile::parse(otherFile);
        if (other.width != image.width || other.height != image.height || other.bitDepth != image.bitDepth || other.colorType != image.colorType ||
            other.interlace != image.interlace) {
            return false;
        }
        std::array<double, 5> counts{};
        return pngfile::unfilter(other, pngfile::inflateData(other), counts) == raw;
    }

    // Bars on a grid over a soft gradient, with a disc: flat areas, edges and smooth ramps, as in charts
    // and screenshots. Integer arithmetic only, so the Python reference draws the same bytes.
    static std::string sampleRows() {
        const int width = static_cast<int>(SAMPLE_WIDTH);
        const int height = static_cast<int>(SAMPLE_HEIGHT);
        std::string raw(static_cast<size_t>(width) * height * 3, '\0');
        uint32_t state = 7;
        std::vector<int> bars(width / 32);
        for (int& bar : bars) {
            state = state * 1664525u + 1013904223u;
            bar = 40 + static_cast<int>((state >> 8) % 280);
        }
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                int r = 248 - y * 30 / height, g = 250 - y * 22 / height, b = 252 - y * 12 / height;
                if (x % 32 == 0 || y % 32 == 0) {
                    r -= 20;
                    g -= 18;
                    b -= 14;
                }
                const int bar = bars[x / 32];
                const int top = height - bar;
                if (x % 32 >= 6 && x % 32 < 26 && y >= top) {
                    const int shade = (y - top) * 60 / bar;
                    r = 22 + shade;
                    g = 101 + shade / 2;
                    b = 216 - shade / 3;
                }
                const int dx = x - width * 3 / 4, dy = y - height / 4;
                if (dx * dx + dy * dy < 44 * 44) {
                    r = 245;
                    g = 158;
                    b = 11;
                }
                char* pixel = &raw[(static_cast<size_t>(y) * width + x) * 3];
                pixel[0] = static_cast<char>(r);
                pixel[1] = static_cast<char>(g);
                pixel[2] = static_cast<char>(b);
            }
        }
        return raw;
    }

    static std::string printable(const std::string& type) {
        std::string out = type;
        for (char& c : out) {
            if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) c = '?';
        }
        return out;
    }

    static std::string readFile(const std::string& path) {
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "rb"), std::fclose);
        if (!file) throw std::runtime_error("cannot open " + path);
        std::string data;
        std::vector<char> chunk(1 << 16);
        size_t count = 0;
        while ((count = std::fread(chunk.data(), 1, chunk.size(), file.get())) > 0) data.append(chunk.data(), count);
        if (std::ferror(file.get())) throw std::runtime_error("cannot read " + path);
        return data;
    }

    static void writeFile(const std::string& path, const std::string& data) {
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "wb"), std::fclose);
        if (!file || std::fwrite(data.data(), 1, data.size(), file.get()) != data.size()) throw std::runtime_error("cannot write " + path);
    }
};
