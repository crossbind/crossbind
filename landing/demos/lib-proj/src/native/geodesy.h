#pragma once

#include <geodesic.h>

#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

// Distances, headings and areas on the WGS 84 ellipsoid with geodesic.h, the C version of Charles
// Karney's GeographicLib that ships inside PROJ. Angles are in degrees, headings clockwise from north.
class Geodesy {
public:
    // [meters, azimuth1, azimuth2]: the length of the shortest route between two points, and the
    // heading at its start and at its end.
    static std::string inverse(double lat1, double lon1, double lat2, double lon2) {
        double meters, azimuth1, azimuth2;
        geod_inverse(&wgs84(), lat1, lon1, lat2, lon2, &meters, &azimuth1, &azimuth2);
        return json(meters, azimuth1, azimuth2);
    }

    // [lat, lon, azimuth]: where you arrive after `meters` from a point on a heading, and the
    // heading you arrive with.
    static std::string direct(double lat, double lon, double azimuth, double meters) {
        double lat2, lon2, azimuth2;
        geod_direct(&wgs84(), lat, lon, azimuth, meters, &lat2, &lon2, &azimuth2);
        return json(lat2, lon2, azimuth2);
    }

    // [m2, perimeter] of a polygon whose corners are latitude, longitude pairs in any text, such
    // as JSON: [[lat, lon], [lat, lon], ...]. Counter-clockwise corners give a positive area.
    static std::string area(const std::string& corners) {
        const std::vector<double> numbers = numbersIn(corners);
        if (numbers.size() < 6 || numbers.size() % 2) throw std::invalid_argument("a polygon needs at least three latitude, longitude pairs");
        std::vector<double> lats, lons;
        for (size_t index = 0; index < numbers.size(); index += 2) {
            lats.push_back(numbers[index]);
            lons.push_back(numbers[index + 1]);
        }
        double m2, perimeter;
        geod_polygonarea(&wgs84(), lats.data(), lons.data(), static_cast<int>(lats.size()), &m2, &perimeter);
        char text[64];
        std::snprintf(text, sizeof text, "[%.17g,%.17g]", m2, perimeter);
        return text;
    }

private:
    static const geod_geodesic& wgs84() {
        static const geod_geodesic ellipsoid = [] {
            geod_geodesic g;
            geod_init(&g, 6378137, 1 / 298.257223563);
            return g;
        }();
        return ellipsoid;
    }

    static std::string json(double a, double b, double c) {
        char text[96];
        std::snprintf(text, sizeof text, "[%.17g,%.17g,%.17g]", a, b, c);
        return text;
    }

    static std::vector<double> numbersIn(const std::string& text) {
        std::vector<double> numbers;
        const char* at = text.c_str();
        while (*at) {
            char* end = nullptr;
            const double value = std::strtod(at, &end);
            if (end == at) {
                at += 1;
            } else {
                numbers.push_back(value);
                at = end;
            }
        }
        return numbers;
    }
};
