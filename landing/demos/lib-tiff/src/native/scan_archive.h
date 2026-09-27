#pragma once

#include <tiffio.h>
#include <tiffio.hxx>

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/errors.h"
#include "../support/raster.h"
#include "../support/sample_art.h"

// Photographed or scanned pages to one archival TIFF: each page is turned black and white with
// Otsu's threshold and appended as CCITT Group 4, the fax codec archives use for documents. Pages
// travel as files in the module's filesystem: RGBA in, 1-bit rows, then the TIFF.
class ScanArchive {
public:
    // A generated page photo (index 0 or 1), RGBA, written to `rgbaPath`.
    static void makePage(int index, int width, int height, const std::string& rgbaPath) {
        if (width <= 0 || height <= 0) throw std::invalid_argument("width and height must be positive");
        const tiffapps::art::Canvas page = tiffapps::art::photographedPage(index, static_cast<uint32_t>(width), static_cast<uint32_t>(height));
        writeFile(rgbaPath, page.pixels);
    }

    // Grey from RGBA, then black where grey <= threshold; threshold -1 picks Otsu's. Writes 1-bit rows
    // (MSB first, 1 = black) to `bitsPath`. {"threshold","black","pixels"}
    static std::string binarize(const std::string& rgbaPath, int width, int height, int threshold, const std::string& bitsPath) {
        const std::vector<uint8_t> rgba = readFile(rgbaPath);
        const size_t pixels = static_cast<size_t>(width) * height;
        if (width <= 0 || height <= 0 || rgba.size() != pixels * 4) throw std::invalid_argument("the RGBA file must hold width x height x 4 bytes");
        std::vector<uint8_t> grey(pixels);
        uint64_t histogram[256] = {};
        for (size_t i = 0; i < pixels; ++i) {
            grey[i] = static_cast<uint8_t>((77u * rgba[i * 4] + 150u * rgba[i * 4 + 1] + 29u * rgba[i * 4 + 2] + 128u) >> 8);
            histogram[grey[i]] += 1;
        }
        const int cut = threshold < 0 ? otsu(histogram, pixels) : std::min(threshold, 255);
        const size_t rowBytes = (static_cast<size_t>(width) + 7) / 8;
        std::vector<uint8_t> bits(rowBytes * height, 0);
        uint64_t black = 0;
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                if (grey[static_cast<size_t>(y) * width + x] > cut) continue;
                bits[y * rowBytes + x / 8] |= static_cast<uint8_t>(0x80 >> (x % 8));
                black += 1;
            }
        }
        writeFile(bitsPath, bits);
        return tiffapps::json::object({{"threshold", std::to_string(cut)}, {"black", std::to_string(black)}, {"pixels", std::to_string(pixels)}});
    }

    // Adds the 1-bit page as page `index` of `count` in `tifPath`, which the first page creates.
    // {"page","bytes","fileBytes"}: bytes is what this page added to the file.
    static std::string addPage(const std::string& tifPath, const std::string& bitsPath, int width, int height, int dpi, int index, int count) {
        const std::vector<uint8_t> bits = readFile(bitsPath);
        const size_t rowBytes = (static_cast<size_t>(width) + 7) / 8;
        if (width <= 0 || height <= 0 || bits.size() != rowBytes * height) throw std::invalid_argument("the bits file must hold height rows of (width + 7) / 8 bytes");
        const uint64_t before = index == 0 ? 0 : fileSize(tifPath);
        tiffapps::Closer file(tiffapps::openFile(tifPath, index == 0 ? "w" : "a"));
        TIFF* tif = file.get();
        pageTags(tif, width, height, COMPRESSION_CCITTFAX4);
        TIFFSetField(tif, TIFFTAG_SUBFILETYPE, FILETYPE_PAGE);
        TIFFSetField(tif, TIFFTAG_PAGENUMBER, index, count);
        TIFFSetField(tif, TIFFTAG_XRESOLUTION, static_cast<float>(dpi));
        TIFFSetField(tif, TIFFTAG_YRESOLUTION, static_cast<float>(dpi));
        TIFFSetField(tif, TIFFTAG_RESOLUTIONUNIT, RESUNIT_INCH);
        writeRows(tif, bits, rowBytes, height);
        if (!file.close()) throw tiffapps::failure("libtiff could not finish " + tifPath);
        const uint64_t after = fileSize(tifPath);
        return tiffapps::json::object({{"page", std::to_string(index + 1)}, {"bytes", std::to_string(after - before)}, {"fileBytes", std::to_string(after)}});
    }

    // The same 1-bit page in every codec a black-and-white page can use, each as a one-page TIFF:
    // [{"name","scheme","bytes"}]
    static std::string codecSizes(const std::string& bitsPath, int width, int height) {
        const std::vector<uint8_t> bits = readFile(bitsPath);
        const size_t rowBytes = (static_cast<size_t>(width) + 7) / 8;
        if (width <= 0 || height <= 0 || bits.size() != rowBytes * height) throw std::invalid_argument("the bits file must hold height rows of (width + 7) / 8 bytes");
        const uint16_t schemes[] = {COMPRESSION_NONE, COMPRESSION_PACKBITS, COMPRESSION_LZW, COMPRESSION_ADOBE_DEFLATE, COMPRESSION_ZSTD, COMPRESSION_CCITTFAX3, COMPRESSION_CCITTFAX4};
        std::vector<std::string> sizes;
        for (uint16_t scheme : schemes) {
            tiffapps::quiet();
            std::ostringstream stream;
            TIFF* tif = TIFFStreamOpen("page", &stream);
            if (!tif) throw tiffapps::failure("libtiff could not open a stream");
            tiffapps::Closer file(tif);
            pageTags(tif, width, height, scheme);
            writeRows(tif, bits, rowBytes, height);
            if (!file.close()) throw tiffapps::failure("libtiff could not write the page");
            const TIFFCodec* codec = TIFFFindCODEC(scheme);
            sizes.push_back(tiffapps::json::object(
                {{"name", tiffapps::json::text(codec ? codec->name : "?")}, {"scheme", std::to_string(scheme)}, {"bytes", std::to_string(stream.str().size())}}));
        }
        return tiffapps::json::array(sizes);
    }

private:
    // Otsu's method: the grey level that best splits the histogram into two classes, by the largest
    // between-class variance.
    static int otsu(const uint64_t* histogram, size_t pixels) {
        double sum = 0;
        for (int level = 0; level < 256; ++level) sum += static_cast<double>(level) * static_cast<double>(histogram[level]);
        double sumBelow = 0;
        double weightBelow = 0;
        double best = -1;
        int threshold = 0;
        for (int level = 0; level < 256; ++level) {
            weightBelow += static_cast<double>(histogram[level]);
            if (weightBelow == 0) continue;
            const double weightAbove = static_cast<double>(pixels) - weightBelow;
            if (weightAbove == 0) break;
            sumBelow += static_cast<double>(level) * static_cast<double>(histogram[level]);
            const double meanBelow = sumBelow / weightBelow;
            const double meanAbove = (sum - sumBelow) / weightAbove;
            const double between = weightBelow * weightAbove * (meanBelow - meanAbove) * (meanBelow - meanAbove);
            if (between > best) {
                best = between;
                threshold = level;
            }
        }
        return threshold;
    }

    static void pageTags(TIFF* tif, int width, int height, uint16_t scheme) {
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 1);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISWHITE);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, scheme);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, height);
    }

    static void writeRows(TIFF* tif, const std::vector<uint8_t>& bits, size_t rowBytes, int height) {
        std::vector<uint8_t> row(rowBytes);
        for (int y = 0; y < height; ++y) {
            std::copy_n(&bits[static_cast<size_t>(y) * rowBytes], rowBytes, row.begin());  // libtiff may encode in place
            if (TIFFWriteScanline(tif, row.data(), static_cast<uint32_t>(y), 0) < 0) throw tiffapps::failure("libtiff could not write row " + std::to_string(y));
        }
    }

    static std::vector<uint8_t> readFile(const std::string& path) {
        std::ifstream in(path, std::ios::binary);
        if (!in) throw std::runtime_error("cannot read " + path);
        return std::vector<uint8_t>(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }

    static void writeFile(const std::string& path, const std::vector<uint8_t>& bytes) {
        std::ofstream out(path, std::ios::binary);
        out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        if (!out) throw std::runtime_error("cannot write " + path);
    }

    static uint64_t fileSize(const std::string& path) {
        std::ifstream in(path, std::ios::binary | std::ios::ate);
        return in ? static_cast<uint64_t>(in.tellg()) : 0;
    }
};
