#pragma once

#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

// The generated elevation models every LERC app works on: value noise with analytic derivatives,
// summed so that each octave is damped by the slope gathered so far, which reads as eroded terrain.
// Only +, -, *, / and floor run in float64 and the hash is uint32, so the module and the numpy
// reference that produced the expected numbers make the same heights to the bit.
namespace terrain {

constexpr int kSize = 512;

struct Preset {
    uint32_t seed;
    double base;
    double relief;
    double cellSize;  // metres per pixel, for the hillshade
};

// 0: mountains, 30 m cells (15 km across, about 80 to 5,640 m). 1: lowland, 2 m cells (1 km, about 22 to 105 m).
inline Preset preset(int index) {
    if (index == 0) return {2026u, 4200.0, 3000.0, 30.0};
    if (index == 1) return {7u, 60.0, 40.0, 2.0};
    throw std::invalid_argument("terrain preset must be 0 (mountains) or 1 (lowland)");
}

inline uint32_t hash(int64_t x, int64_t y, uint32_t seed) {
    uint32_t h = seed ^ (static_cast<uint32_t>(x) * 0x27D4EB2Du) ^ (static_cast<uint32_t>(y) * 0x165667B1u);
    h ^= h >> 15;
    h *= 0x2C1B3C6Du;
    h ^= h >> 12;
    h *= 0x297A2D39u;
    h ^= h >> 15;
    return h;
}

inline double lattice(int64_t x, int64_t y, uint32_t seed) { return hash(x, y, seed) / 4294967295.0; }

struct Sample {
    double value;  // -1 .. 1
    double dx;
    double dy;
};

inline Sample noise(double x, double y, uint32_t seed) {
    const double fx = std::floor(x);
    const double fy = std::floor(y);
    const auto ix = static_cast<int64_t>(fx);
    const auto iy = static_cast<int64_t>(fy);
    const double tx = x - fx;
    const double ty = y - fy;
    const double ux = tx * tx * tx * (tx * (tx * 6.0 - 15.0) + 10.0);
    const double uy = ty * ty * ty * (ty * (ty * 6.0 - 15.0) + 10.0);
    const double dux = 30.0 * tx * tx * (tx * (tx - 2.0) + 1.0);
    const double duy = 30.0 * ty * ty * (ty * (ty - 2.0) + 1.0);
    const double a = lattice(ix, iy, seed);
    const double b = lattice(ix + 1, iy, seed);
    const double c = lattice(ix, iy + 1, seed);
    const double d = lattice(ix + 1, iy + 1, seed);
    const double k1 = b - a;
    const double k2 = c - a;
    const double k4 = a - b - c + d;
    return {-1.0 + 2.0 * (a + k1 * ux + k2 * uy + k4 * ux * uy), 2.0 * dux * (k1 + k4 * uy), 2.0 * duy * (k2 + k4 * ux)};
}

// Eight octaves from a 256-pixel base period; each one turns the sample grid by atan(3/4).
inline double eroded(int x, int y, uint32_t seed) {
    double px = x / 256.0;
    double py = y / 256.0;
    double total = 0.0;
    double sx = 0.0;
    double sy = 0.0;
    double amp = 1.0;
    for (uint32_t octave = 0; octave < 8; ++octave) {
        const Sample n = noise(px, py, seed + octave * 1013u);
        sx = sx + n.dx;
        sy = sy + n.dy;
        total = total + amp * n.value / (1.0 + (sx * sx + sy * sy));
        amp = amp * 0.5;
        const double nx = (px * 0.8 - py * 0.6) * 2.0;
        const double ny = (px * 0.6 + py * 0.8) * 2.0;
        px = nx;
        py = ny;
    }
    return total;
}

// kSize x kSize float32 heights in metres, row by row from the top left.
inline std::vector<float> heights(int index) {
    const Preset p = preset(index);
    std::vector<float> out(static_cast<size_t>(kSize) * kSize);
    for (int y = 0; y < kSize; ++y) {
        for (int x = 0; x < kSize; ++x) out[static_cast<size_t>(y) * kSize + x] = static_cast<float>(p.base + p.relief * eroded(x, y, p.seed));
    }
    return out;
}

}  // namespace terrain
