#pragma once

#include <geos_c.h>

#include <memory>
#include <stdexcept>
#include <string>

// A polygon prepared once and then asked about many points: GEOSPrepare_r indexes its edges on the
// first question, so the later ones do not walk every edge again.
class Zone {
public:
    explicit Zone(const std::string& wkt) : shape(geos.read(wkt)), prepared(GEOSPrepare_r(geos.context, shape.get())) {
        if (!prepared) geos.fail();
    }
    ~Zone() { GEOSPreparedGeom_destroy_r(geos.context, prepared); }
    Zone(const Zone&) = delete;
    Zone& operator=(const Zone&) = delete;

    // Strictly inside: a point on the boundary is not contained.
    bool contains(double x, double y) { return answer(GEOSPreparedContainsXY_r(geos.context, prepared, x, y)); }

    // Inside or on the boundary.
    bool intersects(double x, double y) { return answer(GEOSPreparedIntersectsXY_r(geos.context, prepared, x, y)); }

    // The DE-9IM matrix: the dimension where the interior, boundary and exterior of this shape meet
    // those of the other, row by row.
    std::string relate(const std::string& wkt) {
        char* matrix = GEOSPreparedRelate_r(geos.context, prepared, geos.read(wkt).get());
        if (!matrix) geos.fail();
        const std::string text = matrix;
        GEOSFree_r(geos.context, matrix);
        return text;
    }

private:
    bool answer(char result) {
        if (result == 2) geos.fail();
        return result == 1;
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

    Session geos;
    Session::Geometry shape;
    const GEOSPreparedGeometry* prepared;
};
