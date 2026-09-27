// A command-line GEOS for WASI: reads shapes from WKT files and prints results as normalised WKT.
//   geos-tool intersection|union|difference <a.wkt> <b.wkt>
//   geos-tool validate <a.wkt>
#include <geos_c.h>

#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

namespace {

GEOSContextHandle_t context;

struct Destroy {
    void operator()(GEOSGeometry* geometry) const { GEOSGeom_destroy_r(context, geometry); }
};
using Geometry = std::unique_ptr<GEOSGeometry, Destroy>;

void report(const char* message, void*) { std::fprintf(stderr, "geos: %s\n", message); }

Geometry read(const char* path) {
    std::ifstream file(path);
    if (!file) {
        std::fprintf(stderr, "cannot open %s\n", path);
        return nullptr;
    }
    std::stringstream text;
    text << file.rdbuf();
    GEOSWKTReader* reader = GEOSWKTReader_create_r(context);
    Geometry geometry(GEOSWKTReader_read_r(context, reader, text.str().c_str()));
    GEOSWKTReader_destroy_r(context, reader);
    return geometry;
}

// Prints the result normalised, with its area; false when GEOS failed (its message is on stderr).
bool print(const std::string& label, GEOSGeometry* result) {
    if (!result) return false;
    const Geometry owned(result);
    GEOSNormalize_r(context, owned.get());
    GEOSWKTWriter* writer = GEOSWKTWriter_create_r(context);
    char* wkt = GEOSWKTWriter_write_r(context, writer, owned.get());
    GEOSWKTWriter_destroy_r(context, writer);
    double area = 0;
    GEOSArea_r(context, owned.get(), &area);
    std::printf("%s: %s, area %g\n", label.c_str(), wkt, area);
    GEOSFree_r(context, wkt);
    return true;
}

int validate(const char* path) {
    const Geometry shape = read(path);
    if (!shape) return 1;
    char* reason = GEOSisValidReason_r(context, shape.get());
    if (!reason) return 1;
    std::printf("validate %s: %s\n", path, reason);
    const bool valid = std::strcmp(reason, "Valid Geometry") == 0;
    GEOSFree_r(context, reason);
    return valid || print("repaired", GEOSMakeValid_r(context, shape.get())) ? 0 : 1;
}

int overlay(const std::string& operation, const char* first, const char* second) {
    const Geometry a = read(first);
    const Geometry b = read(second);
    if (!a || !b) return 1;
    GEOSGeometry* result = operation == "intersection" ? GEOSIntersection_r(context, a.get(), b.get())
                           : operation == "union"      ? GEOSUnion_r(context, a.get(), b.get())
                                                       : GEOSDifference_r(context, a.get(), b.get());
    return print(operation + " " + first + " " + second, result) ? 0 : 1;
}

int run(int argc, char** argv) {
    const std::string operation = argc >= 2 ? argv[1] : "";
    if ((operation == "intersection" || operation == "union" || operation == "difference") && argc >= 4) return overlay(operation, argv[2], argv[3]);
    if (operation == "validate" && argc >= 3) return validate(argv[2]);
    std::fprintf(stderr, "usage: geos-tool intersection|union|difference <a.wkt> <b.wkt>\n       geos-tool validate <a.wkt>\n");
    return 2;
}

}  // namespace

int main(int argc, char** argv) {
    context = GEOS_init_r();
    GEOSContext_setErrorMessageHandler_r(context, report, nullptr);
    const int code = run(argc, argv);
    GEOS_finish_r(context);
    return code;
}
