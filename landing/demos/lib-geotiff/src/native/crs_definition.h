#pragma once

#include <geo_normalize.h>
#include <geotiff.h>
#include <geovalues.h>
#include <tiffio.hxx>
#include <xtiffio.h>

#include <cstdio>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>

// A file often carries a single EPSG code. GTIFGetDefn expands it through PROJ's database into the
// whole definition: projection method and parameters, datum, ellipsoid, prime meridian and unit.
class CrsDefinition {
public:
    // JSON: the normalised definition, with EPSG names, and the PROJ string libgeotiff builds from it.
    static std::string describe(const std::u16string& tiff) {
        std::istringstream in(std::string(tiff.begin(), tiff.end()));
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("input.tif", &in), XTIFFClose);
        if (!tif) throw std::runtime_error("not a TIFF file");
        Keys gtif(GTIFNew(tif.get()), GTIFFree);
        GTIFDefn defn;
        if (!gtif || !GTIFGetDefn(gtif.get(), &defn)) throw std::runtime_error("no coordinate system in the GeoKeys");

        std::string json = "{\"model\":" + quoted(GTIFValueNameEx(gtif.get(), GTModelTypeGeoKey, defn.Model));
        if (defn.Model == ModelTypeProjected) {
            json += ",\"pcs\":" + code(defn.PCS, pcsName(defn.PCS));
            json += ",\"projection\":" + code(defn.ProjCode, projectionName(defn.ProjCode));
            json += ",\"method\":" + quoted(GTIFValueNameEx(gtif.get(), ProjCoordTransGeoKey, defn.CTProjection));
            json += ",\"parameters\":[";
            for (int i = 0; i < defn.nParms; i += 1) {
                if (defn.ProjParmId[i] == 0) continue;  // a slot the method does not use
                if (json.back() != '[') json += ',';
                json += "[" + quoted(GTIFKeyName(static_cast<geokey_t>(defn.ProjParmId[i]))) + "," + number(defn.ProjParm[i]) + "]";
            }
            json += "]";
        }
        char* name = nullptr;
        GTIFGetGCSInfo(defn.GCS, &name, nullptr, nullptr, nullptr);
        json += ",\"gcs\":" + code(defn.GCS, taken(name));
        GTIFGetDatumInfo(defn.Datum, &name, nullptr);
        json += ",\"datum\":" + code(defn.Datum, taken(name));
        GTIFGetEllipsoidInfo(defn.Ellipsoid, &name, nullptr, nullptr);
        json += ",\"ellipsoid\":" + code(defn.Ellipsoid, taken(name)) + ",\"axes\":[" + number(defn.SemiMajor) + "," + number(defn.SemiMinor) + "]";
        GTIFGetPMInfo(defn.PM, &name, nullptr);
        json += ",\"primeMeridian\":" + code(defn.PM, taken(name));
        GTIFGetUOMLengthInfo(defn.UOMLength, &name, nullptr);
        json += ",\"unit\":" + code(defn.UOMLength, taken(name)) + ",\"metres\":" + number(defn.UOMLengthInMeters);
        char* proj = GTIFGetProj4Defn(&defn);
        json += ",\"proj\":" + quoted(taken(proj)) + "}";
        return json;
    }

private:
    using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
    using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;

    static std::string pcsName(int pcs) {
        char* name = nullptr;
        GTIFGetPCSInfo(pcs, &name, nullptr, nullptr, nullptr);
        return taken(name);
    }

    static std::string projectionName(int projection) {
        char* name = nullptr;
        GTIFGetProjTRFInfo(projection, &name, nullptr, nullptr);
        return taken(name);
    }

    // The GTIFGet...Info functions hand over strings the caller frees.
    static std::string taken(char*& text) {
        const std::string value = text ? text : "";
        GTIFFreeMemory(text);
        text = nullptr;
        return value;
    }

    static std::string code(int value, const std::string& name) { return "[" + std::to_string(value) + "," + quoted(name) + "]"; }

    static std::string number(double value) {
        char text[32];
        std::snprintf(text, sizeof text, "%.17g", value);
        return text;
    }

    static std::string quoted(const std::string& text) {
        std::string out = "\"";
        for (const char c : text) {
            if (c == '"' || c == '\\') out += '\\';
            out += static_cast<unsigned char>(c) < 0x20 ? ' ' : c;
        }
        return out + "\"";
    }
};
