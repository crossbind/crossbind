// Link-time redirects for the crossbind.dev module, enabled by -Wl,--wrap in crossbind.config.js.
#include "../support/drivers.h"

#include <cstdlib>
#include <functional>

extern "C" {
// GDALDataset::ExecuteSQL reaches GDALAllRegister through the SQLite dialect's geocoding functions,
// which would link every driver GDAL was built with. This module registers only its own.
void __wrap_GDALAllRegister() {
    registerRasterDrivers();
    registerVectorDrivers();
}

// GPKG, OpenFileGDB and COG declare "gdal driver ..." subcommands at registration, which links the
// whole gdal command-line framework. Nothing in a page runs those subcommands.
void __wrap__ZN10GDALDriver16DeclareAlgorithmERKNSt3__26vectorINS0_12basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEENS5_IS7_EEEE(void*, const void*) {}

// The same framework's registry, which GDALAlgorithm reaches for subcommands. No page code runs one.
void* __wrap__ZN27GDALGlobalAlgorithmRegistry12GetSingletonEv() { std::abort(); }

// A single-threaded build has no worker threads: GDAL's thread pool would queue jobs that never run,
// and gdal_viewshed, which always splits its scan into jobs, would wait forever. Run each job in place.
bool __wrap__ZN11CPLJobQueue9SubmitJobENSt3__28functionIFvvEEE(void*, std::function<void()>* task) {
    (*task)();
    return true;
}
bool __wrap__ZN19CPLWorkerThreadPool9SubmitJobENSt3__28functionIFvvEEE(void*, std::function<void()>* task) {
    (*task)();
    return true;
}
}
