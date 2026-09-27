// A small ogrinfo and ogr2ogr: `info <file>` prints what a vector file holds, one line per layer;
// `convert <input> <output> <format> <crs>` writes it in another format and coordinate system.
#include <cpl_error.h>
#include <cpl_string.h>
#include <gdal.h>
#include <gdal_utils.h>
#include <ogr_api.h>
#include <ogr_srs_api.h>
#include <ogrsf_frmts.h>

#include <cstdio>
#include <cstring>
#include <string>

namespace {

void registerDrivers() {
    RegisterOGRGeoJSON();
    RegisterOGRGeoPackage();
    RegisterOGRShape();
    RegisterOGRFlatGeobuf();
    RegisterOGRCSV();
    RegisterOGRKML();
}

int failed(const char* what) {
    std::fprintf(stderr, "%s: %s\n", what, CPLGetLastErrorMsg());
    return 1;
}

// name: count type, CRS, extent; degrees to 4 decimals, metres to whole numbers.
void describe(GDALDatasetH dataset) {
    for (int i = 0; i < GDALDatasetGetLayerCount(dataset); ++i) {
        OGRLayerH layer = GDALDatasetGetLayer(dataset, i);
        OGREnvelope extent;
        OGR_L_GetExtent(layer, &extent, TRUE);
        OGRSpatialReferenceH crs = OGR_L_GetSpatialRef(layer);
        const char* authority = crs ? OSRGetAuthorityName(crs, nullptr) : nullptr;
        const char* code = crs ? OSRGetAuthorityCode(crs, nullptr) : nullptr;
        const std::string crsName = authority && code ? std::string(authority) + ":" + code : "no CRS";
        const int decimals = crs && OSRIsGeographic(crs) ? 4 : 0;
        std::printf("%s: %lld %s, %s, extent %.*f %.*f %.*f %.*f\n", OGR_L_GetName(layer), static_cast<long long>(OGR_L_GetFeatureCount(layer, TRUE)),
                    OGRGeometryTypeToName(OGR_L_GetGeomType(layer)), crsName.c_str(), decimals, extent.MinX, decimals, extent.MinY, decimals, extent.MaxX,
                    decimals, extent.MaxY);
    }
}

int info(const char* path) {
    GDALDatasetH dataset = GDALOpenEx(path, GDAL_OF_VECTOR, nullptr, nullptr, nullptr);
    if (!dataset) return failed(path);
    describe(dataset);
    GDALClose(dataset);
    return 0;
}

int convert(const char* input, const char* output, const char* format, const char* crs) {
    GDALDatasetH source = GDALOpenEx(input, GDAL_OF_VECTOR, nullptr, nullptr, nullptr);
    if (!source) return failed(input);
    CPLStringList args;
    for (const char* arg : {"-f", format, "-t_srs", crs}) args.AddString(arg);
    GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
    GDALDatasetH written = GDALVectorTranslate(output, nullptr, 1, &source, options, nullptr);
    GDALVectorTranslateOptionsFree(options);
    GDALClose(source);
    if (!written) return failed(output);
    std::printf("wrote %s as %s\n", output, format);
    GDALClose(written);
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    registerDrivers();
    if (argc == 3 && std::strcmp(argv[1], "info") == 0) return info(argv[2]);
    if (argc == 6 && std::strcmp(argv[1], "convert") == 0) return convert(argv[2], argv[3], argv[4], argv[5]);
    std::fprintf(stderr, "usage: %s info <file>\n       %s convert <input> <output> <format> <crs>\n", argv[0], argv[0]);
    return 2;
}
