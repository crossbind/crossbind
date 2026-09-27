#pragma once

#include <proj.h>

#include <cstdio>
#include <stdexcept>
#include <string>

// Where a CRS may be used and the order of its axes, both from PROJ's copy of the EPSG registry.
// Axis order is the classic trap: EPSG:4326 is latitude first, and so are many national grids.
class CrsUsage {
public:
    explicit CrsUsage(const std::string& definition) : context(proj_context_create()) {
        proj_log_func(context, &error, remember);
        crs = proj_create(context, definition.c_str());
        if (!crs || !proj_is_crs(crs)) {
            const std::string reason = crs ? definition + " is not a CRS" : error.empty() ? "PROJ cannot read " + definition : error;
            proj_destroy(crs);
            proj_context_destroy(context);
            throw std::runtime_error(reason);
        }
    }

    ~CrsUsage() {
        proj_destroy(crs);
        proj_context_destroy(context);
    }

    CrsUsage(const CrsUsage&) = delete;
    CrsUsage& operator=(const CrsUsage&) = delete;

    // [west, south, east, north, "description"], in degrees.
    std::string areaOfUse() {
        double west, south, east, north;
        const char* name = nullptr;
        if (!proj_get_area_of_use(context, crs, &west, &south, &east, &north, &name)) throw std::runtime_error("this CRS has no area of use");
        char box[128];
        std::snprintf(box, sizeof box, "[%.10g,%.10g,%.10g,%.10g,", west, south, east, north);
        return box + quote(name) + "]";
    }

    // [["Easting","E","east","metre"], ...]: name, abbreviation, direction and unit of each axis,
    // in the order coordinates are written.
    std::string axes() {
        PJ* system = proj_crs_get_coordinate_system(context, crs);
        if (!system) throw std::runtime_error("this CRS has no coordinate system");
        std::string json = "[";
        for (int index = 0; index < proj_cs_get_axis_count(context, system); index += 1) {
            const char* name = nullptr;
            const char* abbreviation = nullptr;
            const char* direction = nullptr;
            const char* unit = nullptr;
            proj_cs_get_axis_info(context, system, index, &name, &abbreviation, &direction, nullptr, &unit, nullptr, nullptr);
            json += std::string(index ? ",[" : "[") + quote(name) + "," + quote(abbreviation) + "," + quote(direction) + "," + quote(unit) + "]";
        }
        proj_destroy(system);
        return json + "]";
    }

private:
    static std::string quote(const char* text) {
        std::string out = "\"";
        for (const char* at = text ? text : ""; *at; at += 1) {
            if (*at == '"' || *at == '\\') out += '\\';
            out += *at;
        }
        return out + "\"";
    }

    static void remember(void* error, int level, const char* message) {
        if (level == PJ_LOG_ERROR) *static_cast<std::string*>(error) = message;
    }

    PJ_CONTEXT* context;
    PJ* crs = nullptr;
    std::string error;
};
