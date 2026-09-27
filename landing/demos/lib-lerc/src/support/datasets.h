#pragma once

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

#include "terrain.h"

// Four kinds of float32 raster, 512 x 512, for comparing LERC with gzip: generated from the same
// noise and hash as the terrain, so the numpy reference reproduces them to the bit.
namespace datasets {

constexpr int kCount = 4;

// 0: terrain heights in metres. 1: air temperatures read to 0.01 degrees. 2: land-cover classes 0-8.
// 3: random values between 0 and 1.
inline std::vector<float> make(int index) {
    if (index < 0 || index >= kCount) throw std::invalid_argument("dataset must be 0 to 3");
    if (index == 0) return terrain::heights(0);
    const int size = terrain::kSize;
    std::vector<float> out(static_cast<size_t>(size) * size);
    for (int y = 0; y < size; ++y) {
        for (int x = 0; x < size; ++x) {
            const double fx = x;
            const double fy = y;
            double value = 0;
            if (index == 1) {
                const double t = 14.0 + 6.0 * terrain::noise(fx / 150.0, fy / 150.0, 31u).value + 0.8 * terrain::noise(fx / 12.0, fy / 12.0, 32u).value;
                value = std::floor(t * 100.0 + 0.5) / 100.0;
            } else if (index == 2) {
                value = std::min(std::floor((terrain::noise(fx / 48.0, fy / 48.0, 41u).value + 1.0) * 4.5), 8.0);
            } else {
                value = terrain::hash(x, y, 51u) / 4294967296.0;
            }
            out[static_cast<size_t>(y) * size + x] = static_cast<float>(value);
        }
    }
    return out;
}

}  // namespace datasets
