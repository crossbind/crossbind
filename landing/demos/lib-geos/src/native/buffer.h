#pragma once

#include <geos_c.h>

#include <memory>
#include <stdexcept>
#include <string>

// Buffers grow a shape by a distance, or shrink it with a negative one; an offset curve runs parallel
// to a line. Curves become straight segments: quadrantSegments of them for each quarter circle.
class BufferOp {
public:
    static std::string around(const std::string& wkt, double distance, int quadrantSegments) {
        Session geos;
        return geos.result(GEOSBuffer_r(geos.context, geos.read(wkt).get(), distance, quadrantSegments));
    }

    // cap: "round", "flat" or "square"; join: "round", "mitre" or "bevel".
    static std::string withStyle(const std::string& wkt, double distance, const std::string& cap, const std::string& join) {
        Session geos;
        const auto geometry = geos.read(wkt);
        return geos.result(GEOSBufferWithStyle_r(geos.context, geometry.get(), distance, 8, capStyle(cap), joinStyle(join), 5.0));
    }

    // A positive distance offsets to the left of the line's direction, a negative one to the right.
    static std::string offsetCurve(const std::string& wkt, double distance) {
        Session geos;
        return geos.result(GEOSOffsetCurve_r(geos.context, geos.read(wkt).get(), distance, 8, GEOSBUF_JOIN_ROUND, 5.0));
    }

private:
    static int capStyle(const std::string& name) {
        if (name == "round") return GEOSBUF_CAP_ROUND;
        if (name == "flat") return GEOSBUF_CAP_FLAT;
        if (name == "square") return GEOSBUF_CAP_SQUARE;
        throw std::invalid_argument("cap must be round, flat or square");
    }

    static int joinStyle(const std::string& name) {
        if (name == "round") return GEOSBUF_JOIN_ROUND;
        if (name == "mitre") return GEOSBUF_JOIN_MITRE;
        if (name == "bevel") return GEOSBUF_JOIN_BEVEL;
        throw std::invalid_argument("join must be round, mitre or bevel");
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
