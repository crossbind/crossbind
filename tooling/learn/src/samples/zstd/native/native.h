#pragma once

#include <string>
#include <vector>
#include <zstd.h>

// zstd is a dependency of the project: include its header and
// call it. JavaScript calls the two functions defined here.
inline int compressedSize(const std::string &text) {
    std::vector<char> out(ZSTD_compressBound(text.size()));
    return ZSTD_compress(out.data(), out.size(), text.data(),
                         text.size(), 3);
}

inline std::string zstdVersion() {
    return ZSTD_versionString();
}
