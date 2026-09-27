#pragma once

#include <geo_normalize.h>
#include <geotiff.h>
#include <geovalues.h>
#include <xtiffio.h>

#include <sys/stat.h>

#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// What the app wrappers share: files opened by path with libtiff's and libgeotiff's messages caught
// instead of printed, the normalised definition and the corners as JSON, and the samples.
namespace geotiffapp {

inline std::string& lastError() {
    static std::string message;
    return message;
}

inline void onTiffError(const char* module, const char* format, va_list args) {
    char text[512];
    std::vsnprintf(text, sizeof text, format, args);
    lastError() = module && *module ? std::string(module) + ": " + text : std::string(text);
}

// Files from other tools often carry tags libtiff does not know, such as GDAL's metadata; those
// warnings are not the visitor's problem.
inline void onTiffWarning(const char*, const char*, va_list) {}

inline void onGeoTiffError(GTIF*, int level, const char* format, ...) {
    if (level != LIBGEOTIFF_ERROR) return;
    char text[512];
    va_list args;
    va_start(args, format);
    std::vsnprintf(text, sizeof text, format, args);
    va_end(args);
    lastError() = text;
}

[[noreturn]] inline void fail(const std::string& fallback) { throw std::runtime_error(lastError().empty() ? fallback : lastError()); }

using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;

// libtiff names the file in its messages; the page shows its name, not the in-memory mount path.
inline Tiff openTiff(const std::string& path, const char* mode) {
    TIFFSetErrorHandler(onTiffError);
    TIFFSetWarningHandler(onTiffWarning);
    lastError().clear();
    Tiff tif(XTIFFOpen(path.c_str(), mode), XTIFFClose);
    if (tif) return tif;
    const std::string name = path.substr(path.find_last_of('/') + 1);
    std::string message = lastError().empty() ? "libtiff could not open " + path : lastError();
    for (size_t at = message.find(path); at != std::string::npos; at = message.find(path, at + name.size())) message.replace(at, path.size(), name);
    throw std::runtime_error(message);
}

inline Keys openKeys(TIFF* tif) { return Keys(GTIFNewEx(tif, onGeoTiffError, nullptr), GTIFFree); }

inline double fileSize(const std::string& path) {
    struct stat info;
    return stat(path.c_str(), &info) == 0 ? static_cast<double>(info.st_size) : 0;
}

inline std::string number(double value) {
    if (!std::isfinite(value)) return "null";
    char text[32];
    std::snprintf(text, sizeof text, "%.17g", value);
    return text;
}

inline std::string quote(const std::string& value) {
    std::string out = "\"";
    for (const unsigned char character : value) {
        if (character == '"' || character == '\\') {
            out += '\\';
            out += static_cast<char>(character);
        } else if (character == '\n') {
            out += "\\n";
        } else if (character < 0x20) {
            out += ' ';
        } else {
            out += static_cast<char>(character);
        }
    }
    return out + "\"";
}

inline std::string pair(double a, double b) { return "[" + number(a) + "," + number(b) + "]"; }

inline std::string coded(int code, const std::string& name) { return "[" + std::to_string(code) + "," + quote(name) + "]"; }

// The GTIFGet...Info functions hand over strings the caller frees.
inline std::string taken(char* text) {
    const std::string value = text ? text : "";
    GTIFFreeMemory(text);
    return value;
}

inline std::string compressionName(unsigned compression) {
    switch (compression) {
        case COMPRESSION_NONE: return "none";
        case COMPRESSION_CCITTRLE: case COMPRESSION_CCITTFAX3: case COMPRESSION_CCITTFAX4: return "CCITT";
        case COMPRESSION_LZW: return "LZW";
        case COMPRESSION_OJPEG: case COMPRESSION_JPEG: return "JPEG";
        case COMPRESSION_ADOBE_DEFLATE: case COMPRESSION_DEFLATE: return "Deflate";
        case COMPRESSION_PACKBITS: return "PackBits";
        case COMPRESSION_LERC: return "LERC";
        case COMPRESSION_LZMA: return "LZMA";
        case COMPRESSION_ZSTD: return "ZSTD";
        case COMPRESSION_WEBP: return "WebP";
        case COMPRESSION_JXL: return "JPEG XL";
        default: return "code " + std::to_string(compression);
    }
}

inline std::string sampleFormatName(unsigned format) {
    if (format == SAMPLEFORMAT_INT) return "signed integer";
    if (format == SAMPLEFORMAT_IEEEFP) return "floating point";
    if (format == SAMPLEFORMAT_COMPLEXINT || format == SAMPLEFORMAT_COMPLEXIEEEFP) return "complex";
    return "unsigned integer";
}

// Size, bands, type, compression and layout from the first directory, and how many directories
// (overviews or pages) follow it.
inline std::string fileJson(TIFF* tif, const std::string& path) {
    uint32_t width = 0;
    uint32_t height = 0;
    uint16_t samples = 1;
    uint16_t bits = 1;
    uint16_t format = SAMPLEFORMAT_UINT;
    uint16_t compression = COMPRESSION_NONE;
    TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
    TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
    TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &samples);
    TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &bits);
    TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLEFORMAT, &format);
    TIFFGetFieldDefaulted(tif, TIFFTAG_COMPRESSION, &compression);
    const bool tiled = TIFFIsTiled(tif) != 0;
    uint32_t blockWidth = width;
    uint32_t blockHeight = 0;
    if (tiled) {
        TIFFGetField(tif, TIFFTAG_TILEWIDTH, &blockWidth);
        TIFFGetField(tif, TIFFTAG_TILELENGTH, &blockHeight);
    } else {
        TIFFGetFieldDefaulted(tif, TIFFTAG_ROWSPERSTRIP, &blockHeight);
        if (blockHeight > height) blockHeight = height;
    }
    const int directories = TIFFNumberOfDirectories(tif);
    TIFFSetDirectory(tif, 0);
    return "{\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) + ",\"bands\":" + std::to_string(samples) +
           ",\"bits\":" + std::to_string(bits) + ",\"format\":" + quote(sampleFormatName(format)) + ",\"compression\":" + quote(compressionName(compression)) +
           ",\"tiled\":" + (tiled ? "true" : "false") + ",\"block\":[" + std::to_string(blockWidth) + "," + std::to_string(blockHeight) + "]" +
           ",\"directories\":" + std::to_string(directories) + ",\"bytes\":" + number(fileSize(path)) + "}";
}

// The coordinate system GTIFGetDefn works out, with the EPSG names PROJ's database gives.
inline std::string definitionJson(GTIF* keys, GTIFDefn& defn) {
    const bool projected = defn.Model == ModelTypeProjected;
    std::string json = "\"model\":" + quote(projected ? "projected" : defn.Model == ModelTypeGeographic ? "geographic" : defn.Model == ModelTypeGeocentric ? "geocentric" : "unknown");
    char* name = nullptr;
    if (projected && defn.PCS != KvUserDefined) {
        GTIFGetPCSInfo(defn.PCS, &name, nullptr, nullptr, nullptr);
        json += ",\"epsg\":" + std::to_string(defn.PCS) + ",\"name\":" + quote(taken(name));
    } else if (!projected && defn.GCS != KvUserDefined) {
        GTIFGetGCSInfo(defn.GCS, &name, nullptr, nullptr, nullptr);
        json += ",\"epsg\":" + std::to_string(defn.GCS) + ",\"name\":" + quote(taken(name));
    } else {
        char citation[256] = "";
        GTIFKeyGetASCII(keys, projected ? PCSCitationGeoKey : GeogCitationGeoKey, citation, sizeof citation);
        if (!*citation) GTIFKeyGetASCII(keys, GTCitationGeoKey, citation, sizeof citation);
        json += ",\"epsg\":null,\"name\":" + quote(*citation ? citation : "user-defined");
    }
    if (projected) {
        std::string projection = "user-defined";
        if (defn.ProjCode != KvUserDefined) {
            GTIFGetProjTRFInfo(defn.ProjCode, &name, nullptr, nullptr);
            projection = taken(name);
        }
        json += ",\"projection\":" + coded(defn.ProjCode, projection);
        json += ",\"method\":" + quote(GTIFValueNameEx(keys, ProjCoordTransGeoKey, defn.CTProjection));
        json += ",\"parameters\":[";
        bool first = true;
        for (int i = 0; i < defn.nParms; i += 1) {
            if (defn.ProjParmId[i] == 0) continue;
            json += std::string(first ? "" : ",") + "[" + quote(GTIFKeyName(static_cast<geokey_t>(defn.ProjParmId[i]))) + "," + number(defn.ProjParm[i]) + "]";
            first = false;
        }
        json += "]";
    }
    GTIFGetGCSInfo(defn.GCS, &name, nullptr, nullptr, nullptr);
    json += ",\"gcs\":" + coded(defn.GCS, taken(name));
    GTIFGetDatumInfo(defn.Datum, &name, nullptr);
    json += ",\"datum\":" + coded(defn.Datum, taken(name));
    GTIFGetEllipsoidInfo(defn.Ellipsoid, &name, nullptr, nullptr);
    json += ",\"ellipsoid\":" + coded(defn.Ellipsoid, taken(name)) + ",\"axes\":" + pair(defn.SemiMajor, defn.SemiMinor);
    GTIFGetPMInfo(defn.PM, &name, nullptr);
    json += ",\"primeMeridian\":" + coded(defn.PM, taken(name)) + ",\"primeMeridianLongitude\":" + number(defn.PMLongToGreenwich);
    if (projected) {
        GTIFGetUOMLengthInfo(defn.UOMLength, &name, nullptr);
        json += ",\"unit\":" + coded(defn.UOMLength, taken(name)) + ",\"metres\":" + number(defn.UOMLengthInMeters);
    } else {
        GTIFGetUOMAngleInfo(defn.UOMAngle, &name, nullptr);
        json += ",\"unit\":" + coded(defn.UOMAngle, taken(name)) + ",\"degrees\":" + number(defn.UOMAngleInDegrees);
    }
    json += ",\"proj\":" + quote(taken(GTIFGetProj4Defn(&defn)));
    return json;
}

// Map coordinates to longitude and latitude on the file's own datum. A geographic file is already
// there; a projected one goes through PROJ.
inline bool toLonLat(GTIFDefn& defn, int count, double* x, double* y) {
    if (defn.Model == ModelTypeGeographic) return true;
    if (defn.Model != ModelTypeProjected) return false;
    return GTIFProj4ToLatLong(&defn, count, x, y) != 0;
}

inline std::string cornersJson(GTIF* keys, GTIFDefn* defn, uint32_t width, uint32_t height) {
    const char* names[5] = {"upper left", "upper right", "lower right", "lower left", "centre"};
    const double columns[5] = {0, static_cast<double>(width), static_cast<double>(width), 0, width / 2.0};
    const double rows[5] = {0, 0, static_cast<double>(height), static_cast<double>(height), height / 2.0};
    std::string json = "[";
    for (int i = 0; i < 5; i += 1) {
        double x = columns[i];
        double y = rows[i];
        if (!GTIFImageToPCS(keys, &x, &y)) return "null";
        double lon = x;
        double lat = y;
        const bool degrees = defn && toLonLat(*defn, 1, &lon, &lat);
        json += std::string(i ? "," : "") + "{\"name\":" + quote(names[i]) + ",\"pixel\":" + pair(columns[i], rows[i]) + ",\"map\":" + pair(x, y) +
                ",\"lonLat\":" + (degrees ? pair(lon, lat) : std::string("null")) + "}";
    }
    return json + "]";
}

// The file's outline in degrees, `steps` points per edge, so a projected rectangle shows its curve.
inline std::string outlineJson(GTIF* keys, GTIFDefn& defn, uint32_t width, uint32_t height, int steps) {
    std::vector<double> x;
    std::vector<double> y;
    const double corners[5][2] = {{0, 0}, {static_cast<double>(width), 0}, {static_cast<double>(width), static_cast<double>(height)}, {0, static_cast<double>(height)}, {0, 0}};
    for (int edge = 0; edge < 4; edge += 1) {
        for (int step = 0; step < steps; step += 1) {
            const double t = static_cast<double>(step) / steps;
            double column = corners[edge][0] + (corners[edge + 1][0] - corners[edge][0]) * t;
            double row = corners[edge][1] + (corners[edge + 1][1] - corners[edge][1]) * t;
            if (!GTIFImageToPCS(keys, &column, &row)) return "null";
            x.push_back(column);
            y.push_back(row);
        }
    }
    if (!toLonLat(defn, static_cast<int>(x.size()), x.data(), y.data())) return "null";
    std::string json = "[";
    for (size_t i = 0; i < x.size(); i += 1) json += std::string(i ? "," : "") + pair(x[i], y[i]);
    return json + "]";
}

inline int appendText(char* message, void* text) {
    static_cast<std::string*>(text)->append(message);
    return 1;
}

// GTIFPrint and GTIFPrintDefnEx: the key dump and the definition listgeo prints.
inline std::string listgeoText(GTIF* keys, GTIFDefn* defn) {
    std::string text;
    GTIFPrint(keys, appendText, &text);
    if (!defn) return text;
    char* buffer = nullptr;
    size_t size = 0;
    FILE* stream = open_memstream(&buffer, &size);
    if (!stream) return text;
    GTIFPrintDefnEx(keys, defn, stream);
    std::fclose(stream);
    text += "\n";
    text.append(buffer, size);
    std::free(buffer);
    return text;
}

// How the pixels are placed: the tags GTIFImageToPCS reads.
inline std::string placementJson(TIFF* tif) {
    uint16_t count = 0;
    double* values = nullptr;
    if (TIFFGetField(tif, TIFFTAG_GEOTRANSMATRIX, &count, &values) && count >= 16) {
        return "\"transform\":\"transformation matrix\",\"pixelSize\":" + pair(std::hypot(values[0], values[4]), std::hypot(values[1], values[5]));
    }
    uint16_t tiepoints = 0;
    double* tie = nullptr;
    TIFFGetField(tif, TIFFTAG_GEOTIEPOINTS, &tiepoints, &tie);
    if (TIFFGetField(tif, TIFFTAG_GEOPIXELSCALE, &count, &values) && count >= 2 && tiepoints >= 6) {
        return "\"transform\":\"tiepoint and pixel scale\",\"pixelSize\":" + pair(values[0], values[1]);
    }
    if (tiepoints >= 6) return "\"transform\":" + quote(std::to_string(tiepoints / 6) + " ground control points") + ",\"pixelSize\":null";
    return "\"transform\":null,\"pixelSize\":null";
}

inline std::string inspect(const std::string& path) {
    Tiff tif = openTiff(path, "r");
    std::string json = "{\"file\":" + fileJson(tif.get(), path);
    Keys keys = openKeys(tif.get());
    int versions[3] = {0, 0, 0};
    int count = 0;
    if (keys) GTIFDirectoryInfo(keys.get(), versions, &count);
    if (!keys || count == 0) return json + ",\"keys\":0,\"georeferenced\":false}";
    json += ",\"keys\":" + std::to_string(count) + ",\"keyRevision\":" + quote(std::to_string(versions[1]) + "." + std::to_string(versions[2]));
    GTIFDefn defn;
    const bool defined = GTIFGetDefn(keys.get(), &defn) != 0;
    uint16_t raster = RasterPixelIsArea;
    GTIFKeyGetSHORT(keys.get(), GTRasterTypeGeoKey, &raster, 0, 1);
    json += ",\"raster\":" + quote(raster == RasterPixelIsPoint ? "pixel is point" : "pixel is area") + "," + placementJson(tif.get());
    if (defined) json += "," + definitionJson(keys.get(), defn);
    uint32_t width = 0;
    uint32_t height = 0;
    TIFFGetField(tif.get(), TIFFTAG_IMAGEWIDTH, &width);
    TIFFGetField(tif.get(), TIFFTAG_IMAGELENGTH, &height);
    const std::string corners = cornersJson(keys.get(), defined ? &defn : nullptr, width, height);
    json += ",\"georeferenced\":" + std::string(corners == "null" ? "false" : "true") + ",\"corners\":" + corners;
    json += ",\"outline\":" + (defined && corners != "null" ? outlineJson(keys.get(), defn, width, height, 16) : std::string("null"));
    json += ",\"listgeo\":" + quote(listgeoText(keys.get(), defined ? &defn : nullptr)) + "}";
    return json;
}

// A GeoTIFF placed by a tiepoint at its upper-left corner and a pixel size, in the EPSG system
// `epsg`, which may be projected or geographic. Pixels are RGBA rows; a picture without any
// transparency is written as RGB.
struct Picture {
    const std::string* rgba;
    int width;
    int height;
};

inline bool opaque(const Picture& picture) {
    for (size_t i = 3; i < picture.rgba->size(); i += 4) {
        if (static_cast<unsigned char>((*picture.rgba)[i]) != 255) return false;
    }
    return true;
}

inline unsigned compressionCode(const std::string& name) {
    if (name == "none") return COMPRESSION_NONE;
    if (name == "deflate") return COMPRESSION_ADOBE_DEFLATE;
    if (name == "lzw") return COMPRESSION_LZW;
    if (name == "zstd") return COMPRESSION_ZSTD;
    if (name == "jpeg") return COMPRESSION_JPEG;
    throw std::invalid_argument("unknown compression " + name);
}

inline std::string writeGeoTiff(const Picture& picture, int epsg, double originX, double originY, double pixelWidth, double pixelHeight,
                                const std::string& compression, int quality, const std::string& citation, const std::string& path) {
    if (picture.width < 1 || picture.height < 1 || picture.rgba->size() != static_cast<size_t>(picture.width) * picture.height * 4) {
        throw std::invalid_argument("the picture must hold width * height * 4 bytes of RGBA");
    }
    if (!(pixelWidth > 0) || !(pixelHeight > 0) || !std::isfinite(originX) || !std::isfinite(originY)) {
        throw std::invalid_argument("the pixel size must be above zero and the corner a finite position");
    }
    if (epsg < 1024 || epsg > 32766) throw std::invalid_argument("GeoKeys hold EPSG codes from 1024 to 32766");
    const unsigned codec = compressionCode(compression);
    if (!TIFFIsCODECConfigured(codec)) throw std::runtime_error("this libtiff build has no " + compression + " codec");
    char* name = nullptr;
    bool projected = GTIFGetPCSInfo(epsg, &name, nullptr, nullptr, nullptr) != 0;
    if (!projected && !GTIFGetGCSInfo(epsg, &name, nullptr, nullptr, nullptr)) {
        throw std::invalid_argument("EPSG:" + std::to_string(epsg) + " is neither a projected nor a geographic system in PROJ's database");
    }
    const std::string crs = taken(name);

    const bool alpha = !opaque(picture);
    const int bands = alpha ? 4 : 3;
    Tiff tif = openTiff(path, "w");
    TIFFSetField(tif.get(), TIFFTAG_IMAGEWIDTH, picture.width);
    TIFFSetField(tif.get(), TIFFTAG_IMAGELENGTH, picture.height);
    TIFFSetField(tif.get(), TIFFTAG_BITSPERSAMPLE, 8);
    TIFFSetField(tif.get(), TIFFTAG_SAMPLESPERPIXEL, bands);
    TIFFSetField(tif.get(), TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
    TIFFSetField(tif.get(), TIFFTAG_COMPRESSION, codec);
    if (alpha) {
        const uint16_t extra[1] = {EXTRASAMPLE_UNASSALPHA};
        TIFFSetField(tif.get(), TIFFTAG_EXTRASAMPLES, 1, extra);
    }
    if (codec == COMPRESSION_JPEG && !alpha) {
        TIFFSetField(tif.get(), TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_YCBCR);
        TIFFSetField(tif.get(), TIFFTAG_JPEGCOLORMODE, JPEGCOLORMODE_RGB);
    } else {
        TIFFSetField(tif.get(), TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB);
    }
    if (codec == COMPRESSION_JPEG) TIFFSetField(tif.get(), TIFFTAG_JPEGQUALITY, quality);
    if (codec == COMPRESSION_ADOBE_DEFLATE || codec == COMPRESSION_LZW || codec == COMPRESSION_ZSTD) TIFFSetField(tif.get(), TIFFTAG_PREDICTOR, PREDICTOR_HORIZONTAL);
    TIFFSetField(tif.get(), TIFFTAG_ROWSPERSTRIP, 16);
    const double tiepoint[6] = {0, 0, 0, originX, originY, 0};
    const double scale[3] = {pixelWidth, pixelHeight, 0};
    TIFFSetField(tif.get(), TIFFTAG_GEOTIEPOINTS, 6, tiepoint);
    TIFFSetField(tif.get(), TIFFTAG_GEOPIXELSCALE, 3, scale);

    Keys keys = openKeys(tif.get());
    if (!keys) fail("libgeotiff could not start the GeoKeys");
    GTIFKeySet(keys.get(), GTModelTypeGeoKey, TYPE_SHORT, 1, projected ? ModelTypeProjected : ModelTypeGeographic);
    GTIFKeySet(keys.get(), GTRasterTypeGeoKey, TYPE_SHORT, 1, RasterPixelIsArea);
    GTIFKeySet(keys.get(), GTCitationGeoKey, TYPE_ASCII, 0, citation.c_str());
    if (projected) {
        GTIFKeySet(keys.get(), ProjectedCSTypeGeoKey, TYPE_SHORT, 1, epsg);
    } else {
        GTIFKeySet(keys.get(), GeographicTypeGeoKey, TYPE_SHORT, 1, epsg);
        GTIFKeySet(keys.get(), GeogAngularUnitsGeoKey, TYPE_SHORT, 1, Angular_Degree);
    }
    if (!GTIFWriteKeys(keys.get())) fail("libgeotiff could not write the GeoKeys");
    keys.reset();

    std::vector<unsigned char> row(static_cast<size_t>(picture.width) * bands);
    for (int y = 0; y < picture.height; y += 1) {
        const unsigned char* source = reinterpret_cast<const unsigned char*>(picture.rgba->data()) + static_cast<size_t>(y) * picture.width * 4;
        for (int x = 0; x < picture.width; x += 1) {
            for (int band = 0; band < bands; band += 1) row[static_cast<size_t>(x) * bands + band] = source[x * 4 + band];
        }
        if (TIFFWriteScanline(tif.get(), row.data(), y, 0) < 0) fail("libtiff could not write row " + std::to_string(y));
    }
    tif.reset();
    return "{\"bytes\":" + number(fileSize(path)) + ",\"bands\":" + std::to_string(bands) + ",\"alpha\":" + (alpha ? "true" : "false") +
           ",\"model\":" + quote(projected ? "projected" : "geographic") + ",\"epsg\":" + std::to_string(epsg) + ",\"name\":" + quote(crs) + "}";
}

inline std::string readFile(const std::string& path) {
    std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "rb"), std::fclose);
    if (!file) throw std::runtime_error("cannot open " + path);
    std::string bytes;
    std::vector<char> buffer(1 << 16);  // on the heap: the stack is only 64 KB
    size_t read = 0;
    while ((read = std::fread(buffer.data(), 1, buffer.size(), file.get())) > 0) bytes.append(buffer.data(), read);
    return bytes;
}

// The inspector's samples: blank pixels, real placements.
struct Sample {
    const char* id;
    int epsg;
    int width;
    int height;
    double x;
    double y;
    double pixel;
    const char* citation;
};

inline const Sample* findSample(const std::string& id) {
    static const Sample samples[] = {
        {"istanbul", 32635, 1830, 1830, 600000, 4600020, 60, "A Sentinel-2-sized tile over Istanbul, 60 m pixels"},
        {"london", 27700, 1000, 1000, 530000, 190000, 10, "Ordnance Survey 10 km square TQ38, 10 m pixels"},
        {"conus", 5070, 1612, 1045, -2493045, 3310005, 3000, "The contiguous United States in Conus Albers, 3 km pixels"},
        {"world", 4326, 360, 180, -180, 90, 1, "The whole world, 1 degree pixels"},
    };
    for (const Sample& sample : samples) {
        if (id == sample.id) return &sample;
    }
    return nullptr;
}

inline double writeSample(const std::string& id, const std::string& path) {
    const Sample* sample = findSample(id);
    if (!sample) throw std::invalid_argument("no sample called " + id);
    const std::string blank(static_cast<size_t>(sample->width) * sample->height * 4, '\xff');
    writeGeoTiff(Picture{&blank, sample->width, sample->height}, sample->epsg, sample->x, sample->y, sample->pixel, sample->pixel, "deflate", 0, sample->citation, path);
    return fileSize(path);
}

}  // namespace geotiffapp
