#pragma once

#include <proj.h>

#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <string>

// Converts coordinates between two coordinate reference systems given as EPSG or ESRI codes, WKT,
// PROJJSON or PROJ strings. Axis order is normalised to longitude or easting first, so EPSG:4326
// takes (longitude, latitude) although EPSG defines it latitude first.
class Transformer {
public:
    Transformer(const std::string& source, const std::string& target) : context(proj_context_create()) {
        proj_log_func(context, &error, remember);
        PJ* chosen = proj_create_crs_to_crs(context, source.c_str(), target.c_str(), nullptr);
        if (chosen) {
            name = proj_get_name(chosen);
            transformation = proj_normalize_for_visualization(context, chosen);
            proj_destroy(chosen);
        }
        if (!transformation) {
            const std::string reason = error.empty() ? proj_context_errno_string(context, proj_context_errno(context)) : error;
            proj_context_destroy(context);
            throw std::runtime_error(reason);
        }
    }

    ~Transformer() {
        proj_destroy(transformation);
        proj_context_destroy(context);
    }

    Transformer(const Transformer&) = delete;
    Transformer& operator=(const Transformer&) = delete;

    // Both return the point as a JSON array, [x, y].
    std::string forward(double x, double y) { return apply(PJ_FWD, x, y); }
    std::string inverse(double x, double y) { return apply(PJ_INV, x, y); }

    // The operation PROJ picked, e.g. "UTM zone 35N".
    std::string operation() const { return name; }

private:
    std::string apply(PJ_DIRECTION direction, double x, double y) {
        proj_errno_reset(transformation);
        const PJ_COORD out = proj_trans(transformation, direction, proj_coord(x, y, 0, HUGE_VAL));
        if (out.xy.x == HUGE_VAL) throw std::runtime_error(proj_context_errno_string(context, proj_errno(transformation)));
        char json[64];
        std::snprintf(json, sizeof json, "[%.17g,%.17g]", out.xy.x, out.xy.y);
        return json;
    }

    // PROJ reports why a definition failed through its log, e.g. "crs not found: EPSG:99999".
    static void remember(void* error, int level, const char* message) {
        if (level == PJ_LOG_ERROR) *static_cast<std::string*>(error) = message;
    }

    PJ_CONTEXT* context;
    PJ* transformation = nullptr;
    std::string name;
    std::string error;
};
