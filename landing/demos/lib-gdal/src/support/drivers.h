#pragma once

#include <gdal_frmts.h>
#include <ogrsf_frmts.h>

// The drivers the apps on crossbind.dev/ports/gdal/ register, one call each. Each registration links
// that driver into the module; GDALAllRegister() would link every driver GDAL was built with.
inline void registerRasterDrivers() {
    GDALRegister_MEM();
    GDALRegister_GTiff();
    GDALRegister_COG();
    GDALRegister_PNG();
    GDALRegister_VRT();
}

inline void registerVectorDrivers() {
    RegisterOGRGeoJSON();
    RegisterOGRGeoJSONSeq();
    RegisterOGRESRIJSON();
    RegisterOGRTopoJSON();
    RegisterOGRShape();
    RegisterOGRGeoPackage();
    RegisterOGRFlatGeobuf();
    RegisterOGRKML();
    RegisterOGRGPX();
    RegisterOGRCSV();
    RegisterOGRDXF();
    RegisterOGROpenFileGDB();
    RegisterOGRXLSX();
    RegisterOGRODS();
    RegisterOGRGML();
    RegisterOGRTAB();
    RegisterOGRSQLite();
    RegisterOGRMVT();
    RegisterOGRPMTiles();
    RegisterOGRJSONFG();
}
