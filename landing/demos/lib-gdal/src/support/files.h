#pragma once

#include "json.h"

#include <cpl_conv.h>
#include <cpl_string.h>
#include <cpl_vsi.h>

#include <algorithm>
#include <stdexcept>
#include <string>
#include <vector>

namespace files {

// Every regular file under `folder`, as sorted paths relative to it.
inline std::vector<std::string> list(const std::string& folder) {
    std::vector<std::string> names;
    char** entries = VSIReadDirRecursive(folder.c_str());
    for (int i = 0; entries && entries[i]; ++i) {
        VSIStatBufL stat;
        if (VSIStatL((folder + "/" + entries[i]).c_str(), &stat) == 0 && VSI_ISREG(stat.st_mode)) names.push_back(entries[i]);
    }
    CSLDestroy(entries);
    std::sort(names.begin(), names.end());
    return names;
}

inline long long size(const std::string& path) {
    VSIStatBufL stat;
    return VSIStatL(path.c_str(), &stat) == 0 ? static_cast<long long>(stat.st_size) : -1;
}

// What a conversion left in `folder`: a single file is downloaded as it is; several, such as a .gdb
// folder or MapInfo's .tab, .dat, .map and .id, are zipped into <folder>.zip with their relative paths.
inline std::string package(const std::string& folder) {
    const std::vector<std::string> names = list(folder);
    if (names.empty()) throw std::runtime_error("GDAL wrote no file");
    std::string download = folder + "/" + names[0];
    if (names.size() > 1) {
        download = folder + ".zip";
        VSIUnlink(download.c_str());
        void* archive = CPLCreateZip(download.c_str(), nullptr);
        bool written = archive != nullptr;
        for (const std::string& name : names) {
            written = written && CPLAddFileInZip(archive, name.c_str(), (folder + "/" + name).c_str(), nullptr, nullptr, nullptr, nullptr) == CE_None;
        }
        if (!archive || CPLCloseZip(archive) != CE_None || !written) throw std::runtime_error("could not zip " + folder);
    }
    std::vector<std::string> quoted;
    for (const std::string& name : names) quoted.push_back(json::quote(name));
    return json::Object().text("download", download).number("bytes", static_cast<double>(size(download))).raw("files", json::array(quoted)).str();
}

}  // namespace files
