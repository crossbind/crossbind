#ifndef _REMOTE_RASTER_H
#define _REMOTE_RASTER_H

#include <cpl_conv.h>
#include <cpl_error.h>
#include <cpl_string.h>
#include <gdal.h>

#include <numeric>
#include <string>
#include <vector>

// GDAL reads a raster over HTTP, which drives curl's multi interface: /vsicurl/ and /vsis3/ through
// GDAL's file layer, the WMS driver by itself. `options` holds GDAL configuration options as
// "KEY=VALUE|KEY=VALUE". The answer is the raster's size and the sum of its first band, or GDAL's
// error. A fixture of its own keeps GDAL out of the fixtures that share src/native, which link none
// of it.
class RemoteRaster {
public:
  static std::string read(std::string name, std::string options) {
    GDALAllRegister();
    configure(options);
    CPLErrorReset();
    GDALDatasetH dataset = GDALOpen(name.c_str(), GA_ReadOnly);
    if (!dataset) return failure();
    int width = GDALGetRasterXSize(dataset);
    int height = GDALGetRasterYSize(dataset);
    std::vector<unsigned char> pixels(static_cast<size_t>(width) * height);
    CPLErr result = GDALRasterIO(GDALGetRasterBand(dataset, 1), GF_Read, 0, 0, width, height,
                                 pixels.data(), width, height, GDT_Byte, 0, 0);
    GDALClose(dataset);
    if (result != CE_None) return failure();
    long sum = std::accumulate(pixels.begin(), pixels.end(), 0L);
    return std::to_string(width) + "x" + std::to_string(height) + " sum=" + std::to_string(sum);
  }

private:
  static void configure(const std::string& options) {
    char **pairs = CSLTokenizeString2(options.c_str(), "|", 0);
    for (char **pair = pairs; pair && *pair; ++pair) {
      char *key = nullptr;
      const char *value = CPLParseNameValue(*pair, &key);
      if (key && value) CPLSetConfigOption(key, value);
      CPLFree(key);
    }
    CSLDestroy(pairs);
  }

  static std::string failure() { return std::string("error: ") + CPLGetLastErrorMsg(); }
};

#endif
