#pragma once

#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>

#include "../support/gpx.h"

// GPS tracks from GPX files, read with a namespace-aware Expat parser (XML_ParserCreateNS): GPX 1.0
// and 1.1 elements and Garmin's heart-rate extension are recognised by their namespace URI, whatever
// prefix the exporting app picked. Files stream through in 64 KiB reads.
class GpxTrack {
public:
    // Writes the generated sample ride to `path`: a 64 km loop recorded every second, with heart
    // rates under Garmin's extension spelled with `prefix`. Returns its size in bytes.
    static double writeSample(const std::string& path, const std::string& prefix) {
        if (prefix.empty() || prefix.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789") != std::string::npos) {
            throw std::invalid_argument("the prefix must be lowercase letters and digits");
        }
        const std::string document = gpx::ride(prefix);
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "wb"), std::fclose);
        if (!file || std::fwrite(document.data(), 1, document.size(), file.get()) != document.size()) throw std::runtime_error("cannot write " + path);
        return static_cast<double>(document.size());
    }

    // JSON: name, bytes, tracks, segments, points, lengthKm (haversine), gain and loss in metres,
    // minEle, maxEle, avgHr, maxHr, heartRates, start, end, seconds, the namespaces the file declares,
    // and a thinned-out line ([lon, lat] pairs) and elevation profile ([km, ele] pairs) to draw.
    static std::string summary(const std::string& path) {
        gpx::Reader reader(false);
        reader.readFile(path);
        return reader.summary();
    }

    // The tracks as GeoJSON: a FeatureCollection with one LineString of [lon, lat, ele] per segment.
    static std::string geojson(const std::string& path) {
        gpx::Reader reader(true);
        reader.readFile(path);
        return reader.geojson();
    }
};
