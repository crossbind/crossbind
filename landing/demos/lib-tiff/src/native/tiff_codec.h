#pragma once

#include <tiffio.h>
#include <tiffio.hxx>

#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Canvas pixels to a TIFF and back, in memory: TIFFStreamOpen gives libtiff a std::ostream or
// std::istream instead of a file. Bytes cross the binding as std::u16string, one code unit (0-255)
// per byte.
class Tiff {
public:
    static std::string version() { return TIFFLIB_VERSION_STR_MAJ_MIN_MIC; }

    // RGBA pixels, as ImageData holds them, to an 8-bit RGB TIFF (alpha is not stored). `compression`
    // is a COMPRESSION_* code from tiff.h: 1 none, 5 LZW, 8 Deflate, 32773 PackBits, 50000 ZSTD.
    static std::u16string encode(const std::u16string& rgba, int width, int height, int compression) {
        if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) throw std::invalid_argument("rgba must hold width x height x 4 bytes");
        if (!TIFFIsCODECConfigured(static_cast<uint16_t>(compression))) throw std::invalid_argument("compression " + std::to_string(compression) + " is not in this build");
        std::vector<unsigned char> rgb(static_cast<size_t>(width) * height * 3);
        for (size_t pixel = 0; pixel < rgb.size() / 3; ++pixel) {
            for (size_t channel = 0; channel < 3; ++channel) {
                const char16_t unit = rgba[pixel * 4 + channel];
                if (unit > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
                rgb[pixel * 3 + channel] = static_cast<unsigned char>(unit);
            }
        }
        std::ostringstream out;
        TIFF* tif = TIFFStreamOpen("memory", &out);
        if (!tif) throw std::runtime_error("libtiff could not open a stream for writing");
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 3);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 8);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB);
        TIFFSetField(tif, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, compression);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, TIFFDefaultStripSize(tif, 0));
        for (int y = 0; y < height; ++y) {
            if (TIFFWriteScanline(tif, &rgb[static_cast<size_t>(y) * width * 3], static_cast<uint32_t>(y), 0) < 0) {
                TIFFClose(tif);
                throw std::runtime_error("libtiff could not write row " + std::to_string(y));
            }
        }
        TIFFClose(tif);
        const std::string bytes = out.str();
        std::u16string units(bytes.size(), u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) units[i] = static_cast<unsigned char>(bytes[i]);
        return units;
    }

    // The first page's size, samples and codec, and the page count.
    static std::string describe(const std::u16string& tiff) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = open(in);
        uint32_t width = 0;
        uint32_t height = 0;
        uint16_t samples = 0;
        uint16_t bits = 0;
        uint16_t compression = 0;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &samples);
        TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &bits);
        TIFFGetFieldDefaulted(tif, TIFFTAG_COMPRESSION, &compression);
        const unsigned pages = TIFFNumberOfDirectories(tif);
        TIFFClose(tif);
        const TIFFCodec* codec = TIFFFindCODEC(compression);
        return std::to_string(width) + "x" + std::to_string(height) + ", " + std::to_string(samples) + " x " + std::to_string(bits) + "-bit samples, " +
               (codec ? codec->name : "compression " + std::to_string(compression)) + ", " + std::to_string(pages) + (pages == 1 ? " page" : " pages");
    }

    // The first page as RGBA, top row first, whatever its bit depth, colour model, layout or codec.
    static std::u16string decode(const std::u16string& tiff) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = open(in);
        uint32_t width = 0;
        uint32_t height = 0;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        if (static_cast<uint64_t>(width) * height > (64u << 20)) {
            TIFFClose(tif);
            throw std::runtime_error("more than 64 megapixels: decode it from a file instead");
        }
        std::vector<uint32_t> raster(static_cast<size_t>(width) * height);
        const int ok = TIFFReadRGBAImageOriented(tif, width, height, raster.data(), ORIENTATION_TOPLEFT, 0);
        TIFFClose(tif);
        if (!ok) throw std::runtime_error("libtiff cannot convert this page to RGBA");
        std::u16string rgba(raster.size() * 4, u'\0');
        for (size_t i = 0; i < raster.size(); ++i) {
            rgba[i * 4] = static_cast<char16_t>(TIFFGetR(raster[i]));
            rgba[i * 4 + 1] = static_cast<char16_t>(TIFFGetG(raster[i]));
            rgba[i * 4 + 2] = static_cast<char16_t>(TIFFGetB(raster[i]));
            rgba[i * 4 + 3] = static_cast<char16_t>(TIFFGetA(raster[i]));
        }
        return rgba;
    }

private:
    static TIFF* open(std::istringstream& in) {
        TIFF* tif = TIFFStreamOpen("memory", &in);
        if (!tif) throw std::runtime_error("not a TIFF libtiff can read");
        return tif;
    }

    static std::string fromUnits(const std::u16string& units) {
        std::string bytes(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
            bytes[i] = static_cast<char>(units[i]);
        }
        return bytes;
    }
};
