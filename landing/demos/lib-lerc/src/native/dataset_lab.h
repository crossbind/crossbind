#pragma once

#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/datasets.h"
#include "../support/grid.h"

// Four kinds of float32 raster, stored with LERC and read back. The page compresses the same bytes
// with the browser's own gzip, so both sides of the comparison run in the tab.
class DatasetLab {
public:
    // 0: terrain heights (m). 1: air temperatures read to 0.01 degrees. 2: land-cover classes 0-8. 3: random values 0-1.
    DatasetLab() {
        for (int index = 0; index < datasets::kCount; ++index) sets.push_back(datasets::make(index));
    }

    // One dataset's raw float32, row by row, for the page's gzip.
    void write(int dataset, const std::string& path) const {
        const std::vector<float>& values = at(dataset);
        grid::write(path, values.data(), values.size() * sizeof(float));
    }

    // LERC within maxError (0 = lossless), decoded back and compared: {"bytes","maxErrorUsed","maxError","identical"}.
    std::string compress(int dataset, double maxError) const {
        const std::vector<float>& values = at(dataset);
        const std::string blob = grid::encode(values, terrain::kSize, terrain::kSize, nullptr, maxError);
        const std::vector<float> back = grid::decode(blob);
        const bool identical = std::memcmp(back.data(), values.data(), values.size() * sizeof(float)) == 0;
        return "{\"bytes\":" + std::to_string(blob.size()) + ",\"maxErrorUsed\":" + grid::number(grid::header(blob).maxZErrorUsed) +
               ",\"maxError\":" + grid::number(grid::maxAbsDiff(values, back)) + ",\"identical\":" + (identical ? "true" : "false") + "}";
    }

private:
    const std::vector<float>& at(int dataset) const {
        if (dataset < 0 || dataset >= datasets::kCount) throw std::invalid_argument("dataset must be 0 to 3");
        return sets[static_cast<size_t>(dataset)];
    }

    std::vector<std::vector<float>> sets;
};
