#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>

// The terrain studio's generated landscape and colour tables.
namespace terrain {

// Gradient noise: one of sixteen unit gradients per lattice point, none along an axis, picked by an
// integer hash of the point and the seed and blended with a quintic fade. The gradients are written
// out as numbers and only +, -, * and floor run on doubles, so a seed always gives the same heights.
inline double lattice(int x, int y, std::uint32_t seed, double dx, double dy) {
    std::uint32_t h = static_cast<std::uint32_t>(x) * 374761393u + static_cast<std::uint32_t>(y) * 668265263u + seed * 2246822519u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h ^= h >> 16;
    constexpr double gx[16] = {0.98078528040323043, 0.83146961230254524, 0.55557023301960229, 0.19509032201612833, -0.19509032201612819, -0.5555702330196024, -0.83146961230254535, -0.98078528040323043, -0.98078528040323043, -0.83146961230254524, -0.55557023301960218, -0.19509032201612866, 0.1950903220161283, 0.55557023301960184, 0.83146961230254524, 0.98078528040323032};
    constexpr double gy[16] = {0.19509032201612825, 0.55557023301960218, 0.83146961230254524, 0.98078528040323043, 0.98078528040323043, 0.83146961230254512, 0.55557023301960218, 0.19509032201612816, -0.19509032201612836, -0.55557023301960229, -0.83146961230254524, -0.98078528040323032, -0.98078528040323043, -0.83146961230254546, -0.55557023301960218, -0.19509032201612872};
    return gx[h & 15] * dx + gy[h & 15] * dy;
}

inline double fade(double t) { return t * t * t * (t * (t * 6 - 15) + 10); }

inline double noise(double x, double y, std::uint32_t seed) {
    const int x0 = static_cast<int>(std::floor(x)), y0 = static_cast<int>(std::floor(y));
    const double fx = x - x0, fy = y - y0;
    const double u = fade(fx), v = fade(fy);
    const double a = lattice(x0, y0, seed, fx, fy), b = lattice(x0 + 1, y0, seed, fx - 1, fy);
    const double c = lattice(x0, y0 + 1, seed, fx, fy - 1), e = lattice(x0 + 1, y0 + 1, seed, fx - 1, fy - 1);
    return (a + u * (b - a)) + v * ((c + u * (e - c)) - (a + u * (b - a)));
}

// Elevation in metres at a pixel: rolling hills from six octaves of noise, and sharp ridges from
// folded noise where a broad mask raises mountain ranges, on a plain that rises towards the
// north-east. Each octave is turned by the exact 3-4-5 rotation, so no feature lines up with the lattice.
inline float elevation(int column, int row, int size, std::uint32_t seed) {
    double x = column * 4.0 / size, y = row * 4.0 / size;
    const double range = std::min(1.0, std::max(0.0, 0.7 + 1.6 * noise(x * 0.3 + 5.5, y * 0.3 + 9.25, seed + 211)));
    double hills = 0, ridges = 0, amplitude = 1, total = 0;
    for (int octave = 0; octave < 6; ++octave) {
        hills += amplitude * noise(x, y, seed + octave);
        const double fold = 1 - std::fabs(noise(x * 0.5 + 17.25, y * 0.5 + 3.75, seed + 101 + octave) * 1.6);
        ridges += amplitude * fold * fold;
        total += amplitude;
        amplitude *= 0.5;
        const double turned = 0.8 * x - 0.6 * y;
        y = 2 * (0.6 * x + 0.8 * y);
        x = 2 * turned;
    }
    hills /= total;
    ridges /= total;
    const double slope = (column + (size - row)) / (2.0 * size);
    const double height = 150 + 400 * slope + 520 * (hills + 0.5) + 1300 * range * ridges * ridges;
    return static_cast<float>(std::round(height * 10) / 10);
}

// gdaldem color-relief tables: "value red green blue [alpha]" per line, nv for no data. The
// elevation model has no no-data value, so its table has no nv line (GDAL would warn and skip it).
inline std::string reliefColours() {
    return "0% 58 122 72\n12% 96 150 84\n30% 170 177 105\n50% 196 164 116\n70% 158 120 92\n86% 186 176 168\n100% 248 248 246\n";
}
inline std::string slopeColours() { return "nv 0 0 0 0\n0 247 247 240\n10 214 222 180\n20 230 190 120\n30 214 120 72\n45 150 40 40\n90 70 10 20\n"; }
inline std::string aspectColours() {
    return "nv 0 0 0 0\n-9999 200 200 200\n0 214 72 72\n90 214 196 72\n180 72 170 120\n270 72 110 214\n360 214 72 72\n";
}
inline std::string tpiColours() { return "nv 0 0 0 0\n-30 40 90 170\n-5 150 190 220\n0 245 245 240\n5 235 170 130\n30 170 40 40\n"; }
inline std::string roughnessColours() { return "nv 0 0 0 0\n0 247 247 240\n10 200 210 160\n25 170 140 90\n60 110 60 40\n150 40 20 10\n"; }

}  // namespace terrain
