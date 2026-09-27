#pragma once

#include <proj.h>

#include <stdexcept>
#include <string>

// Reads a CRS from any definition PROJ accepts and writes it out in the formats other software
// reads: WKT2 (ISO 19162, what GDAL and QGIS write), WKT1 the way ESRI writes it (the text of a
// shapefile's .prj), PROJJSON, and the PROJ string.
class CrsFormats {
public:
    explicit CrsFormats(const std::string& definition) : context(proj_context_create()) {
        proj_log_func(context, &error, remember);
        crs = proj_create(context, definition.c_str());
        if (!crs || !proj_is_crs(crs)) {
            const std::string reason = crs ? definition + " is not a CRS" : error.empty() ? "PROJ cannot read " + definition : error;
            proj_destroy(crs);
            proj_context_destroy(context);
            throw std::runtime_error(reason);
        }
    }

    ~CrsFormats() {
        proj_destroy(crs);
        proj_context_destroy(context);
    }

    CrsFormats(const CrsFormats&) = delete;
    CrsFormats& operator=(const CrsFormats&) = delete;

    // "EPSG:32635 WGS 84 / UTM zone 35N"; just the name when the definition carries no code.
    std::string label() const {
        const char* authority = proj_get_id_auth_name(crs, 0);
        const char* code = proj_get_id_code(crs, 0);
        const std::string name = proj_get_name(crs);
        return authority && code ? std::string(authority) + ":" + code + " " + name : name;
    }

    std::string wkt() { return text(proj_as_wkt(context, crs, PJ_WKT2_2019, nullptr)); }
    std::string esriWkt() { return text(proj_as_wkt(context, crs, PJ_WKT1_ESRI, nullptr)); }
    std::string projJson() { return text(proj_as_projjson(context, crs, nullptr)); }
    // A PROJ string keeps the maths and drops the metadata, such as the name and the area of use.
    std::string projString() { return text(proj_as_proj_string(context, crs, PJ_PROJ_5, nullptr)); }

private:
    // The exporters return text owned by the CRS object, so it is copied at once.
    std::string text(const char* exported) const {
        if (!exported) throw std::runtime_error(error.empty() ? "PROJ cannot write this CRS in that format" : error);
        return exported;
    }

    static void remember(void* error, int level, const char* message) {
        if (level == PJ_LOG_ERROR) *static_cast<std::string*>(error) = message;
    }

    PJ_CONTEXT* context;
    PJ* crs = nullptr;
    std::string error;
};
