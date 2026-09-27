#pragma once

#include <geos_c.h>

#include <memory>
#include <stdexcept>
#include <string>

// Overlay of two geometries written as WKT. Every result is normalised, so the same shape always
// prints the same WKT whatever order its vertices came in.
class Overlay {
public:
    static std::string version() { return GEOSversion(); }

    static std::string intersection(const std::string& a, const std::string& b) { return apply(GEOSIntersection_r, a, b); }
    static std::string unite(const std::string& a, const std::string& b) { return apply(GEOSUnion_r, a, b); }
    static std::string difference(const std::string& a, const std::string& b) { return apply(GEOSDifference_r, a, b); }

    static double area(const std::string& wkt) {
        Session geos;
        double value = 0;
        if (!GEOSArea_r(geos.context, geos.read(wkt).get(), &value)) geos.fail();
        return value;
    }

private:
    using Operation = GEOSGeometry* (*)(GEOSContextHandle_t, const GEOSGeometry*, const GEOSGeometry*);

    static std::string apply(Operation operation, const std::string& a, const std::string& b) {
        Session geos;
        const auto left = geos.read(a);
        const auto right = geos.read(b);
        return geos.result(operation(geos.context, left.get(), right.get()));
    }

    // GEOS's reentrant C API: each call gets its own context, which also holds the last error message.
    struct Session {
        struct Destroy {
            GEOSContextHandle_t context;
            void operator()(GEOSGeometry* geometry) const { GEOSGeom_destroy_r(context, geometry); }
        };
        using Geometry = std::unique_ptr<GEOSGeometry, Destroy>;

        GEOSContextHandle_t context = GEOS_init_r();
        std::string error;

        Session() { GEOSContext_setErrorMessageHandler_r(context, remember, &error); }
        ~Session() { GEOS_finish_r(context); }
        Session(const Session&) = delete;
        Session& operator=(const Session&) = delete;

        Geometry own(GEOSGeometry* geometry) {
            if (!geometry) fail();
            return Geometry(geometry, Destroy{context});
        }

        Geometry read(const std::string& wkt) {
            GEOSWKTReader* reader = GEOSWKTReader_create_r(context);
            GEOSGeometry* geometry = GEOSWKTReader_read_r(context, reader, wkt.c_str());
            GEOSWKTReader_destroy_r(context, reader);
            return own(geometry);
        }

        std::string write(const GEOSGeometry* geometry) {
            GEOSWKTWriter* writer = GEOSWKTWriter_create_r(context);
            char* text = GEOSWKTWriter_write_r(context, writer, geometry);
            GEOSWKTWriter_destroy_r(context, writer);
            if (!text) fail();
            const std::string wkt = text;
            GEOSFree_r(context, text);
            return wkt;
        }

        // Takes ownership of a result and writes it normalised.
        std::string result(GEOSGeometry* geometry) {
            const Geometry owned = own(geometry);
            if (GEOSNormalize_r(context, owned.get()) != 0) fail();
            return write(owned.get());
        }

        [[noreturn]] void fail() const { throw std::runtime_error(error.empty() ? "GEOS operation failed" : error); }

        static void remember(const char* message, void* error) { *static_cast<std::string*>(error) = message; }
    };
};
