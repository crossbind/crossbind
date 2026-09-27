#pragma once

#include <geos_c.h>

#include <memory>
#include <stdexcept>
#include <string>

// OGC validity: whether a shape is valid, what is wrong and where if it is not, and a repair.
class Validity {
public:
    static bool isValid(const std::string& wkt) {
        Session geos;
        const char valid = GEOSisValid_r(geos.context, geos.read(wkt).get());
        if (valid == 2) geos.fail();
        return valid == 1;
    }

    // "Valid Geometry", or the problem and its location, such as "Self-intersection[5 5]".
    static std::string reason(const std::string& wkt) {
        Session geos;
        char* text = GEOSisValidReason_r(geos.context, geos.read(wkt).get());
        if (!text) geos.fail();
        const std::string reason = text;
        GEOSFree_r(geos.context, text);
        return reason;
    }

    // "linework" rebuilds the shape from all of its noded edges; "structure" repairs each ring,
    // then keeps shells as shells and subtracts the holes from them.
    static std::string makeValid(const std::string& wkt, const std::string& method) {
        if (method != "linework" && method != "structure") throw std::invalid_argument("method must be linework or structure");
        Session geos;
        const auto geometry = geos.read(wkt);
        GEOSMakeValidParams* params = GEOSMakeValidParams_create_r(geos.context);
        GEOSMakeValidParams_setMethod_r(geos.context, params, method == "structure" ? GEOS_MAKE_VALID_STRUCTURE : GEOS_MAKE_VALID_LINEWORK);
        GEOSGeometry* repaired = GEOSMakeValidWithParams_r(geos.context, geometry.get(), params);
        GEOSMakeValidParams_destroy_r(geos.context, params);
        return geos.result(repaired);
    }

private:
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
