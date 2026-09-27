#pragma once

#include <expat.h>

#include <algorithm>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "../support/json.h"
#include "../support/memory.h"
#include "../support/osm.h"

// One Expat parser fed a piece at a time, with running counts the page reads between pieces. The
// input is OpenStreetMap-style XML generated on the fly and never stored, or a file the page streams
// in as raw bytes, so Expat decodes the file's own encoding. Memory stays flat either way.
class XmlFirehose {
public:
    XmlFirehose() : parser(nullptr, XML_ParserFree) {}

    // Streams a generated document of `nodes` nodes (100,000 nodes are 8,433,547 bytes).
    void generate(double nodes) {
        if (!(nodes >= 1 && nodes <= 20000000)) throw std::invalid_argument("generate between 1 and 20,000,000 nodes");
        restart();
        generator.reset(new osm::Generator(static_cast<uint32_t>(nodes)));
    }

    // Generates and parses about `bytes` more of the generated document and returns the running counts
    // as JSON: {"bytes","elements","attributes","textBytes","maxDepth","line","progress","done","error",
    // "memory","top":[[name,count]...]}.
    std::string step(double bytes) {
        if (!generator) throw std::logic_error("call generate first");
        const double until = parsed + std::max(bytes, 1.0);
        while (!finished && parsed < until) {
            chunk.clear();
            const bool more = generator->fill(chunk, PIECE);
            parse(chunk.data(), chunk.size(), !more);
        }
        return stats();
    }

    // Starts a document of `totalBytes` that arrives through feed().
    void begin(double totalBytes) {
        restart();
        size = std::max(totalBytes, 0.0);
    }

    // Parses the next piece of that document, one UTF-16 code unit (0-255) per byte, and returns the
    // running counts; `last` ends the document.
    std::string feed(const std::u16string& bytes, bool last) {
        if (!parser || generator) throw std::logic_error("call begin first");
        if (finished) return stats();
        chunk.resize(bytes.size());
        for (size_t i = 0; i < bytes.size(); i += 1) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
            chunk[i] = static_cast<char>(bytes[i]);
        }
        parse(chunk.data(), chunk.size(), last);
        return stats();
    }

    // The generated document as text, to compare with what other parsers make of it.
    static std::string sample(int nodes) {
        if (nodes < 1 || nodes > 100000) throw std::invalid_argument("a sample is 1 to 100,000 nodes");
        osm::Generator generator(static_cast<uint32_t>(nodes));
        std::string text;
        generator.fill(text, static_cast<size_t>(-1));
        return text;
    }

private:
    static constexpr size_t PIECE = 1 << 20;  // what one generated piece holds

    void restart() {
        parser.reset(XML_ParserCreate(nullptr));
        if (!parser) throw std::runtime_error("out of memory");
        XML_SetUserData(parser.get(), this);
        XML_SetElementHandler(parser.get(), onStart, onEnd);
        XML_SetCharacterDataHandler(parser.get(), onText);
        generator.reset();
        counts.clear();
        parsed = size = elements = attributes = textBytes = 0;
        depth = maxDepth = 0;
        finished = false;
        error.clear();
    }

    void parse(const char* data, size_t length, bool last) {
        parsed += static_cast<double>(length);
        settle(XML_Parse(parser.get(), data, static_cast<int>(length), last));
        if (last) finished = true;
    }

    void settle(XML_Status status) {
        if (status == XML_STATUS_OK) return;
        error = std::string(XML_ErrorString(XML_GetErrorCode(parser.get()))) + " at line " + std::to_string(XML_GetCurrentLineNumber(parser.get())) +
                ", column " + std::to_string(XML_GetCurrentColumnNumber(parser.get()));
        finished = true;
    }

    static void XMLCALL onStart(void* data, const XML_Char* name, const XML_Char** atts) {
        XmlFirehose& self = *static_cast<XmlFirehose*>(data);
        self.elements += 1;
        self.counts[name] += 1;
        for (int i = 0; atts[i]; i += 2) self.attributes += 1;
        self.depth += 1;
        self.maxDepth = std::max(self.maxDepth, self.depth);
    }

    static void XMLCALL onEnd(void* data, const XML_Char*) { static_cast<XmlFirehose*>(data)->depth -= 1; }

    static void XMLCALL onText(void* data, const XML_Char*, int length) { static_cast<XmlFirehose*>(data)->textBytes += length; }

    std::string stats() const {
        std::vector<std::pair<std::string, double>> top(counts.begin(), counts.end());
        std::sort(top.begin(), top.end(), [](const auto& a, const auto& b) { return a.second != b.second ? a.second > b.second : a.first < b.first; });
        if (top.size() > 8) top.resize(8);
        std::string names;
        for (const auto& [name, count] : top) names += (names.empty() ? "[" : ",[") + json::quote(name) + "," + json::integer(count) + "]";
        const double progress = generator ? generator->progress() : size > 0 ? std::min(parsed / size, 1.0) : 1.0;
        return "{\"bytes\":" + json::integer(parsed) + ",\"elements\":" + json::integer(elements) + ",\"attributes\":" + json::integer(attributes) +
               ",\"textBytes\":" + json::integer(textBytes) + ",\"maxDepth\":" + std::to_string(maxDepth) +
               ",\"line\":" + json::integer(static_cast<double>(XML_GetCurrentLineNumber(parser.get()))) + ",\"progress\":" + json::number(finished ? 1.0 : progress, 4) +
               ",\"done\":" + (finished ? "true" : "false") + ",\"error\":" + (error.empty() ? std::string("null") : json::quote(error)) +
               ",\"memory\":" + json::integer(memory::linearBytes()) + ",\"top\":[" + names + "]}";
    }

    std::unique_ptr<XML_ParserStruct, void (*)(XML_Parser)> parser;
    std::unique_ptr<osm::Generator> generator;
    std::unordered_map<std::string, double> counts;
    std::string chunk;
    std::string error;
    double parsed = 0;
    double size = 0;
    double elements = 0;
    double attributes = 0;
    double textBytes = 0;
    int depth = 0;
    int maxDepth = 0;
    bool finished = false;
};
