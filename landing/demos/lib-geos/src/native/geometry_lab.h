#pragma once

#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "../support/geos_session.h"

// The Geometry lab on crossbind.dev/ports/geos/: fifteen GEOS operations on two shapes, A and B,
// written as WKT. Each result comes back described as JSON, with GeoJSON the page draws.
class GeometryLab {
public:
    std::string version() const { return GEOSversion(); }

    // {"type","wkt","geojson","area","length","points","parts","valid","empty"}
    std::string describe(const std::string& wkt) {
        const auto geometry = geos.read(wkt);
        return geos.describe(geometry.get());
    }

    // `b` may be empty for the operations on A alone. `parameter` is the operation's distance,
    // tolerance or ratio.
    std::string run(const std::string& operation, const std::string& a, const std::string& b, double parameter) {
        const auto first = geos.read(a);
        const auto second = b.empty() ? geos.own(GEOSGeom_createEmptyCollection_r(geos.context, GEOS_GEOMETRYCOLLECTION)) : geos.read(b);
        auto result = geos.own(apply(operation, first.get(), second.get(), parameter));
        // The inscribed circle comes back as the radius line from its centre; normalising could reverse it.
        if (operation != "maximumInscribedCircle") geos.normalize(result.get());
        return geos.describe(result.get());
    }

    // {"matrix":"212101212","intersects":true,...}: the DE-9IM matrix and the named predicates.
    std::string relate(const std::string& a, const std::string& b) {
        const auto first = geos.read(a);
        const auto second = geos.read(b);
        char* matrix = GEOSRelate_r(geos.context, first.get(), second.get());
        if (!matrix) geos.fail("GEOS could not relate the two shapes");
        std::string json = "{\"matrix\":" + geosapp::quote(matrix);
        GEOSFree_r(geos.context, matrix);
        using Predicate = char (*)(GEOSContextHandle_t, const GEOSGeometry*, const GEOSGeometry*);
        const std::pair<const char*, Predicate> predicates[] = {
            {"intersects", GEOSIntersects_r}, {"disjoint", GEOSDisjoint_r}, {"touches", GEOSTouches_r}, {"crosses", GEOSCrosses_r},
            {"within", GEOSWithin_r},         {"contains", GEOSContains_r}, {"overlaps", GEOSOverlaps_r}, {"equals", GEOSEquals_r},
            {"covers", GEOSCovers_r},         {"coveredBy", GEOSCoveredBy_r},
        };
        for (const auto& predicate : predicates) {
            json += ",\"" + std::string(predicate.first) + "\":" + geosapp::boolean(geos.answer(predicate.second(geos.context, first.get(), second.get())));
        }
        return json + "}";
    }

private:
    GEOSGeometry* apply(const std::string& operation, const GEOSGeometry* a, const GEOSGeometry* b, double parameter) {
        GEOSContextHandle_t context = geos.context;
        if (operation == "intersection") return GEOSIntersection_r(context, a, b);
        if (operation == "union") return GEOSUnion_r(context, a, b);
        if (operation == "difference") return GEOSDifference_r(context, a, b);
        if (operation == "symDifference") return GEOSSymDifference_r(context, a, b);
        if (operation == "buffer") return GEOSBuffer_r(context, a, parameter, 8);
        if (operation == "offsetCurve") return GEOSOffsetCurve_r(context, a, parameter, 8, GEOSBUF_JOIN_ROUND, 5.0);
        if (operation == "makeValid") return GEOSMakeValid_r(context, a);
        if (operation == "simplify") return GEOSTopologyPreserveSimplify_r(context, a, parameter);
        if (operation == "constrainedDelaunay") return GEOSConstrainedDelaunayTriangulation_r(context, a);
        if (operation == "maximumInscribedCircle") return GEOSMaximumInscribedCircle_r(context, a, parameter);
        // The rest work on A and B together.
        const auto both = together(a, b);
        if (operation == "convexHull") return GEOSConvexHull_r(context, both.get());
        if (operation == "concaveHull") return GEOSConcaveHull_r(context, both.get(), parameter, 0);
        if (operation == "voronoi") return GEOSVoronoiDiagram_r(context, both.get(), nullptr, 0, 0);
        if (operation == "delaunay") return GEOSDelaunayTriangulation_r(context, both.get(), 0, 0);
        if (operation == "minimumRotatedRectangle") return GEOSMinimumRotatedRectangle_r(context, both.get());
        throw std::invalid_argument("unknown operation " + operation);
    }

    geosapp::Session::Geometry together(const GEOSGeometry* a, const GEOSGeometry* b) {
        std::vector<geosapp::Session::Geometry> parts;
        parts.push_back(geos.clone(a));
        if (!geos.empty(b)) parts.push_back(geos.clone(b));
        return geos.collect(GEOS_GEOMETRYCOLLECTION, std::move(parts));
    }

    geosapp::Session geos;
};
