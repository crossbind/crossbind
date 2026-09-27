// A command-line PROJ for WASI: describes a CRS from proj.db, or transforms the points of a file.
//   proj-tool info <crs>
//   proj-tool <source crs> <target crs> <points file>
// A points file has one "x y label" per line, longitude or easting first whatever the CRS's axis order.
#include <proj.h>

#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

namespace {

void report(void*, int level, const char* message) {
    if (level == PJ_LOG_ERROR) std::fprintf(stderr, "proj: %s\n", message);
}

int info(PJ_CONTEXT* context, const char* definition) {
    PJ* crs = proj_create(context, definition);
    if (!crs) return 1;
    std::printf("%s\n", proj_get_name(crs));
    double west, south, east, north;
    const char* area = nullptr;
    if (proj_get_area_of_use(context, crs, &west, &south, &east, &north, &area)) std::printf("area: %g %g %g %g, %s\n", west, south, east, north, area);
    PJ* system = proj_crs_get_coordinate_system(context, crs);
    std::printf("axes:");
    for (int index = 0; system && index < proj_cs_get_axis_count(context, system); index += 1) {
        const char* abbreviation = nullptr;
        const char* direction = nullptr;
        proj_cs_get_axis_info(context, system, index, nullptr, &abbreviation, &direction, nullptr, nullptr, nullptr, nullptr);
        std::printf("%s %s %s", index ? "," : "", abbreviation, direction);
    }
    std::printf("\n");
    proj_destroy(system);
    proj_destroy(crs);
    return 0;
}

int transform(PJ_CONTEXT* context, const char* source, const char* target, const char* path) {
    std::ifstream file(path);
    if (!file) {
        std::fprintf(stderr, "cannot open %s\n", path);
        return 1;
    }
    PJ* chosen = proj_create_crs_to_crs(context, source, target, nullptr);
    if (!chosen) return 1;
    std::printf("%s\n", proj_get_name(chosen));
    PJ* transformation = proj_normalize_for_visualization(context, chosen);
    proj_destroy(chosen);
    if (!transformation) return 1;
    std::string line;
    while (std::getline(file, line)) {
        std::istringstream fields(line);
        double x, y;
        if (!(fields >> x >> y)) continue;
        std::string label;
        std::getline(fields >> std::ws, label);
        const PJ_COORD out = proj_trans(transformation, PJ_FWD, proj_coord(x, y, 0, HUGE_VAL));
        if (out.xy.x == HUGE_VAL) {
            std::printf("%s: %s\n", label.c_str(), proj_context_errno_string(context, proj_errno(transformation)));
        } else {
            std::printf("%s: %.2f %.2f\n", label.c_str(), out.xy.x, out.xy.y);
        }
    }
    proj_destroy(transformation);
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    PJ_CONTEXT* context = proj_context_create();
    proj_log_func(context, nullptr, report);
    const std::string command = argc >= 2 ? argv[1] : "";
    int code = 2;
    if (command == "info" && argc == 3) {
        code = info(context, argv[2]);
    } else if (command != "info" && argc == 4) {
        code = transform(context, argv[1], argv[2], argv[3]);
    } else {
        std::fprintf(stderr, "usage: proj-tool info <crs>\n       proj-tool <source crs> <target crs> <points file>\n");
    }
    proj_context_destroy(context);
    return code;
}
