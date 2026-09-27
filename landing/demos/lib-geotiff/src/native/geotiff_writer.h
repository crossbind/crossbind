#pragma once

#include <geotiff.h>
#include <geovalues.h>
#include <tiffio.hxx>
#include <xtiffio.h>

#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>

// Writes 8-bit grey pixels as a Deflate-compressed GeoTIFF in longitude and latitude (WGS 84), and
// prints any GeoTIFF's GeoKeys and georeferencing tags the way the listgeo tool does.
class GeoTiffWriter {
public:
    // `pixels` holds width x height bytes, row by row from the top. The image covers west to east
    // and south to north, in degrees.
    static std::u16string write(const std::u16string& pixels, int width, int height, double west, double south, double east, double north,
                                const std::string& citation) {
        if (width < 1 || height < 1 || pixels.size() != static_cast<size_t>(width) * height) throw std::invalid_argument("pixels must hold width * height bytes");
        std::ostringstream out;
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("grey.tif", &out), XTIFFClose);
        if (!tif) throw std::runtime_error("libtiff could not start a file");
        TIFFSetField(tif.get(), TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif.get(), TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif.get(), TIFFTAG_BITSPERSAMPLE, 8);
        TIFFSetField(tif.get(), TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif.get(), TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
        TIFFSetField(tif.get(), TIFFTAG_COMPRESSION, COMPRESSION_ADOBE_DEFLATE);
        TIFFSetField(tif.get(), TIFFTAG_PREDICTOR, PREDICTOR_HORIZONTAL);
        TIFFSetField(tif.get(), TIFFTAG_ROWSPERSTRIP, 16);
        const double tiepoint[6] = {0, 0, 0, west, north, 0};
        const double scale[3] = {(east - west) / width, (north - south) / height, 0};
        TIFFSetField(tif.get(), TIFFTAG_GEOTIEPOINTS, 6, tiepoint);
        TIFFSetField(tif.get(), TIFFTAG_GEOPIXELSCALE, 3, scale);

        Keys keys(GTIFNew(tif.get()), GTIFFree);
        GTIFKeySet(keys.get(), GTModelTypeGeoKey, TYPE_SHORT, 1, ModelTypeGeographic);
        GTIFKeySet(keys.get(), GTRasterTypeGeoKey, TYPE_SHORT, 1, RasterPixelIsArea);
        GTIFKeySet(keys.get(), GTCitationGeoKey, TYPE_ASCII, 0, citation.c_str());
        GTIFKeySet(keys.get(), GeographicTypeGeoKey, TYPE_SHORT, 1, GCS_WGS_84);
        GTIFKeySet(keys.get(), GeogAngularUnitsGeoKey, TYPE_SHORT, 1, Angular_Degree);
        GTIFWriteKeys(keys.get());
        keys.reset();

        std::string row(width, '\0');
        for (int y = 0; y < height; y += 1) {
            for (int x = 0; x < width; x += 1) row[x] = static_cast<char>(pixels[static_cast<size_t>(y) * width + x]);
            if (TIFFWriteScanline(tif.get(), row.data(), y, 0) < 0) throw std::runtime_error("libtiff could not write a row");
        }
        tif.reset();
        const std::string bytes = out.str();
        return std::u16string(bytes.begin(), bytes.end());
    }

    // GTIFPrint: the key and tag dump listgeo starts with, collected into a string.
    static std::string print(const std::u16string& tiff) {
        std::istringstream in(std::string(tiff.begin(), tiff.end()));
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("input.tif", &in), XTIFFClose);
        if (!tif) throw std::runtime_error("not a TIFF file");
        Keys keys(GTIFNew(tif.get()), GTIFFree);
        if (!keys) throw std::runtime_error("libgeotiff could not read the GeoKeys");
        std::string text;
        GTIFPrint(keys.get(), append, &text);
        return text;
    }

private:
    using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
    using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;

    static int append(char* message, void* text) {
        static_cast<std::string*>(text)->append(message);
        return 1;
    }
};
