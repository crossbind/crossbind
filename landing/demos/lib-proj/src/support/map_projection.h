#pragma once

#include <geodesic.h>
#include <proj.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

#include "proj_context.h"
#include "proj_json.h"

namespace projapp {

constexpr double kRadiansPerDegree = 3.14159265358979323846 / 180;

// Where a CRS may be used, in degrees; the whole world when the definition carries no area.
struct Area {
    double west = -180, south = -90, east = 180, north = 90;
    std::string name;
    bool known = false;

    // East of west, even across the antimeridian.
    double eastUnwrapped() const { return east < west ? east + 360 : east; }
    bool allLongitudes() const { return eastUnwrapped() - west >= 360 - 1e-9; }
    bool world() const { return allLongitudes() && south <= -90 + 1e-9 && north >= 90 - 1e-9; }
};

// A projected CRS ready to draw: from its own geographic CRS to its map coordinates, longitude and
// easting first whatever the CRS's axis order. The geographic CRS is the projection's own, so
// drawing never involves a datum shift.
class MapProjection {
public:
    MapProjection(Context& proj, const std::string& definition) : crs(proj.crs(definition)) {
        if (proj_get_type(crs.get()) == PJ_TYPE_BOUND_CRS) crs = proj.own(proj_get_source_crs(proj.get(), crs.get()), "PROJ cannot unwrap this CRS");
        if (proj_get_type(crs.get()) != PJ_TYPE_PROJECTED_CRS) throw std::runtime_error(Context::shortened(definition) + " is not a projected CRS, so there is no map to draw");
        const Object geographic = proj.own(proj_crs_get_geodetic_crs(proj.get(), crs.get()), "PROJ found no geographic CRS under this projection");
        const Object operation = proj.own(proj_create_crs_to_crs_from_pj(proj.get(), geographic.get(), crs.get(), nullptr, nullptr), "PROJ cannot build this projection");
        pipeline = proj.own(proj_normalize_for_visualization(proj.get(), operation.get()), "PROJ cannot put longitude first for this projection");
        const Object shape = proj.own(proj_get_ellipsoid(proj.get(), crs.get()), "PROJ found no ellipsoid for this CRS");
        double semiMajor = 0, semiMinor = 0, inverseFlattening = 0;
        int computed = 0;
        proj_ellipsoid_get_parameters(proj.get(), shape.get(), &semiMajor, &semiMinor, &computed, &inverseFlattening);
        geod_init(&ellipsoid, semiMajor, inverseFlattening > 0 ? 1 / inverseFlattening : 0);
        double west, south, east, north;
        const char* name = nullptr;
        if (proj_get_area_of_use(proj.get(), crs.get(), &west, &south, &east, &north, &name) && west > -1000) {
            area = Area{west, south, east, north, name ? name : "", true};
        }
        const Object conversion(proj_crs_get_coordoperation(proj.get(), crs.get()));
        const char* method = nullptr;
        if (conversion) proj_coordoperation_get_method_info(proj.get(), conversion.get(), &method, nullptr, nullptr);
        methodName = method ? method : "";
    }

    MapProjection(const MapProjection&) = delete;
    MapProjection& operator=(const MapProjection&) = delete;

    const Area& areaOfUse() const { return area; }
    const std::string& method() const { return methodName; }
    const geod_geodesic& geodesic() const { return ellipsoid; }

    // "EPSG:8857", or "" when the definition carries no code.
    std::string code() const {
        const char* authority = proj_get_id_auth_name(crs.get(), 0);
        const char* id = proj_get_id_code(crs.get(), 0);
        return authority && id ? std::string(authority) + ":" + id : "";
    }

    std::string name() const { return proj_get_name(crs.get()); }

    bool project(double lon, double lat, double& x, double& y) const {
        proj_errno_reset(pipeline.get());
        const PJ_COORD out = proj_trans(pipeline.get(), PJ_FWD, proj_coord(lon, lat, 0, HUGE_VAL));
        x = out.xy.x;
        y = out.xy.y;
        return std::isfinite(x) && std::isfinite(y) && std::fabs(x) < 1e12 && std::fabs(y) < 1e12;
    }

    bool unproject(double x, double y, double& lon, double& lat) const {
        proj_errno_reset(pipeline.get());
        const PJ_COORD out = proj_trans(pipeline.get(), PJ_INV, proj_coord(x, y, 0, HUGE_VAL));
        lon = out.lp.lam;
        lat = out.lp.phi;
        return std::isfinite(lon) && std::isfinite(lat) && std::fabs(lat) <= 90;
    }

    // Scale factors at a point, from PROJ's numerical derivatives of the projection.
    bool factors(double lon, double lat, PJ_FACTORS& out) const {
        proj_errno_reset(crs.get());
        out = proj_factors(crs.get(), proj_coord(lon * kRadiansPerDegree, lat * kRadiansPerDegree, 0, 0));
        return proj_errno(crs.get()) == 0 && std::isfinite(out.areal_scale);
    }

    // Projects a line of longitude, latitude pairs into runs. It breaks where points fall outside
    // the projection and where the map tears: at the antimeridian, at an interruption, at a horizon.
    std::vector<Run> line(const std::vector<double>& lonLat) const {
        const size_t count = lonLat.size() / 2;
        std::vector<double> xs(count), ys(count);
        std::vector<bool> inside(count);
        for (size_t index = 0; index < count; index += 1) inside[index] = project(lonLat[2 * index], lonLat[2 * index + 1], xs[index], ys[index]);
        // Segment `index` joins points index and index + 1; its length is -1 when either is outside.
        const auto chord = [&](size_t index) {
            if (index + 1 >= count || !inside[index] || !inside[index + 1]) return -1.0;
            return std::hypot(xs[index + 1] - xs[index], ys[index + 1] - ys[index]);
        };
        // The line's usual step on the map: the median, which stretched stretches do not move.
        std::vector<double> steps;
        for (size_t index = 0; index + 1 < count; index += 1) {
            if (chord(index) > 0) steps.push_back(chord(index));
        }
        double usual = 0;
        if (!steps.empty()) {
            std::nth_element(steps.begin(), steps.begin() + steps.size() / 2, steps.end());
            usual = steps[steps.size() / 2];
        }
        std::vector<Run> runs;
        Run current;
        const auto finish = [&] {
            if (current.size() >= 4) runs.push_back(current);
            current.clear();
        };
        for (size_t index = 0; index < count; index += 1) {
            if (!inside[index]) {
                finish();
                continue;
            }
            // A segment much longer than the usual step is either a tear, where the line breaks, or
            // a stretch of the map, where the line needs more points to follow its curve.
            const size_t segment = index - 1;
            if (!current.empty() && chord(segment) > 3 * usual) {
                if (tears(lonLat, xs, ys, segment, chord(segment))) {
                    finish();
                } else {
                    const double lon1 = lonLat[2 * segment], lat1 = lonLat[2 * segment + 1];
                    bridge(lon1, lat1, xs[segment], ys[segment], lon1 + std::remainder(lonLat[2 * index] - lon1, 360.0), lonLat[2 * index + 1], xs[index], ys[index],
                           3 * usual, 10, current);
                }
            }
            current.push_back(xs[index]);
            current.push_back(ys[index]);
        }
        finish();
        return runs;
    }

    // Meridians and parallels every `spacing` degrees across an area, sampled a tenth of the
    // spacing apart, one degree at most.
    std::vector<Run> graticule(const Area& within, double spacing) const {
        std::vector<Run> runs;
        const double step = std::min(1.0, spacing / 10);
        const double east = within.eastUnwrapped();
        for (int index = static_cast<int>(std::ceil(within.west / spacing - 1e-9));; index += 1) {
            const double lon = index * spacing;
            if (lon > east + 1e-9) break;
            append(runs, line(meridian(lon, within.south, within.north, step)));
        }
        for (int index = static_cast<int>(std::ceil(within.south / spacing - 1e-9));; index += 1) {
            const double lat = index * spacing;
            if (lat > within.north + 1e-9) break;
            if (std::fabs(lat) < 90) append(runs, line(parallel(lat, within.west, east, step)));
        }
        return runs;
    }

    // The edge of an area on the map: its outer meridians and parallels, where they are edges. An
    // azimuthal view of the whole world gets its horizon instead, which no meridian traces.
    std::vector<Run> outline(const Area& within) const {
        if (within.world() && azimuthal()) return horizon();
        std::vector<Run> runs;
        const double east = within.eastUnwrapped();
        const double step = std::min(1.0, std::max(east - within.west, within.north - within.south) / 100);
        if (!within.allLongitudes()) {
            append(runs, line(meridian(within.west, within.south, within.north, step)));
            append(runs, line(meridian(east, within.south, within.north, step)));
        }
        if (within.south > -90) append(runs, line(parallel(within.south, within.west, east, step)));
        if (within.north < 90) append(runs, line(parallel(within.north, within.west, east, step)));
        return runs;
    }

    // Longitude, latitude pairs of a circle on the ellipsoid: every point `meters` from the centre.
    std::vector<double> circle(double lon, double lat, double meters, int points) const {
        std::vector<double> lonLat;
        for (int index = 0; index <= points; index += 1) {
            double lat2, lon2;
            geod_direct(&ellipsoid, lat, lon, 360.0 * index / points, meters, &lat2, &lon2, nullptr);
            lonLat.push_back(lon2);
            lonLat.push_back(lat2);
        }
        return lonLat;
    }

    // Longitude, latitude pairs along the shortest route between two points, `points` of them.
    std::vector<double> geodesicPath(double lat1, double lon1, double lat2, double lon2, int points) const {
        geod_geodesicline route;
        geod_inverseline(&route, &ellipsoid, lat1, lon1, lat2, lon2, 0);
        std::vector<double> lonLat;
        for (int index = 0; index <= points; index += 1) {
            double lat, lon;
            geod_position(&route, route.s13 * index / points, &lat, &lon, nullptr);
            lonLat.push_back(lon);
            lonLat.push_back(lat);
        }
        return lonLat;
    }

    static void append(std::vector<Run>& to, const std::vector<Run>& from) { to.insert(to.end(), from.begin(), from.end()); }

private:
    bool azimuthal() const {
        return methodName == "Orthographic" || methodName.find("Azimuthal") != std::string::npos || methodName.find("Perspective") != std::string::npos;
    }

    // The edge of what an azimuthal view shows. From the point at the middle of the map, along
    // each of 180 headings, the farthest point that still projects and that the shortest route
    // still reaches on that heading: past it, the map draws the point from the other side.
    std::vector<Run> horizon() const {
        double lon0, lat0;
        if (!unproject(0, 0, lon0, lat0)) return {};
        double antipode;
        geod_inverse(&ellipsoid, lat0, lon0, -lat0, lon0 + 180, &antipode, nullptr, nullptr);
        const auto shows = [&](double heading, double meters, double& x, double& y) {
            double lat, lon, shortest, azimuth;
            geod_direct(&ellipsoid, lat0, lon0, heading, meters, &lat, &lon, nullptr);
            geod_inverse(&ellipsoid, lat0, lon0, lat, lon, &shortest, &azimuth, nullptr);
            return shortest > meters - 1 && std::fabs(std::remainder(azimuth - heading, 360.0)) < 0.01 && project(lon, lat, x, y);
        };
        Run edge;
        for (int step = 0; step <= 180; step += 1) {
            double near = 0, far = antipode, x, y;
            for (int halving = 0; halving < 40; halving += 1) {
                const double middle = (near + far) / 2;
                (shows(step * 2.0, middle, x, y) ? near : far) = middle;
            }
            if (!shows(step * 2.0, near, x, y)) continue;
            edge.push_back(x);
            edge.push_back(y);
        }
        return {edge};
    }

    static std::vector<double> meridian(double lon, double south, double north, double step) {
        std::vector<double> lonLat;
        for (int index = 0;; index += 1) {
            const double lat = std::min(south + index * step, north);
            lonLat.push_back(lon);
            lonLat.push_back(lat);
            if (lat >= north) break;
        }
        return lonLat;
    }

    static std::vector<double> parallel(double lat, double west, double east, double step) {
        std::vector<double> lonLat;
        for (int index = 0;; index += 1) {
            const double lon = std::min(west + index * step, east);
            lonLat.push_back(lon);
            lonLat.push_back(lat);
            if (lon >= east) break;
        }
        return lonLat;
    }

    // Halves a long segment toward its longer half. Where the projection is continuous the gap
    // shrinks with each halving; across a tear it stays as wide however close the two points get.
    bool tears(const std::vector<double>& lonLat, const std::vector<double>& xs, const std::vector<double>& ys, size_t segment, double length) const {
        double lon1 = lonLat[2 * segment], lat1 = lonLat[2 * segment + 1];
        double lon2 = lon1 + std::remainder(lonLat[2 * segment + 2] - lon1, 360.0), lat2 = lonLat[2 * segment + 3];
        double x1 = xs[segment], y1 = ys[segment], x2 = xs[segment + 1], y2 = ys[segment + 1];
        for (int halving = 0; halving < 24; halving += 1) {
            const double lon = (lon1 + lon2) / 2, lat = (lat1 + lat2) / 2;
            double x, y;
            if (!project(lon, lat, x, y)) return true;
            if (std::hypot(x - x1, y - y1) > std::hypot(x2 - x, y2 - y)) {
                lon2 = lon, lat2 = lat, x2 = x, y2 = y;
            } else {
                lon1 = lon, lat1 = lat, x1 = x, y1 = y;
            }
        }
        return std::hypot(x2 - x1, y2 - y1) > length / 1000;
    }

    // Adds points between the ends of a continuous segment, halving it until each piece is at most
    // `limit` long on the map, `depth` times at most.
    void bridge(double lon1, double lat1, double x1, double y1, double lon2, double lat2, double x2, double y2, double limit, int depth, Run& run) const {
        if (depth == 0 || std::hypot(x2 - x1, y2 - y1) <= limit) return;
        const double lon = (lon1 + lon2) / 2, lat = (lat1 + lat2) / 2;
        double x, y;
        if (!project(lon, lat, x, y)) return;
        bridge(lon1, lat1, x1, y1, lon, lat, x, y, limit, depth - 1, run);
        run.push_back(x);
        run.push_back(y);
        bridge(lon, lat, x, y, lon2, lat2, x2, y2, limit, depth - 1, run);
    }

    Object crs;
    Object pipeline;
    geod_geodesic ellipsoid{};
    Area area;
    std::string methodName;
};

}  // namespace projapp
