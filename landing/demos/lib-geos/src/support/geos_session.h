#pragma once

#include <geos_c.h>

#include <cmath>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// What the app wrappers share: one GEOS context per wrapper object, geometries owned by
// unique_ptr, WKT in, WKT and GeoJSON out, and the JSON the pages read.
namespace geosapp {

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
        } else if (character < 0x20) {
            char escaped[8];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", character);
            out += escaped;
        } else {
            out += static_cast<char>(character);
        }
    }
    return out + "\"";
}

inline std::string boolean(bool value) { return value ? "true" : "false"; }

class Session {
public:
    struct Destroy {
        GEOSContextHandle_t context;
        void operator()(GEOSGeometry* geometry) const { GEOSGeom_destroy_r(context, geometry); }
    };
    using Geometry = std::unique_ptr<GEOSGeometry, Destroy>;

    Session() : context(GEOS_init_r()) {
        GEOSContext_setErrorMessageHandler_r(context, remember, &error);
        reader = GEOSWKTReader_create_r(context);
        writer = GEOSWKTWriter_create_r(context);
        json = GEOSGeoJSONWriter_create_r(context);
    }

    ~Session() {
        GEOSGeoJSONWriter_destroy_r(context, json);
        GEOSWKTWriter_destroy_r(context, writer);
        GEOSWKTReader_destroy_r(context, reader);
        GEOS_finish_r(context);
    }

    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    GEOSContextHandle_t context;

    Geometry own(GEOSGeometry* geometry) {
        if (!geometry) fail("GEOS returned no geometry");
        return Geometry(geometry, Destroy{context});
    }

    Geometry read(const std::string& wkt) {
        GEOSGeometry* geometry = GEOSWKTReader_read_r(context, reader, wkt.c_str());
        if (!geometry) fail("not a WKT geometry");
        return own(geometry);
    }

    Geometry clone(const GEOSGeometry* geometry) { return own(GEOSGeom_clone_r(context, geometry)); }

    // A collection that takes ownership of every part.
    Geometry collect(int type, std::vector<Geometry> parts) {
        std::vector<GEOSGeometry*> raw;
        for (Geometry& part : parts) raw.push_back(part.get());
        GEOSGeometry* collection = GEOSGeom_createCollection_r(context, type, raw.data(), static_cast<unsigned>(raw.size()));
        if (!collection) fail("GEOS could not build the collection");
        for (Geometry& part : parts) part.release();
        return own(collection);
    }

    void normalize(GEOSGeometry* geometry) {
        if (GEOSNormalize_r(context, geometry) != 0) fail("GEOS could not normalise the geometry");
    }

    std::string wkt(const GEOSGeometry* geometry) { return take(GEOSWKTWriter_write_r(context, writer, geometry)); }
    std::string geojson(const GEOSGeometry* geometry) { return take(GEOSGeoJSONWriter_writeGeometry_r(context, json, geometry, -1)); }

    double area(const GEOSGeometry* geometry) { return metric(GEOSArea_r, geometry); }
    double length(const GEOSGeometry* geometry) { return metric(GEOSLength_r, geometry); }
    int points(const GEOSGeometry* geometry) { return GEOSGetNumCoordinates_r(context, geometry); }
    int parts(const GEOSGeometry* geometry) { return GEOSGetNumGeometries_r(context, geometry); }
    bool empty(const GEOSGeometry* geometry) { return answer(GEOSisEmpty_r(context, geometry)); }
    bool valid(const GEOSGeometry* geometry) { return answer(GEOSisValid_r(context, geometry)); }
    std::string type(const GEOSGeometry* geometry) { return take(GEOSGeomType_r(context, geometry)); }

    // {"type","wkt","geojson","area","length","points","parts","valid","empty"}
    std::string describe(const GEOSGeometry* geometry) {
        return "{\"type\":" + quote(type(geometry)) + ",\"wkt\":" + quote(wkt(geometry)) + ",\"geojson\":" + geojson(geometry) +
               ",\"area\":" + number(area(geometry)) + ",\"length\":" + number(length(geometry)) + ",\"points\":" + std::to_string(points(geometry)) +
               ",\"parts\":" + std::to_string(parts(geometry)) + ",\"valid\":" + boolean(valid(geometry)) + ",\"empty\":" + boolean(empty(geometry)) + "}";
    }

    bool answer(char result) {
        if (result == 2) fail("GEOS could not evaluate the predicate");
        return result == 1;
    }

    // Throws GEOS's own message when it left one, and clears it for the next call.
    [[noreturn]] void fail(const char* fallback) {
        const std::string message = error.empty() ? fallback : error;
        error.clear();
        throw std::runtime_error(message);
    }

private:
    using Metric = int (*)(GEOSContextHandle_t, const GEOSGeometry*, double*);

    double metric(Metric measure, const GEOSGeometry* geometry) {
        double value = 0;
        if (!measure(context, geometry, &value)) fail("GEOS could not measure the geometry");
        return value;
    }

    std::string take(char* text) {
        if (!text) fail("GEOS could not write the geometry");
        const std::string copy = text;
        GEOSFree_r(context, text);
        return copy;
    }

    static void remember(const char* message, void* error) { *static_cast<std::string*>(error) = message; }

    std::string error;
    GEOSWKTReader* reader = nullptr;
    GEOSWKTWriter* writer = nullptr;
    GEOSGeoJSONWriter* json = nullptr;
};

}  // namespace geosapp
