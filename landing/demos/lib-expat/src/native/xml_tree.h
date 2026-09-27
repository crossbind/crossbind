#pragma once

#include <expat.h>

#include <stdexcept>
#include <string>
#include <vector>

// XML in, JSON out. Each element becomes {"name","attributes","children","text"}: `children` holds
// its child elements and `text` its own character data, left out when it is only whitespace.
// Malformed XML throws Expat's message with the line and column where parsing stopped.
class XmlTree {
public:
    static std::string version() {
        const XML_Expat_Version v = XML_ExpatVersionInfo();
        return std::to_string(v.major) + "." + std::to_string(v.minor) + "." + std::to_string(v.micro);
    }

    static std::string parse(const std::string& xml) {
        Builder builder;
        XML_Parser parser = XML_ParserCreate(nullptr);
        if (!parser) throw std::runtime_error("out of memory");
        XML_SetUserData(parser, &builder);
        XML_SetElementHandler(parser, onStart, onEnd);
        XML_SetCharacterDataHandler(parser, onText);
        const bool ok = XML_Parse(parser, xml.data(), static_cast<int>(xml.size()), XML_TRUE) == XML_STATUS_OK;
        const std::string error = ok ? "" : std::string(XML_ErrorString(XML_GetErrorCode(parser))) + " at line " +
                                                std::to_string(XML_GetCurrentLineNumber(parser)) + ", column " +
                                                std::to_string(XML_GetCurrentColumnNumber(parser));
        XML_ParserFree(parser);
        if (!ok) throw std::runtime_error(error);
        return builder.json;
    }

private:
    struct Builder {
        std::string json;
        std::vector<std::string> text;       // character data of each open element
        std::vector<bool> hasChildren;
    };

    // Expat delivers UTF-8; JSON only needs quotes, backslashes and control characters escaped.
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

    static void XMLCALL onStart(void* data, const XML_Char* name, const XML_Char** attributes) {
        Builder& builder = *static_cast<Builder*>(data);
        if (!builder.hasChildren.empty()) {
            if (builder.hasChildren.back()) builder.json += ",";
            builder.hasChildren.back() = true;
        }
        builder.json += "{\"name\":" + quote(name) + ",\"attributes\":{";
        for (int i = 0; attributes[i]; i += 2) builder.json += (i ? "," : "") + quote(attributes[i]) + ":" + quote(attributes[i + 1]);
        builder.json += "},\"children\":[";
        builder.text.emplace_back();
        builder.hasChildren.push_back(false);
    }

    static void XMLCALL onText(void* data, const XML_Char* text, int length) {
        static_cast<Builder*>(data)->text.back().append(text, static_cast<size_t>(length));
    }

    static void XMLCALL onEnd(void* data, const XML_Char*) {
        Builder& builder = *static_cast<Builder*>(data);
        const std::string& text = builder.text.back();
        builder.json += "]";
        if (text.find_first_not_of(" \t\r\n") != std::string::npos) builder.json += ",\"text\":" + quote(text);
        builder.json += "}";
        builder.text.pop_back();
        builder.hasChildren.pop_back();
    }
};
