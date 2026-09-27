#pragma once

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

// The map the Coverage simplifier works on: an n x n grid of jittered cells in a 100 x 100 square
// whose inner borders wiggle. Each border is computed once and shared by both of its regions, so
// the regions form an exact coverage. Only + - * / and sqrt are used, which IEEE 754 rounds the
// same way everywhere: the Python reference behind the expected numbers builds the same bits.
namespace coveragemap {

using Point = std::pair<double, double>;
using Ring = std::vector<Point>;

constexpr int INSIDE = 12;  // points inside every border

inline Point node(int i, int j, int n) {
    const double size = 100.0 / n;
    if (i == 0 || i == n || j == 0 || j == n) return {i * size, j * size};
    const double a = ((i * 7919 + j * 104729) % 1000) / 1000.0 - 0.5;
    const double b = ((i * 104723 + j * 7907) % 1000) / 1000.0 - 0.5;
    return {i * size + a * size * 0.3, j * size + b * size * 0.3};
}

// The border from node (pi, pj) to node (qi, qj), both ends included; (pi, pj) < (qi, qj).
inline Ring border(int pi, int pj, int qi, int qj, int n) {
    const Point from = node(pi, pj, n);
    const Point to = node(qi, qj, n);
    const bool outer = (pi == qi && (pi == 0 || pi == n)) || (pj == qj && (pj == 0 || pj == n));
    const double dx = to.first - from.first;
    const double dy = to.second - from.second;
    const double length = std::sqrt(dx * dx + dy * dy);
    const double nx = -dy / length;
    const double ny = dx / length;
    const int seed = pi * 3 + pj * 5 + qi * 7 + qj * 11;
    const double amplitude = outer ? 0.0 : (4.0 + (seed % 3)) * (seed % 2 == 0 ? 1.0 : -1.0);
    Ring points{from};
    for (int k = 1; k <= INSIDE; k += 1) {
        const double t = k / (INSIDE + 1.0);
        const double x = 2.0 * t - 1.0;
        const double wiggle = amplitude * (1.0 - x * x) * (4.0 * x * x * x - 3.0 * x);
        const double noise = outer ? 0.0 : ((seed * 131 + k * 71) % 97) / 97.0 - 0.5;
        const double offset = wiggle + noise;
        points.push_back({from.first + dx * t + nx * offset, from.second + dy * t + ny * offset});
    }
    points.push_back(to);
    return points;
}

// Region (i, j) runs counter-clockwise from its lower-left node; regions go column by column.
inline std::vector<Ring> regions(int n) {
    std::vector<Ring> out;
    for (int i = 0; i < n; i += 1) {
        for (int j = 0; j < n; j += 1) {
            const int corners[5][2] = {{i, j}, {i + 1, j}, {i + 1, j + 1}, {i, j + 1}, {i, j}};
            Ring ring;
            for (int c = 0; c < 4; c += 1) {
                const int* a = corners[c];
                const int* b = corners[c + 1];
                const bool forward = a[0] < b[0] || (a[0] == b[0] && a[1] < b[1]);
                Ring part = forward ? border(a[0], a[1], b[0], b[1], n) : border(b[0], b[1], a[0], a[1], n);
                if (!forward) std::reverse(part.begin(), part.end());
                ring.insert(ring.end(), ring.empty() ? part.begin() : part.begin() + 1, part.end());
            }
            out.push_back(ring);
        }
    }
    return out;
}

inline std::string coordinates(double x, double y, const char* separator) {
    char text[64];
    std::snprintf(text, sizeof text, "%.17g %.17g%s", x, y, separator);
    return text;
}

// %.17g round-trips every double, so GEOS reads back exactly the generated coordinates.
inline std::string wkt(const Ring& ring) {
    std::string text = "POLYGON ((";
    for (size_t index = 0; index < ring.size(); index += 1) text += coordinates(ring[index].first, ring[index].second, index + 1 < ring.size() ? ", " : "");
    return text + "))";
}

inline std::string vertexText(const std::vector<Ring>& rings) {
    std::string text;
    for (const Ring& ring : rings) {
        for (const Point& point : ring) text += coordinates(point.first, point.second, "\n");
    }
    return text;
}

}  // namespace coveragemap
