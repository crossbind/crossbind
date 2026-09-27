#pragma once

#include <chrono>
#include <string>
#include <vector>

#include "../support/grid.h"
#include "../support/terrain.h"

// Squeezes a generated elevation model to the error you choose and measures every height that comes
// back. The heights stay in wasm memory; blobs and decoded grids reach the page as files.
class TerrainLab {
public:
    // 0: mountains, 30 m cells. 1: lowland, 2 m cells. Both 512 x 512 float32.
    explicit TerrainLab(int preset) : cell(terrain::preset(preset).cellSize), heights(terrain::heights(preset)) {}

    int size() const { return terrain::kSize; }
    double cellSize() const { return cell; }

    // The original heights as float32, row by row, for the page to draw.
    void writeHeights(const std::string& path) const { grid::write(path, heights.data(), heights.size() * sizeof(float)); }

    // Encodes within maxError metres (0 = lossless) into blobPath: {"bytes","maxErrorUsed","zMin","zMax","ms"}.
    std::string compress(double maxError, const std::string& blobPath) const {
        const auto started = std::chrono::steady_clock::now();
        const std::string blob = grid::encode(heights, terrain::kSize, terrain::kSize, nullptr, maxError);
        const double ms = since(started);
        grid::write(blobPath, blob.data(), blob.size());
        const grid::Header h = grid::header(blob);
        return "{\"bytes\":" + std::to_string(blob.size()) + ",\"maxErrorUsed\":" + grid::number(h.maxZErrorUsed) + ",\"zMin\":" + grid::number(h.zMin) +
               ",\"zMax\":" + grid::number(h.zMax) + ",\"ms\":" + grid::number(ms) + "}";
    }

    // Decodes blobPath into f32Path and compares every height with the original: {"maxError","ms"}.
    std::string decompress(const std::string& blobPath, const std::string& f32Path) const {
        const std::string blob = grid::read(blobPath);
        const auto started = std::chrono::steady_clock::now();
        const std::vector<float> decoded = grid::decode(blob);
        const double ms = since(started);
        grid::write(f32Path, decoded.data(), decoded.size() * sizeof(float));
        return "{\"maxError\":" + grid::number(grid::maxAbsDiff(heights, decoded)) + ",\"ms\":" + grid::number(ms) + "}";
    }

private:
    static double since(std::chrono::steady_clock::time_point started) {
        return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    }

    double cell;
    std::vector<float> heights;
};
