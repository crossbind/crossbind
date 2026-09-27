#pragma once

#include <proj.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "../support/proj_context.h"
#include "../support/proj_json.h"

// The CRS detective on crossbind.dev/ports/proj/: paste a .prj, WKT, PROJJSON, a PROJ string or a
// code, and see what PROJ's copy of the EPSG registry knows about it: the code it matches, where
// it applies, its axes, the same CRS in other formats, and every operation PROJ knows to another
// CRS, including the ones this build cannot run because their grid files are not shipped.
class CrsDetective {
public:
    CrsDetective() {}

    // A JSON object: proj (the library version), epsg and epsgDate (the registry version), and
    // crs, how many CRSs each authority has in proj.db, deprecated ones left out.
    std::string versions() {
        // Each call reuses PROJ's buffer, so the first answer is copied before the second.
        const std::string epsg = metadata("EPSG.VERSION");
        const std::string date = metadata("EPSG.DATE");
        std::map<std::string, int> counts;
        for (const Entry& entry : registry()) counts[entry.authority] += 1;
        projapp::JsonObject perAuthority;
        for (const auto& count : counts) perAuthority.number(count.first.c_str(), count.second);
        return projapp::JsonObject().text("proj", proj_info().version).text("epsg", epsg).text("epsgDate", date).raw("crs", perAuthority.json()).json();
    }

    // A JSON object: name, type, code, deprecated, identified (up to five registry matches with
    // their confidence), area (west, south, east, north, name, or null) and areaFrom (the code it
    // came from when the definition carries none), axes, datum, ellipsoid, and formats (wkt2,
    // esri, projjson, proj; null where PROJ cannot write the CRS that way).
    std::string inspect(const std::string& definition) {
        projapp::Object crs = proj.crs(definition);
        if (proj_get_type(crs.get()) == PJ_TYPE_BOUND_CRS) crs = proj.own(proj_get_source_crs(proj.get(), crs.get()), "PROJ cannot unwrap this CRS");
        const std::string identified = identify(crs.get());
        // A .prj carries no area of use; the best match in the registry does.
        std::string areaFrom = "definition";
        std::string area = areaOf(crs.get());
        if (area == "null" && bestMatch) {
            area = areaOf(bestMatch.get());
            areaFrom = bestCode;
        }
        const projapp::Object datum(proj_crs_get_datum_forced(proj.get(), crs.get()));
        const projapp::Object ellipsoid(proj_get_ellipsoid(proj.get(), crs.get()));
        double semiMajor = 0, semiMinor = 0, inverseFlattening = 0;
        int computed = 0;
        std::string shape = "null";
        if (ellipsoid && proj_ellipsoid_get_parameters(proj.get(), ellipsoid.get(), &semiMajor, &semiMinor, &computed, &inverseFlattening)) {
            shape = projapp::JsonObject().text("name", proj_get_name(ellipsoid.get())).number("semiMajor", semiMajor).number("inverseFlattening", inverseFlattening).json();
        }
        const std::string formats = projapp::JsonObject()
                                        .raw("wkt2", text(proj_as_wkt(proj.get(), crs.get(), PJ_WKT2_2019, nullptr)))
                                        .raw("esri", text(proj_as_wkt(proj.get(), crs.get(), PJ_WKT1_ESRI, nullptr)))
                                        .raw("projjson", text(proj_as_projjson(proj.get(), crs.get(), nullptr)))
                                        .raw("proj", text(proj_as_proj_string(proj.get(), crs.get(), PJ_PROJ_5, nullptr)))
                                        .json();
        return projapp::JsonObject()
            .text("name", proj_get_name(crs.get()))
            .text("type", typeName(proj_get_type(crs.get())))
            .text("code", codeOf(crs.get()))
            .flag("deprecated", proj_is_deprecated(crs.get()))
            .raw("identified", identified)
            .raw("area", area)
            .text("areaFrom", area == "null" ? "" : areaFrom)
            .raw("axes", axes(crs.get()))
            .raw("datum", datum ? projapp::quote(proj_get_name(datum.get())) : "null")
            .raw("ellipsoid", shape)
            .raw("formats", formats)
            .json();
    }

    // A JSON object with three fields. known: every operation the registry has between the two
    // CRSs where their areas overlap, as if every grid file were installed. runnable: what PROJ
    // builds with the grids this build has, which can route through WGS 84 instead. Each
    // operation has name, code, accuracy (metres, -1 when unknown), conversion (a projection
    // alone, exact by definition), usable, ballpark and grids (name, available), best first.
    // chosen: the operation proj_trans runs at the centre of the area both CRSs cover, with that
    // point and its result, or null.
    std::string operations(const std::string& source, const std::string& target) {
        const projapp::Object from = proj.crs(source);
        const projapp::Object to = proj.crs(target);
        return projapp::JsonObject()
            .raw("known", candidates(from.get(), to.get(), PROJ_GRID_AVAILABILITY_IGNORED))
            .raw("runnable", candidates(from.get(), to.get(), PROJ_GRID_AVAILABILITY_DISCARD_OPERATION_IF_MISSING_GRID))
            .raw("chosen", chosen(from.get(), to.get()))
            .json();
    }

    // Up to `limit` CRSs whose code or name contains the text, ignoring case, each with code,
    // name and type. An exact code comes first, then names that start with the text, then the
    // rest; within each, EPSG before the other authorities and shorter names first.
    std::string search(const std::string& text, int limit) {
        const std::string wanted = lowered(text);
        if (wanted.empty()) return "[]";
        std::vector<std::pair<std::pair<int, size_t>, const Entry*>> hits;
        for (const Entry& entry : registry()) {
            const std::string code = lowered(entry.authority + ":" + entry.code);
            const size_t at = lowered(entry.name).find(wanted);
            int rank;
            if (code == wanted || lowered(entry.code) == wanted) rank = 0;
            else if (at == 0) rank = 1;
            else if (at != std::string::npos || code.find(wanted) != std::string::npos) rank = 2;
            else continue;
            hits.push_back({{rank * 2 + (entry.authority == "EPSG" ? 0 : 1), entry.name.size()}, &entry});
        }
        std::stable_sort(hits.begin(), hits.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
        std::vector<std::string> found;
        for (size_t index = 0; index < hits.size() && static_cast<int>(index) < limit; index += 1) {
            const Entry& entry = *hits[index].second;
            found.push_back(projapp::JsonObject().text("code", entry.authority + ":" + entry.code).text("name", entry.name).text("type", typeName(entry.type)).json());
        }
        return projapp::array(found);
    }

private:
    struct Entry {
        std::string authority, code, name;
        PJ_TYPE type;
    };

    // Every CRS in proj.db, deprecated ones left out, read once. Without a filter PROJ lists the
    // deprecated ones too; the filter's defaults leave them out. A CRS used in two areas comes
    // back twice, so each code is kept once.
    const std::vector<Entry>& registry() {
        if (entries.empty()) {
            PROJ_CRS_LIST_PARAMETERS* filter = proj_get_crs_list_parameters_create();
            int count = 0;
            PROJ_CRS_INFO** list = proj_get_crs_info_list_from_database(proj.get(), nullptr, filter, &count);
            std::set<std::string> seen;
            for (int index = 0; index < count; index += 1) {
                if (!seen.insert(std::string(list[index]->auth_name) + ":" + list[index]->code).second) continue;
                entries.push_back({list[index]->auth_name, list[index]->code, list[index]->name, list[index]->type});
            }
            proj_crs_info_list_destroy(list);
            proj_get_crs_list_parameters_destroy(filter);
        }
        return entries;
    }

    std::string identify(const PJ* crs) {
        bestMatch.reset();
        bestCode.clear();
        int* confidence = nullptr;
        PJ_OBJ_LIST* matches = proj_identify(proj.get(), crs, nullptr, nullptr, &confidence);
        std::vector<std::string> found;
        for (int index = 0; matches && index < proj_list_get_count(matches) && index < 5; index += 1) {
            const projapp::Object match(proj_list_get(proj.get(), matches, index));
            found.push_back(projapp::JsonObject().text("code", codeOf(match.get())).text("name", proj_get_name(match.get())).number("confidence", confidence[index]).json());
            // The matches proj_identify returns carry no area of use, so the best one is read
            // again from the database by its code.
            const char* authority = proj_get_id_auth_name(match.get(), 0);
            const char* code = proj_get_id_code(match.get(), 0);
            if (index == 0 && confidence[index] >= 70 && authority && code) {
                bestMatch.reset(proj_create_from_database(proj.get(), authority, code, PJ_CATEGORY_CRS, 0, nullptr));
                bestCode = codeOf(match.get());
            }
        }
        proj_int_list_destroy(confidence);
        proj_list_destroy(matches);
        return projapp::array(found);
    }

    std::string areaOf(const PJ* object) {
        double west, south, east, north;
        const char* name = nullptr;
        if (!proj_get_area_of_use(proj.get(), object, &west, &south, &east, &north, &name) || west <= -1000) return "null";
        return projapp::JsonObject().number("west", west).number("south", south).number("east", east).number("north", north).text("name", name).json();
    }

    std::string axes(const PJ* crs) {
        const projapp::Object system(proj_crs_get_coordinate_system(proj.get(), crs));
        std::vector<std::string> found;
        for (int index = 0; system && index < proj_cs_get_axis_count(proj.get(), system.get()); index += 1) {
            const char *name = nullptr, *abbreviation = nullptr, *direction = nullptr, *unit = nullptr;
            proj_cs_get_axis_info(proj.get(), system.get(), index, &name, &abbreviation, &direction, nullptr, &unit, nullptr, nullptr);
            found.push_back(projapp::JsonObject().text("name", name).text("abbreviation", abbreviation).text("direction", direction).text("unit", unit).json());
        }
        return projapp::array(found);
    }

    std::string candidates(const PJ* from, const PJ* to, PROJ_GRID_AVAILABILITY_USE grids) {
        PJ_OPERATION_FACTORY_CONTEXT* factory = proj_create_operation_factory_context(proj.get(), nullptr);
        proj_operation_factory_context_set_spatial_criterion(proj.get(), factory, PROJ_SPATIAL_CRITERION_PARTIAL_INTERSECTION);
        proj_operation_factory_context_set_grid_availability_use(proj.get(), factory, grids);
        PJ_OBJ_LIST* found = proj_create_operations(proj.get(), from, to, factory);
        proj_operation_factory_context_destroy(factory);
        if (!found) proj.fail("PROJ found no operation between these CRSs");
        std::vector<std::string> operations;
        for (int index = 0; index < proj_list_get_count(found); index += 1) {
            const projapp::Object operation(proj_list_get(proj.get(), found, index));
            operations.push_back(describeOperation(operation.get()));
        }
        proj_list_destroy(found);
        return projapp::array(operations);
    }

    std::string describeOperation(const PJ* operation) {
        std::vector<std::string> grids;
        for (int index = 0; index < proj_coordoperation_get_grid_used_count(proj.get(), operation); index += 1) {
            const char* name = nullptr;
            int available = 0;
            proj_coordoperation_get_grid_used(proj.get(), operation, index, &name, nullptr, nullptr, nullptr, nullptr, nullptr, &available);
            grids.push_back(projapp::JsonObject().text("name", name).flag("available", available).json());
        }
        return projapp::JsonObject()
            .text("name", proj_get_name(operation))
            .text("code", codeOf(operation))
            .number("accuracy", proj_coordoperation_get_accuracy(proj.get(), operation))
            .flag("conversion", proj_get_type(operation) == PJ_TYPE_CONVERSION)
            .flag("usable", proj_coordoperation_is_instantiable(proj.get(), operation))
            .flag("ballpark", proj_coordoperation_has_ballpark_transformation(proj.get(), operation))
            .raw("grids", projapp::array(grids))
            .json();
    }

    // Runs proj_create_crs_to_crs's choice on the centre of the area both CRSs cover, then asks
    // PROJ which operation it used. Coordinates are put longitude or easting first on both sides.
    std::string chosen(const PJ* from, const PJ* to) {
        double west, south, east, north;
        if (!proj_get_area_of_use(proj.get(), from, &west, &south, &east, &north, nullptr) || west <= -1000) return "null";
        double west2, south2, east2, north2;
        if (proj_get_area_of_use(proj.get(), to, &west2, &south2, &east2, &north2, nullptr) && west2 > -1000 && west <= east && west2 <= east2 &&
            std::max(west, west2) < std::min(east, east2) && std::max(south, south2) < std::min(north, north2)) {
            west = std::max(west, west2), east = std::min(east, east2), south = std::max(south, south2), north = std::min(north, north2);
        }
        if (east < west) east += 360;
        const double lon = std::remainder((west + east) / 2, 360.0), lat = (south + north) / 2;
        const projapp::Object geographic(proj_crs_get_geodetic_crs(proj.get(), from));
        if (!geographic) return "null";
        const projapp::Object place(proj_create_crs_to_crs_from_pj(proj.get(), geographic.get(), from, nullptr, nullptr));
        const projapp::Object transformation(proj_create_crs_to_crs_from_pj(proj.get(), from, to, nullptr, nullptr));
        if (!place || !transformation) return "null";
        const projapp::Object placeNormalized(proj_normalize_for_visualization(proj.get(), place.get()));
        const projapp::Object normalized(proj_normalize_for_visualization(proj.get(), transformation.get()));
        if (!placeNormalized || !normalized) return "null";
        const PJ_COORD start = proj_trans(placeNormalized.get(), PJ_FWD, proj_coord(lon, lat, 0, HUGE_VAL));
        const PJ_COORD end = proj_trans(normalized.get(), PJ_FWD, start);
        if (!std::isfinite(end.xy.x)) return "null";
        const projapp::Object used(proj_trans_get_last_used_operation(normalized.get()));
        std::string name = proj_get_name(used ? used.get() : normalized.get());
        const std::string suffix = " (with axis order normalized for visualization)";
        if (name.size() > suffix.size() && name.compare(name.size() - suffix.size(), suffix.size(), suffix) == 0) name.erase(name.size() - suffix.size());
        using projapp::number;
        return projapp::JsonObject()
            .text("name", name)
            .raw("at", projapp::array({number(lon), number(lat)}))
            .raw("result", projapp::array({number(end.xy.x), number(end.xy.y)}))
            .json();
    }

    std::string text(const char* exported) const { return exported ? projapp::quote(exported) : "null"; }

    std::string metadata(const char* key) const {
        const char* value = proj_context_get_database_metadata(proj.get(), key);
        return value ? value : "";
    }

    static std::string codeOf(const PJ* object) {
        const char* authority = proj_get_id_auth_name(object, 0);
        const char* code = proj_get_id_code(object, 0);
        return authority && code ? std::string(authority) + ":" + code : "";
    }

    static std::string lowered(std::string text) {
        std::transform(text.begin(), text.end(), text.begin(), [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
        return text;
    }

    static const char* typeName(PJ_TYPE type) {
        switch (type) {
            case PJ_TYPE_GEOGRAPHIC_2D_CRS: return "Geographic 2D CRS";
            case PJ_TYPE_GEOGRAPHIC_3D_CRS: return "Geographic 3D CRS";
            case PJ_TYPE_GEOCENTRIC_CRS: return "Geocentric CRS";
            case PJ_TYPE_PROJECTED_CRS: return "Projected CRS";
            case PJ_TYPE_VERTICAL_CRS: return "Vertical CRS";
            case PJ_TYPE_COMPOUND_CRS: return "Compound CRS";
            case PJ_TYPE_ENGINEERING_CRS: return "Engineering CRS";
            case PJ_TYPE_BOUND_CRS: return "Bound CRS";
            case PJ_TYPE_DERIVED_PROJECTED_CRS: return "Derived projected CRS";
            case PJ_TYPE_TEMPORAL_CRS: return "Temporal CRS";
            default: return "CRS";
        }
    }

    projapp::Context proj;
    std::vector<Entry> entries;
    projapp::Object bestMatch;
    std::string bestCode;
};
