#pragma once

#include <expat.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "json.h"

// GPX for the track app: a generated ride to try it on, and a streaming reader that keeps only
// running totals and a thinned-out copy of the line, so a file of any size fits.
namespace gpx {

inline const char* const GPX10 = "http://www.topografix.com/GPX/1/0";
inline const char* const GPX11 = "http://www.topografix.com/GPX/1/1";
inline const char* const TRACKPOINT_V1 = "http://www.garmin.com/xmlschemas/TrackPointExtension/v1";
inline const char* const TRACKPOINT_V2 = "http://www.garmin.com/xmlschemas/TrackPointExtension/v2";

// ---- The generated ride: a 64 km loop recorded every second, from integers only, so that the
// Python reference that produced the expected summary writes the same bytes.

inline std::string fixed(long long value, int decimals) {
    long long scale = 1;
    for (int i = 0; i < decimals; i += 1) scale *= 10;
    const long long magnitude = value < 0 ? -value : value;
    std::string fraction = std::to_string(magnitude % scale);
    fraction.insert(0, static_cast<size_t>(decimals) - fraction.size(), '0');
    return (value < 0 ? "-" : "") + std::to_string(magnitude / scale) + "." + fraction;
}

inline std::string clock(int seconds) {
    const int t = 7 * 3600 + 30 * 60 + seconds;
    char text[32];
    std::snprintf(text, sizeof text, "2026-09-20T%02d:%02d:%02dZ", t / 3600, t / 60 % 60, t % 60);
    return text;
}

inline int triangle(int i, int period, int amplitude) { return amplitude * std::abs(2 * (i % period) - period) / period; }

inline std::string ride(const std::string& prefix) {
    static const int directions[16][2] = {{63, 0},   {58, 35},   {45, 65},   {24, 85},   {0, 92},   {-24, 85}, {-45, 65}, {-58, 35},
                                          {-63, 0}, {-58, -35}, {-45, -65}, {-24, -85}, {0, -92}, {24, -85}, {45, -65}, {58, -35}};
    static const int wobble[4] = {0, 1, 0, -1};
    uint32_t state = 2026;
    const auto next = [&state]() { return state = state * 1664525u + 1013904223u; };
    int sides[16];
    for (int k = 0; k < 8; k += 1) sides[k] = static_cast<int>(300 + next() % 650);
    for (int k = 8; k < 16; k += 1) sides[k] = sides[k - 8];  // side k+8 mirrors side k, so the loop closes
    std::vector<int> headings;
    for (int k = 0; k < 16; k += 1) {
        for (int j = 0; j < sides[k]; j += 1) headings.push_back((k + wobble[(j / 40) % 4] + 16) % 16);
    }
    const int points = static_cast<int>(headings.size()) + 1;
    long long lat = 46500000;  // micro-degrees
    long long lon = 6600000;
    std::string out = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"crossbind demo\" xmlns=\"" + std::string(GPX11) + "\" xmlns:" + prefix + "=\"" +
                      TRACKPOINT_V1 + "\">\n  <metadata><name>Generated loop</name><time>" + clock(0) +
                      "</time></metadata>\n  <trk>\n    <name>Morning loop</name>\n    <type>cycling</type>\n    <trkseg>\n";
    std::vector<int> elevations;
    for (int i = 0; i < points; i += 1) {
        if (i > 0) {
            lat += directions[headings[static_cast<size_t>(i - 1)]][0];
            lon += directions[headings[static_cast<size_t>(i - 1)]][1];
        }
        const int ele = 4200 + triangle(i, 1700, 1400) + triangle(i, 530, 260) + static_cast<int>(next() % 3) - 1;  // decimetres
        elevations.push_back(ele);
        const int climb = ele - elevations[static_cast<size_t>(std::max(0, i - 30))];
        const int hr = std::max(90, std::min(185, 128 + climb / 2 + static_cast<int>(next() % 7) - 3));
        const int cadence = static_cast<int>(70 + next() % 25);
        out += "      <trkpt lat=\"" + fixed(lat, 6) + "\" lon=\"" + fixed(lon, 6) + "\"><ele>" + fixed(ele, 1) + "</ele><time>" + clock(i) + "</time><extensions><" + prefix +
               ":TrackPointExtension><" + prefix + ":hr>" + std::to_string(hr) + "</" + prefix + ":hr><" + prefix + ":cad>" + std::to_string(cadence) + "</" + prefix +
               ":cad></" + prefix + ":TrackPointExtension></extensions></trkpt>\n";
    }
    return out + "    </trkseg>\n  </trk>\n</gpx>\n";
}

// ---- The reader.

// Seconds since 1970 for "YYYY-MM-DDThh:mm:ss[.fff](Z|+hh:mm|-hh:mm)"; NAN when it is not that.
inline double parseTime(const std::string& text) {
    int y, mo, d, h, mi;
    double s;
    int used = 0;
    if (std::sscanf(text.c_str(), "%4d-%2d-%2dT%2d:%2d:%lf%n", &y, &mo, &d, &h, &mi, &s, &used) != 6) return NAN;
    double offset = 0;
    const char* zone = text.c_str() + used;
    int zh = 0, zm = 0;
    if ((zone[0] == '+' || zone[0] == '-') && std::sscanf(zone + 1, "%2d:%2d", &zh, &zm) == 2) offset = (zone[0] == '+' ? 1 : -1) * (zh * 3600.0 + zm * 60.0);
    y -= mo <= 2;  // days from civil, after Howard Hinnant
    const long era = (y >= 0 ? y : y - 399) / 400;
    const long yoe = y - era * 400;
    const long doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    const double days = static_cast<double>(era * 146097 + doe - 719468);
    return days * 86400 + h * 3600.0 + mi * 60.0 + s - offset;
}

inline double haversineKm(double lat1, double lon1, double lat2, double lon2) {
    const double radians = 3.14159265358979323846 / 180;
    const double a = std::sin((lat2 - lat1) * radians / 2);
    const double b = std::sin((lon2 - lon1) * radians / 2);
    const double h = a * a + std::cos(lat1 * radians) * std::cos(lat2 * radians) * b * b;
    return 2 * 6371.0088 * std::asin(std::sqrt(h));
}

// "46.5190000" -> "46.519": numbers as short as they can be written without losing digits.
inline std::string trimmed(double value, int decimals) {
    std::string text = json::number(value, decimals);
    if (text.find('.') != std::string::npos) {
        text.erase(text.find_last_not_of('0') + 1);
        if (text.back() == '.') text.pop_back();
    }
    return text == "-0" ? "0" : text;
}

// Keeps at most about `limit` samples of a stream of unknown length: when full, every other sample
// goes and the stride doubles, so memory stays bounded and the samples stay evenly spread.
template <typename T>
class Thinned {
public:
    explicit Thinned(size_t limit) : limit(limit) {}

    void add(const T& value) {
        if (seen++ % stride == 0) {
            kept.push_back(value);
            if (kept.size() >= limit * 2) {
                for (size_t i = 0; i < kept.size() / 2; i += 1) kept[i] = kept[i * 2];
                kept.resize(kept.size() / 2);
                stride *= 2;
            }
        }
        last = value;
    }

    std::vector<T> samples() const {
        std::vector<T> out = kept;
        if (seen && (seen - 1) % stride != 0) out.push_back(last);  // always end on the last one
        return out;
    }

private:
    size_t limit;
    size_t seen = 0;
    size_t stride = 1;
    std::vector<T> kept;
    T last{};
};

struct Point {
    double lat = 0;
    double lon = 0;
    double ele = NAN;
};

// Everything the app reports, gathered in one pass of Expat's handlers.
class Reader {
public:
    explicit Reader(bool keepAll) : keepAll(keepAll), parser(XML_ParserCreateNS(nullptr, '|'), XML_ParserFree) {
        if (!parser) throw std::runtime_error("out of memory");
        XML_SetUserData(parser.get(), this);
        XML_SetElementHandler(parser.get(), onStart, onEnd);
        XML_SetCharacterDataHandler(parser.get(), onText);
        XML_SetStartNamespaceDeclHandler(parser.get(), onNamespace);
    }

    // Streams the file through the parser; throws Expat's message and position when it is not XML.
    void readFile(const std::string& path) {
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "rb"), std::fclose);
        if (!file) throw std::runtime_error("cannot open " + path);
        for (bool last = false; !last;) {
            void* buffer = XML_GetBuffer(parser.get(), 1 << 16);
            if (!buffer) throw std::runtime_error("out of memory");
            const size_t got = std::fread(buffer, 1, 1 << 16, file.get());
            last = got == 0;
            bytes += static_cast<double>(got);
            if (XML_ParseBuffer(parser.get(), static_cast<int>(got), last) != XML_STATUS_OK) {
                throw std::runtime_error(std::string(XML_ErrorString(XML_GetErrorCode(parser.get()))) + " at line " +
                                         std::to_string(XML_GetCurrentLineNumber(parser.get())) + ", column " +
                                         std::to_string(XML_GetCurrentColumnNumber(parser.get())));
            }
        }
    }

    std::string summary() const {
        std::string lineJson;
        for (const auto& point : line.samples()) lineJson += (lineJson.empty() ? "[" : ",[") + trimmed(point.first, 6) + "," + trimmed(point.second, 6) + "]";
        std::string profileJson;
        for (const auto& sample : profile.samples()) profileJson += (profileJson.empty() ? "[" : ",[") + trimmed(sample.first, 3) + "," + trimmed(sample.second, 1) + "]";
        std::string names;
        for (const auto& [prefix, uri] : namespaces) names += (names.empty() ? "" : ",") + json::quote(prefix) + ":" + json::quote(uri);
        const bool timed = !std::isnan(firstTime) && !std::isnan(lastTime);
        const auto optional = [](double value, int decimals) { return std::isnan(value) ? std::string("null") : trimmed(value, decimals); };
        return "{\"name\":" + json::quote(name) + ",\"bytes\":" + json::integer(bytes) + ",\"tracks\":" + std::to_string(tracks) +
               ",\"segments\":" + std::to_string(segments) + ",\"points\":" + json::integer(points) + ",\"lengthKm\":" + json::number(lengthKm, 3) +
               ",\"gain\":" + json::number(gain, 1) + ",\"loss\":" + json::number(loss, 1) + ",\"minEle\":" + optional(minEle, 1) +
               ",\"maxEle\":" + optional(maxEle, 1) + ",\"avgHr\":" + (hrCount ? json::number(hrSum / hrCount, 1) : "null") +
               ",\"maxHr\":" + (hrCount ? json::integer(maxHr) : "null") + ",\"heartRates\":" + json::integer(hrCount) +
               ",\"start\":" + (startText.empty() ? "null" : json::quote(startText)) + ",\"end\":" + (endText.empty() ? "null" : json::quote(endText)) +
               ",\"seconds\":" + (timed ? json::integer(lastTime - firstTime) : "null") + ",\"namespaces\":{" + names + "}" +
               ",\"line\":[" + lineJson + "],\"profile\":[" + profileJson + "]}";
    }

    std::string geojson() const {
        std::string features;
        for (size_t s = 0; s < segmentCoordinates.size(); s += 1) {
            features += std::string(s ? "," : "") + "{\"type\":\"Feature\",\"properties\":{\"name\":" + json::quote(name) + ",\"segment\":" + std::to_string(s + 1) +
                        "},\"geometry\":{\"type\":\"LineString\",\"coordinates\":[" + segmentCoordinates[s] + "]}}";
        }
        return "{\"type\":\"FeatureCollection\",\"features\":[" + features + "]}";
    }

private:
    enum class Capture { none, ele, time, hr, name };

    // The local name of a GPX element, or "" for anything outside GPX 1.0 and 1.1.
    static std::string gpxName(const char* name) {
        const char* bar = std::strchr(name, '|');
        if (!bar) return name;
        const std::string uri(name, static_cast<size_t>(bar - name));
        return uri == GPX11 || uri == GPX10 ? std::string(bar + 1) : std::string();
    }

    static bool isHeartRate(const char* name) {
        const size_t length = std::strlen(TRACKPOINT_V1);
        return (std::strncmp(name, TRACKPOINT_V1, length) == 0 || std::strncmp(name, TRACKPOINT_V2, length) == 0) && std::strcmp(name + length, "|hr") == 0;
    }

    static const char* attribute(const XML_Char** atts, const char* wanted) {
        for (int i = 0; atts[i]; i += 2) {
            if (std::strcmp(atts[i], wanted) == 0) return atts[i + 1];
        }
        return nullptr;
    }

    static void XMLCALL onNamespace(void* data, const XML_Char* prefix, const XML_Char* uri) {
        Reader& reader = *static_cast<Reader*>(data);
        const std::string key = prefix ? prefix : "";
        for (const auto& known : reader.namespaces) {
            if (known.first == key) return;
        }
        if (reader.namespaces.size() < 16) reader.namespaces.emplace_back(key, uri ? uri : "");
    }

    static void XMLCALL onStart(void* data, const XML_Char* rawName, const XML_Char** atts) {
        Reader& reader = *static_cast<Reader*>(data);
        const std::string local = gpxName(rawName);
        const std::string parent = reader.stack.empty() ? "" : reader.stack.back();
        reader.stack.push_back(local);
        reader.text.clear();
        if (local == "trk") {
            reader.tracks += 1;
        } else if (local == "trkseg") {
            reader.segments += 1;
            reader.inSegment = true;
            reader.havePrevious = false;
            if (reader.keepAll) reader.segmentCoordinates.emplace_back();
        } else if (local == "trkpt") {
            const char* lat = attribute(atts, "lat");
            const char* lon = attribute(atts, "lon");
            reader.inPoint = lat && lon;
            reader.point = Point();
            if (reader.inPoint) {
                reader.point.lat = std::strtod(lat, nullptr);
                reader.point.lon = std::strtod(lon, nullptr);
            }
        } else if (reader.inPoint && (local == "ele" || local == "time")) {
            reader.capture = local == "ele" ? Capture::ele : Capture::time;
        } else if (reader.inPoint && isHeartRate(rawName)) {
            reader.capture = Capture::hr;
        } else if (local == "name" && (parent == "trk" || parent == "metadata") && (reader.name.empty() || (parent == "trk" && !reader.trackNamed))) {
            reader.capture = Capture::name;
        }
    }

    static void XMLCALL onText(void* data, const XML_Char* text, int length) {
        Reader& reader = *static_cast<Reader*>(data);
        if (reader.capture != Capture::none) reader.text.append(text, static_cast<size_t>(length));
    }

    static void XMLCALL onEnd(void* data, const XML_Char*) {
        Reader& reader = *static_cast<Reader*>(data);
        const std::string local = reader.stack.back();
        reader.stack.pop_back();
        switch (reader.capture) {
            case Capture::ele:
                reader.point.ele = std::strtod(reader.text.c_str(), nullptr);
                break;
            case Capture::time:
                reader.timeText = reader.text;
                break;
            case Capture::hr:
                reader.heartRate(std::strtod(reader.text.c_str(), nullptr));
                break;
            case Capture::name:
                reader.name = reader.text;
                reader.trackNamed = !reader.stack.empty() && reader.stack.back() == "trk";
                break;
            case Capture::none:
                break;
        }
        reader.capture = Capture::none;
        if (local == "trkpt" && reader.inPoint) reader.finishPoint();
        if (local == "trkseg") reader.inSegment = false;
    }

    void heartRate(double value) {
        if (!(value > 0)) return;
        hrSum += value;
        hrCount += 1;
        maxHr = std::max(maxHr, value);
    }

    void finishPoint() {
        inPoint = false;
        points += 1;
        if (havePrevious) {
            lengthKm += haversineKm(previous.lat, previous.lon, point.lat, point.lon);
            if (!std::isnan(previous.ele) && !std::isnan(point.ele)) {
                gain += std::max(0.0, point.ele - previous.ele);
                loss += std::max(0.0, previous.ele - point.ele);
            }
        }
        if (!std::isnan(point.ele)) {
            minEle = std::isnan(minEle) ? point.ele : std::min(minEle, point.ele);
            maxEle = std::isnan(maxEle) ? point.ele : std::max(maxEle, point.ele);
            profile.add({lengthKm, point.ele});
        }
        if (!timeText.empty()) {
            const double seconds = parseTime(timeText);
            if (startText.empty()) {
                startText = timeText;
                firstTime = seconds;
            }
            endText = timeText;
            lastTime = seconds;
            timeText.clear();
        }
        line.add({point.lon, point.lat});
        if (keepAll && !segmentCoordinates.empty()) {
            std::string& coordinates = segmentCoordinates.back();
            coordinates += (coordinates.empty() ? "[" : ",[") + trimmed(point.lon, 8) + "," + trimmed(point.lat, 8);
            coordinates += (std::isnan(point.ele) ? "" : "," + trimmed(point.ele, 2)) + "]";
        }
        previous = point;
        havePrevious = inSegment;
    }

    bool keepAll;
    std::unique_ptr<XML_ParserStruct, void (*)(XML_Parser)> parser;
    std::vector<std::string> stack;
    std::vector<std::pair<std::string, std::string>> namespaces;
    std::vector<std::string> segmentCoordinates;
    Thinned<std::pair<double, double>> line{1500};
    Thinned<std::pair<double, double>> profile{400};
    Capture capture = Capture::none;
    Point point;
    Point previous;
    std::string text;
    std::string timeText;
    std::string startText;
    std::string endText;
    std::string name;
    double bytes = 0;
    double points = 0;
    double lengthKm = 0;
    double gain = 0;
    double loss = 0;
    double minEle = NAN;
    double maxEle = NAN;
    double hrSum = 0;
    double hrCount = 0;
    double maxHr = 0;
    double firstTime = NAN;
    double lastTime = NAN;
    int tracks = 0;
    int segments = 0;
    bool inSegment = false;
    bool inPoint = false;
    bool havePrevious = false;
    bool trackNamed = false;
};

}  // namespace gpx
