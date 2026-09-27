#pragma once

#include <geos_c.h>

#include <memory>
#include <stdexcept>
#include <string>

// Measurements in the plane, in the units of the coordinates: metres for most projected data.
// GEOS does not measure on the ellipsoid, so longitude and latitude need projecting first.
class Measure {
public:
    static double area(const std::string& wkt) { return measure(GEOSArea_r, wkt); }

    // A line's length or a polygon's perimeter. Not named length: every JavaScript function, a
    // bound class included, already has a length property, and a static method cannot replace it.
    static double lengthOf(const std::string& wkt) { return measure(GEOSLength_r, wkt); }

    static double distance(const std::string& a, const std::string& b) {
        Session geos;
        const auto left = geos.read(a);
        const auto right = geos.read(b);
        double value = 0;
        if (!GEOSDistance_r(geos.context, left.get(), right.get(), &value)) geos.fail();
        return value;
    }

    // The shortest line between the two shapes, from its end on a to its end on b.
    static std::string nearestPoints(const std::string& a, const std::string& b) {
        Session geos;
        const auto left = geos.read(a);
        const auto right = geos.read(b);
        GEOSCoordSequence* ends = GEOSNearestPoints_r(geos.context, left.get(), right.get());
        if (!ends) geos.fail();
        return geos.write(geos.own(GEOSGeom_createLineString_r(geos.context, ends)).get());
    }

    static std::string centroid(const std::string& wkt) {
        Session geos;
        return geos.result(GEOSGetCentroid_r(geos.context, geos.read(wkt).get()));
    }

private:
    using Metric = int (*)(GEOSContextHandle_t, const GEOSGeometry*, double*);

    static double measure(Metric metric, const std::string& wkt) {
        Session geos;
        double value = 0;
        if (!metric(geos.context, geos.read(wkt).get(), &value)) geos.fail();
        return value;
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
