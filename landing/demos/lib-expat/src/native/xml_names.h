#pragma once

#include <expat.h>

#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Namespace-aware parsing. XML_ParserCreateNS hands every name over as "<namespace URI>|<local name>",
// so what a document calls its prefixes no longer matters; names outside any namespace stay bare.
class XmlNames {
public:
    // The text inside every element named `local` in the namespace `uri`, as a JSON array of strings.
    static std::string textOf(const std::string& xml, const std::string& uri, const std::string& local) {
        Search search;
        search.name = uri.empty() ? local : uri + "|" + local;
        Parser parser = create(&search);
        XML_SetElementHandler(parser.get(), onStart, onEnd);
        XML_SetCharacterDataHandler(parser.get(), onText);
        parse(parser.get(), xml);
        std::string json = "[";
        for (const std::string& text : search.found) json += (json.size() > 1 ? "," : "") + quote(text);
        return json + "]";
    }

    // Every prefix the document declares, with its URI, as JSON; "" is the default namespace.
    static std::string declarations(const std::string& xml) {
        std::map<std::string, std::string> declared;
        Parser parser = create(&declared);
        XML_SetStartNamespaceDeclHandler(parser.get(), [](void* data, const XML_Char* prefix, const XML_Char* uri) {
            (*static_cast<std::map<std::string, std::string>*>(data))[prefix ? prefix : ""] = uri ? uri : "";
        });
        parse(parser.get(), xml);
        std::string json = "{";
        for (const auto& [prefix, uri] : declared) json += (json.size() > 1 ? "," : "") + quote(prefix) + ":" + quote(uri);
        return json + "}";
    }

private:
    using Parser = std::unique_ptr<XML_ParserStruct, void (*)(XML_Parser)>;

    struct Search {
        std::string name;
        std::vector<std::string> open;       // the text of each open element with that name
        std::vector<std::string> found;
    };

    static Parser create(void* data) {
        Parser parser(XML_ParserCreateNS(nullptr, '|'), XML_ParserFree);
        if (!parser) throw std::runtime_error("out of memory");
        XML_SetUserData(parser.get(), data);
        return parser;
    }

    static void parse(XML_Parser parser, const std::string& xml) {
        if (XML_Parse(parser, xml.data(), static_cast<int>(xml.size()), XML_TRUE) != XML_STATUS_OK) {
            throw std::runtime_error(std::string(XML_ErrorString(XML_GetErrorCode(parser))) + " at line " +
                                     std::to_string(XML_GetCurrentLineNumber(parser)) + ", column " +
                                     std::to_string(XML_GetCurrentColumnNumber(parser)));
        }
    }

    static void XMLCALL onStart(void* data, const XML_Char* name, const XML_Char**) {
        Search& search = *static_cast<Search*>(data);
        if (search.name == name) search.open.emplace_back();
    }

    static void XMLCALL onText(void* data, const XML_Char* text, int length) {
        Search& search = *static_cast<Search*>(data);
        if (!search.open.empty()) search.open.back().append(text, static_cast<size_t>(length));
    }

    static void XMLCALL onEnd(void* data, const XML_Char* name) {
        Search& search = *static_cast<Search*>(data);
        if (search.name != name) return;
        search.found.push_back(search.open.back());
        search.open.pop_back();
    }

    static std::string quote(const std::string& value) {
        std::string out = "\"";
        for (const char c : value) {
            if (c == '"' || c == '\\') {
                out += '\\';
                out += c;
            } else if (c == '\n') {
                out += "\\n";
            } else if (c == '\t') {
                out += "\\t";
            } else if (c == '\r') {
                out += "\\r";
            } else {
                out += c;
            }
        }
        return out + "\"";
    }
};
