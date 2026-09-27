#pragma once

#include <tiffio.h>
#include <tiffio.hxx>

#include <cstdint>
#include <cstring>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Scientific rasters keep their real values: one band of 32-bit floats, written and read a scanline
// at a time. The samples cross the binding as little-endian float32 bytes in a std::u16string, one
// code unit (0-255) per byte, which is what a Float32Array's buffer holds.
class TiffSamples {
public:
    // `compression` is a COMPRESSION_* code; `predictor` 1 is none, 3 is the floating-point predictor,
    // which Deflate, LZW and ZSTD compress better.
    static std::u16string writeFloat32(const std::u16string& samples, int width, int height, int compression, int predictor) {
        if (width <= 0 || height <= 0 || samples.size() != static_cast<size_t>(width) * height * 4) throw std::invalid_argument("samples must hold width x height x 4 bytes");
        const std::string raw = fromUnits(samples);
        std::ostringstream out;
        TIFF* tif = TIFFStreamOpen("memory", &out);
        if (!tif) throw std::runtime_error("libtiff could not open a stream for writing");
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 32);
        TIFFSetField(tif, TIFFTAG_SAMPLEFORMAT, SAMPLEFORMAT_IEEEFP);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, compression);
        if (predictor != PREDICTOR_NONE) TIFFSetField(tif, TIFFTAG_PREDICTOR, predictor);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, TIFFDefaultStripSize(tif, 0));
        std::vector<float> row(static_cast<size_t>(width));
        for (int y = 0; y < height; ++y) {
            std::memcpy(row.data(), raw.data() + static_cast<size_t>(y) * width * 4, row.size() * 4);
            if (TIFFWriteScanline(tif, row.data(), static_cast<uint32_t>(y), 0) < 0) {
                TIFFClose(tif);
                throw std::runtime_error("libtiff could not write row " + std::to_string(y));
            }
        }
        TIFFClose(tif);
        return toUnits(out.str());
    }

    // The samples back, row by row with TIFFReadScanline, as little-endian float32 bytes.
    static std::u16string readFloat32(const std::u16string& tiff) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = open(in);
        uint32_t width = 0;
        uint32_t height = 0;
        uint16_t bits = 0;
        uint16_t format = 0;
        uint16_t samples = 0;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &bits);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLEFORMAT, &format);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &samples);
        if (bits != 32 || format != SAMPLEFORMAT_IEEEFP || samples != 1 || TIFFIsTiled(tif)) {
            TIFFClose(tif);
            throw std::runtime_error("not a one-band float32 TIFF in strips");
        }
        std::string raw(static_cast<size_t>(width) * height * 4, '\0');
        for (uint32_t y = 0; y < height; ++y) {
            if (TIFFReadScanline(tif, &raw[static_cast<size_t>(y) * width * 4], y, 0) < 0) {
                TIFFClose(tif);
                throw std::runtime_error("libtiff could not read row " + std::to_string(y));
            }
        }
        TIFFClose(tif);
        return toUnits(raw);
    }

    // Whether TIFFReadRGBAImage could turn the image into display pixels, and if not, why not.
    static std::string rgbaCheck(const std::u16string& tiff) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = open(in);
        char reason[1024] = "";
        const bool ok = TIFFRGBAImageOK(tif, reason);
        TIFFClose(tif);
        return ok ? "TIFFReadRGBAImage can convert it" : reason;
    }

private:
    static TIFF* open(std::istringstream& in) {
        TIFF* tif = TIFFStreamOpen("memory", &in);
        if (!tif) throw std::runtime_error("not a TIFF libtiff can read");
        return tif;
    }

    static std::u16string toUnits(const std::string& bytes) {
        std::u16string units(bytes.size(), u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) units[i] = static_cast<unsigned char>(bytes[i]);
        return units;
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
