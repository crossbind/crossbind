#pragma once

#include <cstdint>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Whole files in the module's filesystem. The apps pass pixels as paths: the page writes RGBA with
// m.FS.writeFile and reads results back with m.getFileBytes, so megabytes never cross the binding.
namespace files {

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

inline std::vector<uint8_t> read(const std::string& path) {
    File file(std::fopen(path.c_str(), "rb"), std::fclose);
    if (!file) throw std::runtime_error("cannot open " + path);
    std::vector<uint8_t> data;
    std::vector<uint8_t> chunk(1 << 16);
    size_t got = 0;
    while ((got = std::fread(chunk.data(), 1, chunk.size(), file.get())) > 0) data.insert(data.end(), chunk.begin(), chunk.begin() + got);
    if (std::ferror(file.get())) throw std::runtime_error("cannot read " + path);
    return data;
}

inline void write(const std::string& path, const uint8_t* data, size_t size) {
    File file(std::fopen(path.c_str(), "wb"), std::fclose);
    if (!file || (size && std::fwrite(data, 1, size, file.get()) != size)) throw std::runtime_error("cannot write " + path);
}

inline void write(const std::string& path, const std::vector<uint8_t>& data) { write(path, data.data(), data.size()); }

}  // namespace files
