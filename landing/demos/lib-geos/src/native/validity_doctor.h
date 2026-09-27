#pragma once

#include <stdexcept>
#include <string>

#include "../support/geos_session.h"

// The Validity doctor on crossbind.dev/ports/geos/: what is wrong with a shape and where, and what
// each of GEOS's two repair methods makes of it.
class ValidityDoctor {
public:
    // {"valid","reason","location":[x,y]|null,"shape":{...}}. allowSelfTouchingHoles accepts a ring
    // that touches itself to enclose a hole, which ESRI's model allows and OGC's does not.
    std::string check(const std::string& wkt, bool allowSelfTouchingHoles) {
        const auto geometry = geos.read(wkt);
        char* reason = nullptr;
        GEOSGeometry* location = nullptr;
        const int flags = allowSelfTouchingHoles ? GEOSVALID_ALLOW_SELFTOUCHING_RING_FORMING_HOLE : 0;
        const char valid = GEOSisValidDetail_r(geos.context, geometry.get(), flags, &reason, &location);
        if (valid == 2) geos.fail("GEOS could not check the shape");
        std::string json = "{\"valid\":" + geosapp::boolean(valid == 1) + ",\"reason\":" + (reason ? geosapp::quote(reason) : std::string("null"));
        if (reason) GEOSFree_r(geos.context, reason);
        json += ",\"location\":";
        if (location) {
            const auto point = geos.own(location);
            double x = 0;
            double y = 0;
            GEOSGeomGetX_r(geos.context, point.get(), &x);
            GEOSGeomGetY_r(geos.context, point.get(), &y);
            json += "[" + geosapp::number(x) + "," + geosapp::number(y) + "]";
        } else {
            json += "null";
        }
        return json + ",\"shape\":" + geos.describe(geometry.get()) + "}";
    }

    // The repaired shape, described like GeometryLab::describe. "linework" rebuilds the shape from
    // all of its noded edges; "structure" repairs each ring, keeps shells as shells and holes as
    // holes, then subtracts the holes. keepCollapsed keeps what the structure method would drop
    // for having collapsed into a line or a point.
    std::string repair(const std::string& wkt, const std::string& method, bool keepCollapsed) {
        if (method != "linework" && method != "structure") throw std::invalid_argument("method must be linework or structure");
        const auto geometry = geos.read(wkt);
        GEOSMakeValidParams* params = GEOSMakeValidParams_create_r(geos.context);
        GEOSMakeValidParams_setMethod_r(geos.context, params, method == "structure" ? GEOS_MAKE_VALID_STRUCTURE : GEOS_MAKE_VALID_LINEWORK);
        GEOSMakeValidParams_setKeepCollapsed_r(geos.context, params, keepCollapsed ? 1 : 0);
        GEOSGeometry* repaired = GEOSMakeValidWithParams_r(geos.context, geometry.get(), params);
        GEOSMakeValidParams_destroy_r(geos.context, params);
        auto result = geos.own(repaired);
        geos.normalize(result.get());
        return geos.describe(result.get());
    }

private:
    geosapp::Session geos;
};
