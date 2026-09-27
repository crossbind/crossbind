#pragma once

#include <cpl_error.h>
#include <cpl_string.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <gdal_frmts.h>
#include <gdal_utils.h>

#include <cstdio>
#include <stdexcept>
#include <string>

// Reprojects a raster as the gdalwarp tool does, then writes it as gdal_translate -of COG does: a
// Cloud-Optimized GeoTIFF, tiled and compressed, with overviews laid out so that a client can read
// one area at one zoom level with a few HTTP range requests.
class CogWriter {
public:
    CogWriter() {
        GDALRegister_GTiff();
        GDALRegister_COG();
        GDALRegister_VRT();
    }

    std::string warpToCog(const std::string& source, const std::string& targetCrs, const std::string& output) {
        GDALDatasetH input = GDALOpenEx(source.c_str(), GDAL_OF_RASTER, nullptr, nullptr, nullptr);
        if (!input) fail();

        // gdalwarp -of VRT: the reprojected raster stays virtual and is computed while the COG is written.
        CPLStringList warpArgs;
        for (const char* arg : {"-of", "VRT", "-r", "bilinear", "-t_srs"}) warpArgs.AddString(arg);
        warpArgs.AddString(targetCrs.c_str());
        GDALWarpAppOptions* warpOptions = GDALWarpAppOptionsNew(warpArgs.List(), nullptr);
        GDALDatasetH warped = GDALWarp("", nullptr, 1, &input, warpOptions, nullptr);
        GDALWarpAppOptionsFree(warpOptions);
        if (!warped) {
            GDALClose(input);
            fail();
        }

        CPLStringList cogArgs;
        for (const char* arg : {"-of", "COG", "-co", "COMPRESS=DEFLATE", "-co", "BLOCKSIZE=256"}) cogArgs.AddString(arg);
        GDALTranslateOptions* cogOptions = GDALTranslateOptionsNew(cogArgs.List(), nullptr);
        VSIUnlink(output.c_str());
        GDALDatasetH cog = GDALTranslate(output.c_str(), warped, cogOptions, nullptr);
        GDALTranslateOptionsFree(cogOptions);
        GDALClose(warped);
        GDALClose(input);
        if (!cog) fail();
        GDALClose(cog);
        return describe(output);
    }

private:
    // What a reader of the file sees.
    static std::string describe(const std::string& path) {
        GDALDatasetH dataset = GDALOpenEx(path.c_str(), GDAL_OF_RASTER, nullptr, nullptr, nullptr);
        if (!dataset) fail();
        GDALRasterBandH band = GDALGetRasterBand(dataset, 1);
        double t[6];
        GDALGetGeoTransform(dataset, t);
        int blockWidth = 0, blockHeight = 0;
        GDALGetBlockSize(band, &blockWidth, &blockHeight);
        const char* layout = GDALGetMetadataItem(dataset, "LAYOUT", "IMAGE_STRUCTURE");
        const char* compression = GDALGetMetadataItem(dataset, "COMPRESSION", "IMAGE_STRUCTURE");

        char line[200];
        std::snprintf(line, sizeof line, "%d x %d pixels of %.6f x %.6f degrees\nLAYOUT=%s, COMPRESSION=%s, %d x %d blocks\noverviews",
                      GDALGetRasterXSize(dataset), GDALGetRasterYSize(dataset), t[1], -t[5], layout ? layout : "none",
                      compression ? compression : "none", blockWidth, blockHeight);
        std::string text = line;
        for (int i = 0; i < GDALGetOverviewCount(band); ++i) {
            GDALRasterBandH overview = GDALGetOverview(band, i);
            text += (i ? ", " : " ") + std::to_string(GDALGetRasterBandXSize(overview)) + " x " + std::to_string(GDALGetRasterBandYSize(overview));
        }
        GDALClose(dataset);
        return text;
    }

    [[noreturn]] static void fail() {
        const std::string reason = CPLGetLastErrorMsg();
        throw std::runtime_error(reason.empty() ? "GDAL could not write the COG" : reason);
    }
};
