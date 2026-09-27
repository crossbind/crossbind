#pragma once

#include <geodesic.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/map_projection.h"

// Why flights curve, on crossbind.dev/ports/proj/: the shortest route between two places on the
// WGS 84 ellipsoid next to the route that keeps one compass heading, drawn on any projection. On
// Mercator the constant heading is the straight line and the shortest route bends toward the pole;
// on a map centred on the departure, the shortest route is the straight one.
class FlightPaths {
public:
    FlightPaths() : mercator(proj, "EPSG:3395") {}

    // A JSON object. geodesic: meters, azimuth1 and azimuth2 (the headings at departure and
    // arrival), midpoint and highest (the point farthest from the equator), as [lon, lat].
    // rhumb: meters and azimuth of the route that keeps one heading, a straight line on Mercator.
    std::string route(double lat1, double lon1, double lat2, double lon2) {
        check(lat1, lon1);
        check(lat2, lon2);
        double meters, azimuth1, azimuth2;
        geod_inverse(&mercator.geodesic(), lat1, lon1, lat2, lon2, &meters, &azimuth1, &azimuth2);
        double midLat, midLon;
        geod_direct(&mercator.geodesic(), lat1, lon1, azimuth1, meters / 2, &midLat, &midLon, nullptr);
        const std::vector<double> path = mercator.geodesicPath(lat1, lon1, lat2, lon2, kSamples);
        size_t highest = 0;
        for (size_t index = 0; index < path.size(); index += 2) {
            if (std::fabs(path[index + 1]) > std::fabs(path[highest + 1])) highest = index;
        }
        double heading = 0;
        const std::vector<double> rhumb = rhumbPath(lat1, lon1, lat2, lon2, heading);
        double rhumbMeters = 0;
        for (size_t index = 2; index < rhumb.size(); index += 2) {
            double step;
            geod_inverse(&mercator.geodesic(), rhumb[index - 1], rhumb[index - 2], rhumb[index + 1], rhumb[index], &step, nullptr, nullptr);
            rhumbMeters += step;
        }
        using projapp::number;
        return projapp::JsonObject()
            .raw("geodesic", projapp::JsonObject()
                                 .number("meters", meters)
                                 .number("azimuth1", azimuth1)
                                 .number("azimuth2", azimuth2)
                                 .raw("midpoint", projapp::array({number(midLon), number(midLat)}))
                                 .raw("highest", projapp::array({number(path[highest]), number(path[highest + 1])}))
                                 .json())
            .raw("rhumb", projapp::JsonObject().number("meters", rhumbMeters).number("azimuth", heading).json())
            .json();
    }

    // A JSON object: the graticule, outline, geodesic and rhumb as runs of x, y in the CRS's
    // units, ends (the two places as [x, y], null when off the map) and the bounds of it all.
    std::string draw(const std::string& definition, double lat1, double lon1, double lat2, double lon2) {
        check(lat1, lon1);
        check(lat2, lon2);
        const projapp::MapProjection map(proj, definition);
        const std::vector<projapp::Run> graticule = map.graticule(map.areaOfUse(), 30);
        const std::vector<projapp::Run> outline = map.outline(map.areaOfUse());
        const std::vector<projapp::Run> geodesic = map.line(map.geodesicPath(lat1, lon1, lat2, lon2, kSamples));
        double heading = 0;
        const std::vector<projapp::Run> rhumb = map.line(rhumbPath(lat1, lon1, lat2, lon2, heading));
        double bounds[4] = {INFINITY, INFINITY, -INFINITY, -INFINITY};
        for (const auto* runs : {&graticule, &outline, &geodesic, &rhumb}) {
            for (const auto& run : *runs) {
                for (size_t index = 0; index + 1 < run.size(); index += 2) {
                    bounds[0] = std::min(bounds[0], run[index]);
                    bounds[1] = std::min(bounds[1], run[index + 1]);
                    bounds[2] = std::max(bounds[2], run[index]);
                    bounds[3] = std::max(bounds[3], run[index + 1]);
                }
            }
        }
        if (!std::isfinite(bounds[0])) throw std::runtime_error("PROJ could not project this map");
        using projapp::number;
        const auto end = [&map](double lat, double lon) {
            double x, y;
            return map.project(lon, lat, x, y) ? projapp::array({number(x), number(y)}) : std::string("null");
        };
        return projapp::JsonObject()
            .text("name", map.name())
            .text("method", map.method())
            .raw("graticule", projapp::runs(graticule))
            .raw("outline", projapp::runs(outline))
            .raw("geodesic", projapp::runs(geodesic))
            .raw("rhumb", projapp::runs(rhumb))
            .raw("ends", projapp::array({end(lat1, lon1), end(lat2, lon2)}))
            .raw("bounds", projapp::array({number(bounds[0]), number(bounds[1]), number(bounds[2]), number(bounds[3])}))
            .json();
    }

private:
    static constexpr int kSamples = 720;

    static void check(double lat, double lon) {
        if (!std::isfinite(lat) || !std::isfinite(lon) || std::fabs(lat) > 89 || std::fabs(lon) > 180) {
            throw std::invalid_argument("each place needs a latitude between -89 and 89 and a longitude between -180 and 180");
        }
    }

    // The constant-heading route as longitude, latitude pairs: the straight line between the two
    // places on ellipsoidal Mercator, which is conformal, taken the short way round, then
    // unprojected point by point. Its heading is the line's direction on the map.
    std::vector<double> rhumbPath(double lat1, double lon1, double lat2, double lon2, double& heading) const {
        double x1, y1, x2, y2;
        if (!mercator.project(lon1, lat1, x1, y1) || !mercator.project(lon2, lat2, x2, y2)) throw std::runtime_error("PROJ cannot put these places on Mercator");
        double west, south, east, north;
        mercator.project(-180, 0, west, south);
        mercator.project(180, 0, east, north);
        const double world = east - west;
        x2 = x1 + std::remainder(x2 - x1, world);
        heading = std::fmod(std::atan2(x2 - x1, y2 - y1) / projapp::kRadiansPerDegree + 360, 360.0);
        std::vector<double> lonLat;
        for (int index = 0; index <= kSamples; index += 1) {
            const double t = static_cast<double>(index) / kSamples;
            double lon, lat;
            if (!mercator.unproject(x1 + t * (x2 - x1), y1 + t * (y2 - y1), lon, lat)) throw std::runtime_error("PROJ cannot follow this heading");
            lonLat.push_back(std::remainder(lon, 360.0));
            lonLat.push_back(lat);
        }
        return lonLat;
    }

    projapp::Context proj;
    projapp::MapProjection mercator;
};
