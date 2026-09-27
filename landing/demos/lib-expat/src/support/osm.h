#pragma once

#include <cstdint>
#include <string>

// The document the firehose app parses: OpenStreetMap-style XML generated on the fly from a 32-bit
// LCG, never stored. Nodes carry a latitude and longitude and every fifth one an amenity tag; then
// come ways of ten node references each. Integer formatting only, so the Python reference that
// produced the expected counts writes the same bytes (100,000 nodes: 8,433,547 B).
namespace osm {

class Generator {
public:
    explicit Generator(uint32_t nodes) : total(nodes), ways(nodes / 10) {}

    // Appends whole lines to `out` until it holds at least `bytes`; false once the document is complete.
    bool fill(std::string& out, size_t bytes) {
        while (out.size() < bytes && phase != Phase::done) {
            switch (phase) {
                case Phase::header:
                    out += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<osm version=\"0.6\" generator=\"crossbind-demo\">\n";
                    phase = total ? Phase::nodes : Phase::footer;
                    break;
                case Phase::nodes:
                    node(out);
                    if (++index > total) {
                        index = 1;
                        phase = ways ? Phase::ways : Phase::footer;
                    }
                    break;
                case Phase::ways:
                    way(out);
                    if (++index > ways) phase = Phase::footer;
                    break;
                case Phase::footer:
                    out += "</osm>\n";
                    phase = Phase::done;
                    break;
                case Phase::done:
                    break;
            }
        }
        return phase != Phase::done;
    }

    // Share of the lines written so far.
    double progress() const {
        const double lines = static_cast<double>(total) + ways;
        if (phase == Phase::done || lines == 0) return 1;
        const double written = phase == Phase::nodes ? index - 1.0 : phase == Phase::ways ? total + index - 1.0 : phase == Phase::footer ? lines : 0;
        return written / lines;
    }

private:
    enum class Phase { header, nodes, ways, footer, done };

    uint32_t next() {
        state = state * 1664525u + 1013904223u;
        return state;
    }

    static void digits(std::string& out, uint32_t value, int width) {
        char text[12];
        int length = 0;
        do {
            text[length++] = static_cast<char>('0' + value % 10);
            value /= 10;
        } while (value || length < width);
        while (length) out += text[--length];
    }

    void node(std::string& out) {
        static const char* const amenities[] = {"cafe", "school", "pharmacy", "bench", "fountain", "library"};
        const uint32_t lat = next() % 1000000;
        const uint32_t lon = next() % 1000000;
        out += "  <node id=\"";
        digits(out, index, 1);
        out += "\" lat=\"41.";
        digits(out, lat, 7);
        out += "\" lon=\"28.";
        digits(out, 9000000 + lon, 7);
        if (index % 5 == 0) {
            out += "\"><tag k=\"amenity\" v=\"";
            out += amenities[next() % 6];
            out += "\"/></node>\n";
        } else {
            out += "\"/>\n";
        }
    }

    void way(std::string& out) {
        static const char* const highways[] = {"residential", "primary", "footway", "cycleway", "service"};
        out += "  <way id=\"";
        digits(out, index, 1);
        out += "\">";
        for (uint32_t k = 1; k <= 10; k += 1) {
            out += "<nd ref=\"";
            digits(out, (index - 1) * 10 + k, 1);
            out += "\"/>";
        }
        out += "<tag k=\"highway\" v=\"";
        out += highways[next() % 5];
        out += "\"/></way>\n";
    }

    uint32_t total;
    uint32_t ways;
    uint32_t index = 1;
    uint32_t state = 7;
    Phase phase = Phase::header;
};

}  // namespace osm
