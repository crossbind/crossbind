#pragma once

#include "../support/drivers.h"
#include "../support/files.h"
#include "../support/json.h"
#include "../support/vector_sample.h"

#include <cpl_conv.h>
#include <cpl_error.h>
#include <cpl_string.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <gdal_utils.h>

#include <algorithm>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// The vector converter on crossbind.dev/ports/gdal/: which formats GDAL reads and writes here, what
// a file holds (ogrinfo) and a conversion of it (ogr2ogr), all in the page.
class VectorStudio {
public:
    VectorStudio() { registerVectorDrivers(); }

    static std::string version() { return GDALVersionInfo("RELEASE_NAME"); }

    // The file formats this module registered, by name, with whether GDAL writes them and puts several
    // layers in one file.
    static std::string formats() {
        std::vector<std::pair<std::string, std::string>> found;
        for (int i = 0; i < GDALGetDriverCount(); ++i) {
            GDALDriverH driver = GDALGetDriver(i);
            const char* extensions = GDALGetMetadataItem(driver, GDAL_DMD_EXTENSIONS, nullptr);
            if (!GDALGetMetadataItem(driver, GDAL_DCAP_VECTOR, nullptr) || !extensions) continue;
            found.emplace_back(GDALGetDriverShortName(driver), json::Object()
                                .text("name", GDALGetDriverShortName(driver))
                                .text("description", GDALGetDriverLongName(driver))
                                .text("extensions", extensions)
                                .flag("write", GDALGetMetadataItem(driver, GDAL_DCAP_CREATE, nullptr) != nullptr)
                                .flag("layers", GDALGetMetadataItem(driver, GDAL_DCAP_MULTIPLE_VECTOR_LAYERS, nullptr) != nullptr)
                                .str());
        }
        std::sort(found.begin(), found.end());
        std::vector<std::string> sorted;
        for (const auto& format : found) sorted.push_back(format.second);
        return json::array(sorted);
    }

    static std::string writeSample(const std::string& path) {
        sample::write(path);
        return path;
    }

    // What to open for a dropped file, or for the folder its companions were dropped into: a zip or
    // KMZ is looked into, a .gdb folder opens as one geodatabase, shapefile parts open as their folder,
    // anything else as the first file one of the registered drivers recognises.
    static std::string resolve(const std::string& path) {
        const std::string lower = CPLString(path).tolower();
        const bool zipped = CPLString(lower).endsWith(".zip") || CPLString(lower).endsWith(".kmz");
        VSIStatBufL stat;
        if (!zipped && VSIStatL(path.c_str(), &stat) == 0 && !VSI_ISDIR(stat.st_mode)) return path;
        const std::string root = zipped ? "/vsizip/" + path : path;
        const CPLStringList entries(VSIReadDirRecursive(root.c_str()));
        std::string recognised;
        bool shapefile = false;
        for (int i = 0; i < entries.size(); ++i) {
            const std::string entry = entries[i];
            const std::string name = CPLString(entry).tolower();
            const size_t gdb = name.find(".gdb");
            if (gdb != std::string::npos) return root + "/" + entry.substr(0, gdb + 4);
            shapefile = shapefile || CPLString(name).endsWith(".shp");
            const std::string full = root + "/" + entry;
            if (recognised.empty() && GDALIdentifyDriverEx(full.c_str(), GDAL_OF_VECTOR, nullptr, nullptr)) recognised = full;
        }
        return shapefile || recognised.empty() ? root : recognised;
    }

    // ogrinfo -json -so: the layers, their feature counts, geometry types, extents, CRS and fields.
    static std::string inspect(const std::string& path) {
        GDALDatasetH dataset = open(path);
        CPLStringList args;
        for (const char* arg : {"-json", "-so", "-nomd"}) args.AddString(arg);
        GDALVectorInfoOptions* options = GDALVectorInfoOptionsNew(args.List(), nullptr);
        char* info = GDALVectorInfo(dataset, options);
        GDALVectorInfoOptionsFree(options);
        GDALClose(dataset);
        if (!info) fail("GDAL could not describe " + path);
        const std::string text = info;
        CPLFree(info);
        return text;
    }

    // ogr2ogr <output> <input> <arguments>, one argument per line. `output` lies in a folder of its
    // own; the result names the file to download, zipped when GDAL wrote several.
    static std::string convert(const std::string& input, const std::string& output, const std::string& arguments) {
        GDALDatasetH source = open(input);
        CPLStringList args(CSLTokenizeString2(arguments.c_str(), "\n", CSLT_ALLOWEMPTYTOKENS));
        GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
        if (!options) {
            GDALClose(source);
            fail("GDAL did not accept the options");
        }
        GDALDatasetH written = GDALVectorTranslate(output.c_str(), nullptr, 1, &source, options, nullptr);
        GDALVectorTranslateOptionsFree(options);
        GDALClose(source);
        if (!written) fail("GDAL could not write " + output);
        GDALClose(written);
        return files::package(CPLGetPathSafe(output.c_str()));
    }

    // One layer as GeoJSON for drawing: in WGS 84 when the layer has a CRS, at most `limit` features.
    static std::string preview(const std::string& input, const std::string& layer, int limit) {
        GDALDatasetH source = open(input);
        OGRLayerH found = GDALDatasetGetLayerByName(source, layer.c_str());
        if (!found) {
            GDALClose(source);
            fail("no layer named " + layer);
        }
        CPLStringList args;
        for (const char* arg : {"-f", "GeoJSON", "-lco", "COORDINATE_PRECISION=6", "-limit"}) args.AddString(arg);
        args.AddString(std::to_string(limit).c_str());
        if (OGR_L_GetSpatialRef(found)) {
            args.AddString("-t_srs");
            args.AddString("EPSG:4326");
        }
        args.AddString(layer.c_str());
        const char* target = "/vsimem/preview.geojson";
        GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
        VSIUnlink(target);
        GDALDatasetH written = GDALVectorTranslate(target, nullptr, 1, &source, options, nullptr);
        GDALVectorTranslateOptionsFree(options);
        GDALClose(source);
        if (!written) fail("GDAL could not draw " + layer);
        GDALClose(written);
        vsi_l_offset length = 0;
        GByte* bytes = VSIGetMemFileBuffer(target, &length, FALSE);
        const std::string text(reinterpret_cast<const char*>(bytes), static_cast<size_t>(length));
        VSIUnlink(target);
        return text;
    }

private:
    static GDALDatasetH open(const std::string& path) {
        CPLErrorReset();
        GDALDatasetH dataset = GDALOpenEx(path.c_str(), GDAL_OF_VECTOR, nullptr, nullptr, nullptr);
        if (!dataset) fail("GDAL has no driver here that reads " + path);
        return dataset;
    }

    [[noreturn]] static void fail(const std::string& fallback) {
        const std::string reason = CPLGetLastErrorMsg();
        throw std::runtime_error(reason.empty() ? fallback : reason);
    }
};
