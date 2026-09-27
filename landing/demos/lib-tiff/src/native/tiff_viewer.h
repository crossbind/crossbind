#pragma once

#include <tiffio.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/errors.h"
#include "../support/raster.h"
#include "../support/sample_art.h"

// Opens whatever TIFF the page mounts: every page's layout and tags, and any page drawn small
// enough for a canvas. Pages of 1 to 16-bit samples in any colour model go through TIFFRGBAImage;
// greyscale pages of 16 bits or more, and float pages, can be stretched between their darkest and
// brightest samples instead. Big pages are read strip by strip or tile row by tile row and
// averaged down as they go, so no full-size RGBA copy is ever made.
class TiffViewer {
public:
    static std::string version() { return TIFFLIB_VERSION_STR_MAJ_MIN_MIC; }

    // The compression schemes this build of libtiff decodes and encodes: [{"name","scheme"}].
    static std::string codecs() {
        TIFFCodec* list = TIFFGetConfiguredCODECs();
        std::vector<std::string> entries;
        for (const TIFFCodec* codec = list; codec && codec->name; ++codec) {
            entries.push_back(tiffapps::json::object({{"name", tiffapps::json::text(codec->name)}, {"scheme", std::to_string(codec->scheme)}}));
        }
        _TIFFfree(list);
        return tiffapps::json::array(entries);
    }

    // {"bigTiff","bigEndian","pages":[{...}]} with one entry per page (directory).
    static std::string pages(const std::string& path) {
        tiffapps::registerGdalNodata();
        tiffapps::Closer file(tiffapps::openFile(path, "r"));
        TIFF* tif = file.get();
        std::vector<std::string> list;
        do {
            list.push_back(describe(tif, static_cast<int>(list.size())));
        } while (TIFFReadDirectory(tif));
        return tiffapps::json::object(
            {{"bigTiff", tiffapps::json::flag(TIFFIsBigTIFF(tif))}, {"bigEndian", tiffapps::json::flag(TIFFIsBigEndian(tif))}, {"pages", tiffapps::json::array(list)}});
    }

    // Draws page `page` (from 0) as RGBA bytes into `rgbaPath`, its longer side at most `maxSide`,
    // in the order the rows are stored; the page applies the Orientation tag when it paints.
    // {"width","height","mode":"rgba"|"stretch","low","high","orientation"}
    static std::string render(const std::string& path, int page, int maxSide, bool stretch, const std::string& rgbaPath) {
        if (maxSide < 1) throw std::invalid_argument("maxSide must be at least 1");
        tiffapps::registerGdalNodata();
        tiffapps::Closer file(tiffapps::openFile(path, "r"));
        TIFF* tif = file.get();
        if (page < 0 || !TIFFSetDirectory(tif, static_cast<tdir_t>(page))) throw std::out_of_range("there is no page " + std::to_string(page + 1));
        const Layout layout = readLayout(tif);
        if (!layout.width || !layout.height) throw std::runtime_error("page " + std::to_string(page + 1) + " has no pixels");
        if (!TIFFIsCODECConfigured(layout.compression)) {
            throw std::runtime_error("page " + std::to_string(page + 1) + " uses " + codecName(layout.compression) + " compression, which this build of libtiff does not include");
        }
        const tiffapps::Size out = tiffapps::fit(layout.width, layout.height, static_cast<uint32_t>(maxSide));
        std::vector<uint8_t> rgba(static_cast<size_t>(out.width) * out.height * 4, 0);
        Range range;  // NaN until a stretch measures it; written as null
        const bool stretched = layout.stretchable && (stretch || !layout.rgbaOk);
        if (stretched) {
            range = drawStretched(tif, layout, out, rgba);
        } else if (layout.rgbaOk) {
            drawRgba(tif, layout, out, rgba);
        } else {
            throw std::runtime_error("page " + std::to_string(page + 1) + ": " + layout.rgbaReason);
        }
        std::ofstream target(rgbaPath, std::ios::binary);
        target.write(reinterpret_cast<const char*>(rgba.data()), static_cast<std::streamsize>(rgba.size()));
        if (!target) throw std::runtime_error("cannot write " + rgbaPath);
        using tiffapps::json::number;
        return tiffapps::json::object({{"width", std::to_string(out.width)},
                                       {"height", std::to_string(out.height)},
                                       {"mode", tiffapps::json::text(stretched ? "stretch" : "rgba")},
                                       {"low", number(range.low)},
                                       {"high", number(range.high)},
                                       {"orientation", std::to_string(layout.orientation)}});
    }

    // Page `page` (from 0) as TIFFPrintDirectory reports it, the text tiffinfo prints.
    static std::string tags(const std::string& path, int page) {
        tiffapps::registerGdalNodata();
        tiffapps::Closer file(tiffapps::openFile(path, "r"));
        TIFF* tif = file.get();
        if (page < 0 || !TIFFSetDirectory(tif, static_cast<tdir_t>(page))) throw std::out_of_range("there is no page " + std::to_string(page + 1));
        char* text = nullptr;
        size_t size = 0;
        FILE* report = open_memstream(&text, &size);
        if (!report) throw std::runtime_error("could not open a memory stream");
        TIFFPrintDirectory(tif, report, TIFFPRINT_NONE);
        std::fclose(report);
        const std::string printed(text, size);
        std::free(text);
        return printed;
    }

    // A four-page sample written here: a scanned letter (1-bit CCITT Group 4), a photo (JPEG),
    // fluorescent cells (12-bit values in 16-bit ZSTD tiles) and an elevation model (32-bit float
    // Deflate tiles with a GDAL no-data value). Returns the file size in bytes.
    static int writeSample(const std::string& path) {
        tiffapps::registerGdalNodata();
        tiffapps::Closer file(tiffapps::openFile(path, "w"));
        TIFF* tif = file.get();
        writeLetter(tif);
        writeLandscape(tif);
        writeCells(tif);
        writeTerrain(tif);
        if (!file.close()) throw tiffapps::failure("libtiff could not finish " + path);
        std::ifstream written(path, std::ios::binary | std::ios::ate);
        return static_cast<int>(written.tellg());
    }

private:
    struct Range {
        double low = std::numeric_limits<double>::quiet_NaN();
        double high = std::numeric_limits<double>::quiet_NaN();
    };

    struct Layout {
        uint32_t width = 0;
        uint32_t height = 0;
        uint16_t bits = 1;
        uint16_t samples = 1;
        uint16_t extra = 0;
        uint16_t format = SAMPLEFORMAT_UINT;
        uint16_t photometric = PHOTOMETRIC_MINISBLACK;
        uint16_t compression = COMPRESSION_NONE;
        uint16_t orientation = ORIENTATION_TOPLEFT;
        bool tiled = false;
        uint32_t tileWidth = 0;
        uint32_t tileHeight = 0;
        uint32_t rowsPerStrip = 0;
        bool rgbaOk = false;
        std::string rgbaReason;
        bool stretchable = false;
        bool hasNodata = false;
        double nodata = 0;
        std::string nodataText;
    };

    static Layout readLayout(TIFF* tif) {
        Layout layout;
        uint16_t* extraKinds = nullptr;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &layout.width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &layout.height);
        TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &layout.bits);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &layout.samples);
        TIFFGetFieldDefaulted(tif, TIFFTAG_EXTRASAMPLES, &layout.extra, &extraKinds);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLEFORMAT, &layout.format);
        if (!TIFFGetField(tif, TIFFTAG_PHOTOMETRIC, &layout.photometric)) layout.photometric = layout.samples - layout.extra >= 3 ? PHOTOMETRIC_RGB : PHOTOMETRIC_MINISBLACK;
        TIFFGetFieldDefaulted(tif, TIFFTAG_COMPRESSION, &layout.compression);
        TIFFGetFieldDefaulted(tif, TIFFTAG_ORIENTATION, &layout.orientation);
        layout.tiled = TIFFIsTiled(tif) != 0;
        if (layout.tiled) {
            TIFFGetField(tif, TIFFTAG_TILEWIDTH, &layout.tileWidth);
            TIFFGetField(tif, TIFFTAG_TILELENGTH, &layout.tileHeight);
        } else {
            TIFFGetFieldDefaulted(tif, TIFFTAG_ROWSPERSTRIP, &layout.rowsPerStrip);
            layout.rowsPerStrip = std::min(layout.rowsPerStrip, layout.height);
        }
        char reason[1024] = "";
        layout.rgbaOk = TIFFRGBAImageOK(tif, reason) != 0;
        layout.rgbaReason = reason;
        const bool floating = layout.format == SAMPLEFORMAT_IEEEFP;
        const bool readable = (layout.bits == 16 || layout.bits == 32 || layout.bits == 64) && (!floating || layout.bits >= 32) && layout.format <= SAMPLEFORMAT_IEEEFP;
        layout.stretchable = readable && (floating || layout.samples - layout.extra == 1 || !layout.rgbaOk);
        char* nodata = nullptr;
        if (TIFFGetField(tif, TIFFTAG_GDAL_NODATA, &nodata) && nodata) {
            layout.nodataText = nodata;
            char* end = nullptr;
            layout.nodata = std::strtod(nodata, &end);
            layout.hasNodata = end != nodata && std::isfinite(layout.nodata);
        }
        return layout;
    }

    static std::string codecName(uint16_t scheme) {
        const TIFFCodec* codec = TIFFFindCODEC(scheme);
        return codec ? codec->name : "scheme " + std::to_string(scheme);
    }

    static std::string photometricName(uint16_t photometric) {
        switch (photometric) {
            case PHOTOMETRIC_MINISWHITE: return "min-is-white";
            case PHOTOMETRIC_MINISBLACK: return "min-is-black";
            case PHOTOMETRIC_RGB: return "RGB";
            case PHOTOMETRIC_PALETTE: return "palette";
            case PHOTOMETRIC_MASK: return "mask";
            case PHOTOMETRIC_SEPARATED: return "CMYK";
            case PHOTOMETRIC_YCBCR: return "YCbCr";
            case PHOTOMETRIC_CIELAB: return "CIE L*a*b*";
            case PHOTOMETRIC_ICCLAB: return "ICC L*a*b*";
            case PHOTOMETRIC_ITULAB: return "ITU L*a*b*";
            case PHOTOMETRIC_LOGL: return "LogL";
            case PHOTOMETRIC_LOGLUV: return "LogLuv";
            case 32803: return "CFA";
            case 34892: return "linear raw";
            default: return std::to_string(photometric);
        }
    }

    static std::string textTag(TIFF* tif, ttag_t tag) {
        char* value = nullptr;
        if (!TIFFGetField(tif, tag, &value) || !value) return "null";
        std::string text = value;
        if (text.size() > 400) text = text.substr(0, 400) + "...";
        return tiffapps::json::text(text);
    }

    static std::string describe(TIFF* tif, int index) {
        const Layout layout = readLayout(tif);
        uint16_t predictor = PREDICTOR_NONE;
        uint16_t planar = PLANARCONFIG_CONTIG;
        uint16_t unit = RESUNIT_INCH;
        uint32_t subfile = 0;
        float xres = 0;
        float yres = 0;
        TIFFGetField(tif, TIFFTAG_PREDICTOR, &predictor);
        TIFFGetFieldDefaulted(tif, TIFFTAG_PLANARCONFIG, &planar);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SUBFILETYPE, &subfile);
        const bool resolution = TIFFGetField(tif, TIFFTAG_XRESOLUTION, &xres) && TIFFGetField(tif, TIFFTAG_YRESOLUTION, &yres);
        TIFFGetFieldDefaulted(tif, TIFFTAG_RESOLUTIONUNIT, &unit);
        const char* formats[] = {"?", "uint", "int", "float", "void", "complex int", "complex float"};
        using tiffapps::json::flag;
        using tiffapps::json::number;
        using tiffapps::json::text;
        return tiffapps::json::object({
            {"index", std::to_string(index)},
            {"width", std::to_string(layout.width)},
            {"height", std::to_string(layout.height)},
            {"bitsPerSample", std::to_string(layout.bits)},
            {"samplesPerPixel", std::to_string(layout.samples)},
            {"extraSamples", std::to_string(layout.extra)},
            {"sampleFormat", text(layout.format <= 6 ? formats[layout.format] : std::to_string(layout.format))},
            {"photometric", text(photometricName(layout.photometric))},
            {"compression", text(codecName(layout.compression))},
            {"compressionCode", std::to_string(layout.compression)},
            {"codecInBuild", flag(TIFFIsCODECConfigured(layout.compression) != 0)},
            {"predictor", std::to_string(predictor)},
            {"planar", text(planar == PLANARCONFIG_SEPARATE ? "separate" : "contig")},
            {"tiled", flag(layout.tiled)},
            {"tileWidth", std::to_string(layout.tileWidth)},
            {"tileHeight", std::to_string(layout.tileHeight)},
            {"rowsPerStrip", std::to_string(layout.rowsPerStrip)},
            {"orientation", std::to_string(layout.orientation)},
            {"xResolution", resolution ? number(xres) : "null"},
            {"yResolution", resolution ? number(yres) : "null"},
            {"resolutionUnit", text(unit == RESUNIT_CENTIMETER ? "cm" : unit == RESUNIT_INCH ? "inch" : "none")},
            {"subfileType", std::to_string(subfile)},
            {"pageName", textTag(tif, TIFFTAG_PAGENAME)},
            {"description", textTag(tif, TIFFTAG_IMAGEDESCRIPTION)},
            {"software", textTag(tif, TIFFTAG_SOFTWARE)},
            {"dateTime", textTag(tif, TIFFTAG_DATETIME)},
            {"nodata", layout.nodataText.empty() ? "null" : text(layout.nodataText)},
            {"rgba", flag(layout.rgbaOk)},
            {"rgbaReason", text(layout.rgbaReason)},
            {"stretchable", flag(layout.stretchable)},
        });
    }

    // TIFFRGBAImage converts any supported layout to premultiplied RGBA; bands of rows are averaged
    // down, then un-premultiplied, because a canvas takes straight alpha.
    static void drawRgba(TIFF* tif, const Layout& layout, tiffapps::Size out, std::vector<uint8_t>& rgba) {
        char reason[1024] = "";
        TIFFRGBAImage image;
        if (!TIFFRGBAImageBegin(&image, tif, 0, reason)) throw std::runtime_error(reason);
        image.req_orientation = image.orientation;  // rows as stored; the page applies Orientation
        uint32_t band = layout.tiled ? layout.tileHeight : layout.rowsPerStrip;
        const uint32_t budget = std::max<uint32_t>(1, static_cast<uint32_t>((32u << 20) / (static_cast<uint64_t>(layout.width) * 4)));
        band = std::max<uint32_t>(1, std::min({band ? band : 1u, budget, layout.height}));
        std::vector<uint32_t> raster(static_cast<size_t>(layout.width) * band);
        tiffapps::BoxRows<4, uint32_t> box(layout.width, layout.height, out, [&](uint32_t x, uint32_t y, const uint32_t* sum, uint32_t count) {
            if (!count) return;
            uint8_t* pixel = &rgba[(static_cast<size_t>(y) * out.width + x) * 4];
            const uint32_t alpha = (sum[3] + count / 2) / count;
            for (int channel = 0; channel < 3; ++channel) {
                const uint32_t value = (sum[channel] + count / 2) / count;
                pixel[channel] = static_cast<uint8_t>(alpha == 255 ? value : alpha == 0 ? 0 : std::min<uint32_t>(255, (value * 255 + alpha / 2) / alpha));
            }
            pixel[3] = static_cast<uint8_t>(alpha);
        });
        for (uint32_t top = 0; top < layout.height; top += band) {
            const uint32_t rows = std::min(band, layout.height - top);
            image.row_offset = static_cast<int>(top);
            image.col_offset = 0;
            if (!TIFFRGBAImageGet(&image, raster.data(), layout.width, rows)) {
                TIFFRGBAImageEnd(&image);
                throw tiffapps::failure("libtiff could not decode rows " + std::to_string(top) + " to " + std::to_string(top + rows - 1));
            }
            for (uint32_t row = 0; row < rows; ++row) {
                const uint32_t* line = &raster[static_cast<size_t>(row) * layout.width];
                box.add(
                    [line](uint32_t x, int channel) -> uint32_t {
                        const uint32_t pixel = line[x];
                        return channel == 0 ? TIFFGetR(pixel) : channel == 1 ? TIFFGetG(pixel) : channel == 2 ? TIFFGetB(pixel) : TIFFGetA(pixel);
                    },
                    [](uint32_t) { return true; });
            }
        }
        box.finish();
        TIFFRGBAImageEnd(&image);
    }

    // The first sample of every pixel, averaged down, then spread between the page's lowest and
    // highest valid samples. No-data and NaN samples are skipped and come out transparent.
    static Range drawStretched(TIFF* tif, const Layout& layout, tiffapps::Size out, std::vector<uint8_t>& rgba) {
        tiffapps::BandReader reader(tif);
        std::vector<double> means(static_cast<size_t>(out.width) * out.height, std::numeric_limits<double>::quiet_NaN());
        double low = std::numeric_limits<double>::infinity();
        double high = -std::numeric_limits<double>::infinity();
        tiffapps::BoxRows<1, double> box(layout.width, layout.height, out, [&](uint32_t x, uint32_t y, const double* sum, uint32_t count) {
            if (count) means[static_cast<size_t>(y) * out.width + x] = sum[0] / count;
        });
        std::vector<double> line(layout.width);
        for (uint32_t y = 0; y < layout.height; ++y) {
            reader.row(y, line.data());
            box.add([&line](uint32_t x, int) { return line[x]; },
                    [&](uint32_t x) {
                        const double value = line[x];
                        if (!std::isfinite(value) || (layout.hasNodata && value == layout.nodata)) return false;
                        low = std::min(low, value);
                        high = std::max(high, value);
                        return true;
                    });
        }
        box.finish();
        const bool invert = layout.photometric == PHOTOMETRIC_MINISWHITE;
        for (size_t i = 0; i < means.size(); ++i) {
            if (std::isnan(means[i])) continue;
            const double scaled = high > low ? (means[i] - low) / (high - low) * 255.0 : 128.0;
            const int grey = std::min(255, std::max(0, static_cast<int>(std::floor(scaled + 0.5))));
            const uint8_t shown = static_cast<uint8_t>(invert ? 255 - grey : grey);
            rgba[i * 4] = shown;
            rgba[i * 4 + 1] = shown;
            rgba[i * 4 + 2] = shown;
            rgba[i * 4 + 3] = 255;
        }
        return {low, high};
    }

    static void pageTags(TIFF* tif, int page, uint32_t width, uint32_t height, const char* name, const char* description) {
        TIFFSetField(tif, TIFFTAG_SUBFILETYPE, FILETYPE_PAGE);
        TIFFSetField(tif, TIFFTAG_PAGENUMBER, page, 4);
        TIFFSetField(tif, TIFFTAG_PAGENAME, name);
        TIFFSetField(tif, TIFFTAG_IMAGEDESCRIPTION, description);
        TIFFSetField(tif, TIFFTAG_SOFTWARE, "crossbind sample, libtiff " TIFFLIB_VERSION_STR_MAJ_MIN_MIC);
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
    }

    static void finishPage(TIFF* tif, const std::string& name) {
        if (!TIFFWriteDirectory(tif)) throw tiffapps::failure("libtiff could not finish the " + name + " page");
    }

    static void writeLetter(TIFF* tif) {
        const uint32_t width = 1654;
        const uint32_t height = 2339;
        const tiffapps::art::Canvas page = tiffapps::art::letter(width, height);
        pageTags(tif, 0, width, height, "letter", "A scanned letter: 1-bit, CCITT Group 4, A4 at 200 dpi");
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 1);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISWHITE);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, COMPRESSION_CCITTFAX4);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, height);
        TIFFSetField(tif, TIFFTAG_XRESOLUTION, 200.0f);
        TIFFSetField(tif, TIFFTAG_YRESOLUTION, 200.0f);
        TIFFSetField(tif, TIFFTAG_RESOLUTIONUNIT, RESUNIT_INCH);
        std::vector<uint8_t> row((width + 7) / 8);
        for (uint32_t y = 0; y < height; ++y) {
            std::fill(row.begin(), row.end(), 0);
            for (uint32_t x = 0; x < width; ++x) {
                if (page.pixels[static_cast<size_t>(y) * width + x] < 128) row[x / 8] |= static_cast<uint8_t>(0x80 >> (x % 8));
            }
            if (TIFFWriteScanline(tif, row.data(), y, 0) < 0) throw tiffapps::failure("libtiff could not write the letter");
        }
        finishPage(tif, "letter");
    }

    static void writeLandscape(TIFF* tif) {
        const uint32_t width = 1200;
        const uint32_t height = 800;
        tiffapps::art::Canvas picture = tiffapps::art::landscape(width, height);
        pageTags(tif, 1, width, height, "landscape", "A landscape: 8-bit RGB, JPEG quality 85, YCbCr 4:2:0");
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 8);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 3);
        TIFFSetField(tif, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, COMPRESSION_JPEG);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_YCBCR);
        TIFFSetField(tif, TIFFTAG_JPEGCOLORMODE, JPEGCOLORMODE_RGB);  // libjpeg converts the RGB rows
        TIFFSetField(tif, TIFFTAG_JPEGQUALITY, 85);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, TIFFDefaultStripSize(tif, 0));
        for (uint32_t y = 0; y < height; ++y) {
            if (TIFFWriteScanline(tif, &picture.pixels[static_cast<size_t>(y) * width * 3], y, 0) < 0) throw tiffapps::failure("libtiff could not write the landscape");
        }
        finishPage(tif, "landscape");
    }

    static void writeCells(TIFF* tif) {
        const uint32_t size = 1024;
        pageTags(tif, 2, size, size, "cells", "Fluorescent cells: 12-bit values in 16-bit samples, ZSTD with horizontal prediction, 256x256 tiles");
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 16);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, COMPRESSION_ZSTD);
        TIFFSetField(tif, TIFFTAG_PREDICTOR, PREDICTOR_HORIZONTAL);
        tiffapps::writeTiles<uint16_t>(tif, tiffapps::art::cells(size, size, 90, 2026), size, size, 256, 0);
        finishPage(tif, "cells");
    }

    static void writeTerrain(TIFF* tif) {
        const uint32_t width = 768;
        const uint32_t height = 512;
        const float sea = -9999.0f;
        pageTags(tif, 3, width, height, "elevation", "Elevation in metres: 32-bit float, Deflate with the floating-point predictor, 256x256 tiles, no-data -9999");
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 32);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif, TIFFTAG_SAMPLEFORMAT, SAMPLEFORMAT_IEEEFP);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, COMPRESSION_ADOBE_DEFLATE);
        TIFFSetField(tif, TIFFTAG_PREDICTOR, PREDICTOR_FLOATINGPOINT);
        TIFFSetField(tif, TIFFTAG_GDAL_NODATA, "-9999");
        tiffapps::writeTiles<float>(tif, tiffapps::art::terrain(width, height, 17, true, sea), width, height, 256, sea);
        finishPage(tif, "elevation");
    }
};
