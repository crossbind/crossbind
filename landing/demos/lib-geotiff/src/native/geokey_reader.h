#pragma once

#include <geotiff.h>
#include <tiffio.hxx>
#include <xtiffio.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>

// Reads a GeoTIFF's GeoKeys one at a time, as GDAL and most readers do: GTIFKeyInfo says whether a
// key is set and what type it has, GTIFKeyGet copies its value out. The tiepoint and the pixel
// scale are plain TIFF tags next to the keys.
class GeoKeyReader {
public:
    // JSON: the key directory's version, every common key the file sets, and the two tags.
    static std::string read(const std::u16string& tiff) {
        std::istringstream in(std::string(tiff.begin(), tiff.end()));
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("input.tif", &in), XTIFFClose);
        if (!tif) throw std::runtime_error("not a TIFF file");
        Keys gtif(GTIFNew(tif.get()), GTIFFree);
        if (!gtif) throw std::runtime_error("libgeotiff could not read the GeoKeys");

        int versions[3] = {0, 0, 0};  // directory version, key revision, minor revision
        int count = 0;
        GTIFDirectoryInfo(gtif.get(), versions, &count);
        char head[96];
        std::snprintf(head, sizeof head, "{\"version\":%d,\"revision\":\"%d.%d\",\"count\":%d,\"keys\":[", versions[0], versions[1], versions[2], count);
        std::string json = head;
        const geokey_t common[] = {GTModelTypeGeoKey,    GTRasterTypeGeoKey,     GTCitationGeoKey,      GeographicTypeGeoKey,
                                   GeogCitationGeoKey,   GeogAngularUnitsGeoKey, ProjectedCSTypeGeoKey, PCSCitationGeoKey,
                                   ProjLinearUnitsGeoKey, VerticalCSTypeGeoKey,  VerticalUnitsGeoKey};
        for (const geokey_t key : common) {
            const std::string entry = describe(gtif.get(), key);
            if (entry.empty()) continue;
            if (json.back() != '[') json += ',';
            json += entry;
        }
        json += "],\"tiepoint\":" + doubles(tif.get(), TIFFTAG_GEOTIEPOINTS) + ",\"pixelScale\":" + doubles(tif.get(), TIFFTAG_GEOPIXELSCALE) + "}";
        return json;
    }

private:
    using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
    using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;

    // One key as JSON, or an empty string when the file does not set it. A SHORT key also gets the
    // name of its value, from libgeotiff's tables or PROJ's database.
    static std::string describe(GTIF* gtif, geokey_t key) {
        int size = 0;
        tagtype_t type = TYPE_UNKNOWN;
        const int count = GTIFKeyInfo(gtif, key, &size, &type);
        if (count == 0) return "";
        std::string entry = "{\"key\":\"" + std::string(GTIFKeyName(key)) + "\",\"type\":\"" + GTIFTypeName(type) + "\",\"value\":";
        if (type == TYPE_ASCII) {
            std::string text(count + 1, '\0');
            GTIFKeyGetASCII(gtif, key, text.data(), count + 1);
            text.resize(std::strlen(text.c_str()));
            entry += quoted(text);
        } else if (type == TYPE_SHORT) {
            unsigned short value = 0;
            GTIFKeyGetSHORT(gtif, key, &value, 0, 1);
            entry += std::to_string(value) + ",\"name\":" + quoted(GTIFValueNameEx(gtif, key, value));
        } else {
            double value = 0;
            GTIFKeyGetDOUBLE(gtif, key, &value, 0, 1);
            entry += number(value);
        }
        return entry + "}";
    }

    // A TIFF tag of doubles as a JSON array; libgeotiff registers the GeoTIFF tags with a count.
    static std::string doubles(TIFF* tif, uint32_t tag) {
        uint16_t count = 0;
        double* values = nullptr;
        if (!TIFFGetField(tif, tag, &count, &values)) return "null";
        std::string json = "[";
        for (uint16_t i = 0; i < count; i += 1) json += (i ? "," : "") + number(values[i]);
        return json + "]";
    }

    static std::string number(double value) {
        char text[32];
        std::snprintf(text, sizeof text, "%.17g", value);
        return text;
    }

    static std::string quoted(const std::string& text) {
        std::string out = "\"";
        for (const char c : text) {
            if (c == '"' || c == '\\') out += '\\';
            out += static_cast<unsigned char>(c) < 0x20 ? ' ' : c;
        }
        return out + "\"";
    }
};
