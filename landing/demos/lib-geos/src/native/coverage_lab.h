#pragma once

#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "../support/coverage_map.h"
#include "../support/geos_session.h"

// The Coverage simplifier on crossbind.dev/ports/geos/: a map of neighbouring regions simplified two
// ways at the same tolerance. One region at a time (GEOSTopologyPreserveSimplify_r on each), every
// shared border is simplified twice, differently, and gaps and overlaps open between neighbours. As
// one coverage (GEOSCoverageSimplifyVW_r), each border is simplified once and stays shared.
class CoverageLab {
public:
    explicit CoverageLab(int cellsPerSide) {
        if (cellsPerSide < 2 || cellsPerSide > 12) throw std::invalid_argument("cellsPerSide must be between 2 and 12");
        rings = coveragemap::regions(cellsPerSide);
        std::vector<geosapp::Session::Geometry> parts;
        for (const coveragemap::Ring& ring : rings) parts.push_back(geos.read(coveragemap::wkt(ring)));
        map = geos.collect(GEOS_GEOMETRYCOLLECTION, std::move(parts));
        square = geos.read("POLYGON ((0 0, 100 0, 100 100, 0 100, 0 0))");
    }

    // {"regions","vertices","area","coverageValid","regionsGeojson":[...]} of the generated map.
    std::string original() {
        return "{\"regions\":" + std::to_string(geos.parts(map.get())) + ",\"vertices\":" + std::to_string(geos.points(map.get())) +
               ",\"area\":" + geosapp::number(geos.area(map.get())) + ",\"coverageValid\":" + geosapp::boolean(coverageValid(map.get())) +
               ",\"regionsGeojson\":" + geojsonList(map.get()) + "}";
    }

    // "%.17g %.17g\n" for every vertex, region by region: the page hashes it to show that it built
    // the same map as the Python reference behind the expected numbers.
    std::string vertexText() const { return coveragemap::vertexText(rings); }

    // {"tolerance","separately":{...},"coverage":{...}}, each side
    // {"vertices","coverageValid","gapArea","overlapArea","slivers","regionsGeojson":[...],"gaps","overlaps"}.
    std::string simplify(double tolerance) {
        if (!(tolerance > 0)) throw std::invalid_argument("tolerance must be positive");
        std::vector<geosapp::Session::Geometry> each;
        for (int index = 0; index < geos.parts(map.get()); index += 1) {
            each.push_back(geos.own(GEOSTopologyPreserveSimplify_r(geos.context, GEOSGetGeometryN_r(geos.context, map.get(), index), tolerance)));
        }
        const auto separately = geos.collect(GEOS_GEOMETRYCOLLECTION, std::move(each));
        const auto together = geos.own(GEOSCoverageSimplifyVW_r(geos.context, map.get(), tolerance, 0));
        return "{\"tolerance\":" + geosapp::number(tolerance) + ",\"separately\":" + audit(separately.get()) + ",\"coverage\":" + audit(together.get()) + "}";
    }

private:
    bool coverageValid(const GEOSGeometry* regions) {
        const int result = GEOSCoverageIsValid_r(geos.context, regions, 0, nullptr);
        if (result == 2) geos.fail("GEOS could not validate the coverage");
        return result == 1;
    }

    std::string geojsonList(const GEOSGeometry* regions) {
        std::string list = "[";
        for (int index = 0; index < geos.parts(regions); index += 1) list += (index ? "," : "") + geos.geojson(GEOSGetGeometryN_r(geos.context, regions, index));
        return list + "]";
    }

    int polygons(const GEOSGeometry* geometry) { return geos.empty(geometry) ? 0 : geos.parts(geometry); }

    // Gaps: what the regions no longer cover of the square. Overlaps: area claimed by two regions.
    std::string audit(const GEOSGeometry* regions) {
        const auto merged = geos.own(GEOSUnaryUnion_r(geos.context, regions));
        const auto gaps = geos.own(GEOSDifference_r(geos.context, square.get(), merged.get()));
        const auto overlaps = overlapsOf(regions);
        return "{\"vertices\":" + std::to_string(geos.points(regions)) + ",\"coverageValid\":" + geosapp::boolean(coverageValid(regions)) +
               ",\"gapArea\":" + geosapp::number(geos.area(gaps.get())) + ",\"overlapArea\":" + geosapp::number(geos.area(overlaps.get())) +
               ",\"slivers\":" + std::to_string(polygons(gaps.get()) + polygons(overlaps.get())) + ",\"regionsGeojson\":" + geojsonList(regions) +
               ",\"gaps\":" + geos.geojson(gaps.get()) + ",\"overlaps\":" + geos.geojson(overlaps.get()) + "}";
    }

    geosapp::Session::Geometry overlapsOf(const GEOSGeometry* regions) {
        std::vector<geosapp::Session::Geometry> pieces;
        const int count = geos.parts(regions);
        for (int i = 0; i < count; i += 1) {
            const GEOSGeometry* first = GEOSGetGeometryN_r(geos.context, regions, i);
            for (int j = i + 1; j < count; j += 1) {
                const GEOSGeometry* second = GEOSGetGeometryN_r(geos.context, regions, j);
                if (!geos.answer(GEOSIntersects_r(geos.context, first, second))) continue;
                const auto shared = geos.own(GEOSIntersection_r(geos.context, first, second));
                for (int k = 0; k < geos.parts(shared.get()); k += 1) {
                    const GEOSGeometry* part = GEOSGetGeometryN_r(geos.context, shared.get(), k);
                    if (GEOSGeomTypeId_r(geos.context, part) == GEOS_POLYGON && geos.area(part) > 0) pieces.push_back(geos.clone(part));
                }
            }
        }
        if (pieces.empty()) return geos.own(GEOSGeom_createEmptyCollection_r(geos.context, GEOS_MULTIPOLYGON));
        const auto all = geos.collect(GEOS_GEOMETRYCOLLECTION, std::move(pieces));
        return geos.own(GEOSUnaryUnion_r(geos.context, all.get()));
    }

    geosapp::Session geos;
    std::vector<coveragemap::Ring> rings;
    geosapp::Session::Geometry map;
    geosapp::Session::Geometry square;
};
