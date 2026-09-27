#pragma once

#include <proj.h>

#include <stdexcept>
#include <string>

// Finds CRSs in PROJ's copy of the EPSG registry: the code that a .prj file or any WKT describes,
// and the projected CRSs that may be used at a point.
class CrsLookup {
public:
    // [["EPSG:32635","WGS 84 / UTM zone 35N",100], ...]: code, name and confidence, best match
    // first. The confidence is 100 when the definition matches an EPSG entry exactly, names
    // included, and lower as details are missing or differ.
    static std::string identify(const std::string& definition) {
        Session proj;
        PJ* crs = proj.create(definition);
        int* confidence = nullptr;
        PJ_OBJ_LIST* matches = proj_identify(proj.context, crs, "EPSG", nullptr, &confidence);
        std::string json = "[";
        for (int index = 0; matches && index < proj_list_get_count(matches); index += 1) {
            PJ* match = proj_list_get(proj.context, matches, index);
            json += std::string(index ? ",[" : "[") + entry(proj_get_id_auth_name(match, 0), proj_get_id_code(match, 0), proj_get_name(match)) + "," +
                    std::to_string(confidence[index]) + "]";
            proj_destroy(match);
        }
        proj_int_list_destroy(confidence);
        proj_list_destroy(matches);
        proj_destroy(crs);
        return json + "]";
    }

    // [["EPSG:32635","WGS 84 / UTM zone 35N"], ...]: the projected CRSs whose area of use
    // contains the point and whose name contains `words`, deprecated ones left out.
    static std::string projectedAt(double lat, double lon, const std::string& words) {
        Session proj;
        PROJ_CRS_LIST_PARAMETERS* filter = proj_get_crs_list_parameters_create();
        const PJ_TYPE projected = PJ_TYPE_PROJECTED_CRS;
        filter->types = &projected;
        filter->typesCount = 1;
        filter->bbox_valid = 1;
        filter->west_lon_degree = filter->east_lon_degree = lon;
        filter->south_lat_degree = filter->north_lat_degree = lat;
        filter->crs_area_of_use_contains_bbox = 1;
        int count = 0;
        PROJ_CRS_INFO** found = proj_get_crs_info_list_from_database(proj.context, "EPSG", filter, &count);
        std::string json = "[";
        for (int index = 0; index < count; index += 1) {
            const PROJ_CRS_INFO* crs = found[index];
            if (std::string(crs->name).find(words) == std::string::npos) continue;
            json += std::string(json.size() > 1 ? ",[" : "[") + entry(crs->auth_name, crs->code, crs->name) + "]";
        }
        proj_crs_info_list_destroy(found);
        proj_get_crs_list_parameters_destroy(filter);
        return json + "]";
    }

private:
    // One PROJ context per call; it also keeps the last error PROJ logged.
    struct Session {
        PJ_CONTEXT* context = proj_context_create();
        std::string error;

        Session() { proj_log_func(context, &error, remember); }
        ~Session() { proj_context_destroy(context); }
        Session(const Session&) = delete;
        Session& operator=(const Session&) = delete;

        PJ* create(const std::string& definition) {
            PJ* crs = proj_create(context, definition.c_str());
            if (crs && proj_is_crs(crs)) return crs;
            proj_destroy(crs);
            throw std::runtime_error(error.empty() ? "PROJ cannot read this CRS definition" : error);
        }

        static void remember(void* error, int level, const char* message) {
            if (level == PJ_LOG_ERROR) *static_cast<std::string*>(error) = message;
        }
    };

    // "EPSG:32635","WGS 84 / UTM zone 35N"
    static std::string entry(const char* authority, const char* code, const char* name) {
        const std::string id = authority && code ? std::string(authority) + ":" + code : "";
        return quote(id.c_str()) + "," + quote(name);
    }

    static std::string quote(const char* text) {
        std::string out = "\"";
        for (const char* at = text ? text : ""; *at; at += 1) {
            if (*at == '"' || *at == '\\') out += '\\';
            out += *at;
        }
        return out + "\"";
    }
};
