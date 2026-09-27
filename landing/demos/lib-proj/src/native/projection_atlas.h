#pragma once

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "../support/map_projection.h"

// The Projection atlas on crossbind.dev/ports/proj/: any projected CRS drawn over the area it is
// defined for, as a graticule and Tissot's circles. The circles are equal on the ellipsoid, so the
// shapes they take on the map show what the projection stretches, and proj_factors measures it.
class ProjectionAtlas {
public:
    ProjectionAtlas() {}

    // A JSON object: name, code, method, area (west, south, east, north, name, known), spacing of
    // the graticule; everyLat, everyLon (degrees between circle centres) and radius of the
    // circles; the graticule, outline and circles as runs of x, y in the CRS's units, their
    // bounds, and the smallest and largest areal scale and the largest angle error at the circles'
    // centres.
    std::string draw(const std::string& definition) {
        map = std::make_unique<projapp::MapProjection>(proj, definition);
        const projapp::Area& area = map->areaOfUse();
        const double width = area.eastUnwrapped() - area.west;
        const double height = area.north - area.south;
        const double spacing = std::min(niceStep(std::max(width, height) / 16), niceStep(std::min(width, height) / 2));
        const std::vector<projapp::Run> graticule = map->graticule(area, spacing);
        const std::vector<projapp::Run> outline = map->outline(area);

        // A row and a column of circles every two graticule steps; closer where a narrow area
        // would get fewer than two of them, further apart when there would be more than 150.
        double everyLat = spacing * 2, everyLon = spacing * 2;
        while (everyLat > spacing / 4 && inside(area.south, area.north, everyLat) < 2) everyLat /= 2;
        while (everyLon > spacing / 4 && inside(area.west, area.west + width, everyLon) < 2) everyLon /= 2;
        // Around a pole the antimeridian is a line like any other, so it gets circles too.
        double x1, y1, x2, y2;
        const double middle = (area.south + area.north) / 2;
        const bool seamless = area.allLongitudes() && map->project(-180, middle, x1, y1) && map->project(180, middle, x2, y2) &&
                              std::hypot(x2 - x1, y2 - y1) <= 1e-6 * (std::fabs(x1) + std::fabs(y1) + 1);
        while (centres(area, everyLon, everyLat, seamless).size() > 150) everyLon *= 2, everyLat *= 2;
        const double radius = std::min(everyLon, everyLat) * 0.2 * 111320;
        std::vector<std::string> circles;
        std::vector<std::vector<projapp::Run>> drawn;
        double arealMin = INFINITY, arealMax = 0, angularMax = 0;
        for (const auto& centre : centres(area, everyLon, everyLat, seamless)) {
            drawn.push_back(map->line(map->circle(centre.first, centre.second, radius, 72)));
            circles.push_back(projapp::runs(drawn.back()));
            PJ_FACTORS factors;
            if (!map->factors(centre.first, centre.second, factors)) continue;
            arealMin = std::min(arealMin, factors.areal_scale);
            arealMax = std::max(arealMax, factors.areal_scale);
            angularMax = std::max(angularMax, factors.angular_distortion);
        }

        double bounds[4] = {INFINITY, INFINITY, -INFINITY, -INFINITY};
        const auto grow = [&bounds](const std::vector<projapp::Run>& runs) {
            for (const auto& run : runs) {
                for (size_t index = 0; index + 1 < run.size(); index += 2) {
                    bounds[0] = std::min(bounds[0], run[index]);
                    bounds[1] = std::min(bounds[1], run[index + 1]);
                    bounds[2] = std::max(bounds[2], run[index]);
                    bounds[3] = std::max(bounds[3], run[index + 1]);
                }
            }
        };
        grow(graticule);
        grow(outline);
        for (const auto& circle : drawn) grow(circle);
        if (!std::isfinite(bounds[0])) throw std::runtime_error("PROJ could not project any point of this CRS's area");

        using projapp::number;
        const std::string areaJson = projapp::JsonObject()
                                         .number("west", area.west)
                                         .number("south", area.south)
                                         .number("east", area.east)
                                         .number("north", area.north)
                                         .text("name", area.name)
                                         .flag("known", area.known)
                                         .json();
        return projapp::JsonObject()
            .text("name", map->name())
            .text("code", map->code())
            .text("method", map->method())
            .raw("area", areaJson)
            .number("spacing", spacing)
            .number("everyLat", everyLat)
            .number("everyLon", everyLon)
            .number("radius", radius)
            .raw("graticule", projapp::runs(graticule))
            .raw("outline", projapp::runs(outline))
            .raw("circles", projapp::array(circles))
            .raw("bounds", projapp::array({number(bounds[0]), number(bounds[1]), number(bounds[2]), number(bounds[3])}))
            .raw("areal", projapp::array({number(arealMin), number(arealMax)}))
            .number("angular", angularMax / projapp::kRadiansPerDegree)
            .json();
    }

    // [x, y] of a longitude and latitude in the CRS last drawn.
    std::string project(double lon, double lat) {
        double x, y;
        if (!drawn().project(lon, lat, x, y)) throw std::runtime_error("this point is outside the projection");
        return projapp::array({projapp::number(x), projapp::number(y)});
    }

    // The distortion at a longitude and latitude, as a JSON object: lon, lat, areal (the area
    // scale), angular (the largest angle error, in degrees), meridian and parallel (the scale
    // along each).
    std::string distortion(double lon, double lat) {
        PJ_FACTORS factors;
        if (!drawn().factors(lon, lat, factors)) throw std::runtime_error("PROJ cannot measure the distortion at this point");
        return projapp::JsonObject()
            .number("lon", lon)
            .number("lat", lat)
            .number("areal", factors.areal_scale)
            .number("angular", factors.angular_distortion / projapp::kRadiansPerDegree)
            .number("meridian", factors.meridional_scale)
            .number("parallel", factors.parallel_scale)
            .json();
    }

    // The same at a point of the map, in the CRS's units.
    std::string inspect(double x, double y) {
        double lon, lat;
        if (!drawn().unproject(x, y, lon, lat)) throw std::runtime_error("this point is off the map");
        return distortion(lon, lat);
    }

private:
    const projapp::MapProjection& drawn() const {
        if (!map) throw std::runtime_error("draw a projection first");
        return *map;
    }

    static double niceStep(double target) {
        for (const double step : {30.0, 15.0, 10.0, 5.0, 2.0, 1.0, 0.5, 0.25, 0.1, 0.05, 0.02}) {
            if (step <= target) return step;
        }
        return 0.01;
    }

    // How many multiples of `every` lie strictly between two values.
    static int inside(double from, double to, double every) {
        return std::max(0, static_cast<int>(std::ceil(to / every)) - static_cast<int>(std::floor(from / every)) - 1);
    }

    // Circle centres on multiples of the spacings, inside the area and off its edges; on the west
    // edge too when the area goes all the way round without a seam.
    static std::vector<std::pair<double, double>> centres(const projapp::Area& area, double everyLon, double everyLat, bool seamless) {
        std::vector<std::pair<double, double>> points;
        const int first = seamless ? static_cast<int>(std::ceil(area.west / everyLon)) : static_cast<int>(std::floor(area.west / everyLon)) + 1;
        const double last = seamless ? area.west + 360 : area.eastUnwrapped();
        for (int row = static_cast<int>(std::floor(area.south / everyLat)) + 1; row * everyLat < area.north; row += 1) {
            for (int column = first; column * everyLon < last; column += 1) points.emplace_back(std::remainder(column * everyLon, 360.0), row * everyLat);
        }
        return points;
    }

    projapp::Context proj;
    std::unique_ptr<projapp::MapProjection> map;
};
