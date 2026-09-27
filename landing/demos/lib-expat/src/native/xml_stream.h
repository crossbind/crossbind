#pragma once

#include <expat.h>

#include <cstdio>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>

// Counts the elements of an XML file by name. The file is read in fixed-size pieces straight into
// Expat's own buffer (XML_GetBuffer, then XML_ParseBuffer), so memory stays the same at any size.
class XmlStream {
public:
    // JSON: {"bytes":N,"reads":R,"elements":{"name":count,...}}
    static std::string countElements(const std::string& path, int chunkBytes) {
        if (chunkBytes < 1024) throw std::invalid_argument("read at least 1 KiB at a time");
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "rb"), std::fclose);
        if (!file) throw std::runtime_error("cannot open " + path);
        std::unique_ptr<XML_ParserStruct, void (*)(XML_Parser)> parser(XML_ParserCreate(nullptr), XML_ParserFree);
        if (!parser) throw std::runtime_error("out of memory");

        std::map<std::string, double> counts;
        XML_SetUserData(parser.get(), &counts);
        XML_SetStartElementHandler(parser.get(), [](void* data, const XML_Char* name, const XML_Char**) {
            (*static_cast<std::map<std::string, double>*>(data))[name] += 1;
        });

        double bytes = 0;
        int reads = 0;
        for (bool last = false; !last;) {
            void* buffer = XML_GetBuffer(parser.get(), chunkBytes);
            if (!buffer) throw std::runtime_error("out of memory");
            const size_t got = std::fread(buffer, 1, static_cast<size_t>(chunkBytes), file.get());
            if (std::ferror(file.get())) throw std::runtime_error("cannot read " + path);
            last = got == 0;
            bytes += static_cast<double>(got);
            reads += last ? 0 : 1;
            if (XML_ParseBuffer(parser.get(), static_cast<int>(got), last) != XML_STATUS_OK) {
                throw std::runtime_error(std::string(XML_ErrorString(XML_GetErrorCode(parser.get()))) + " at line " +
                                         std::to_string(XML_GetCurrentLineNumber(parser.get())) + ", column " +
                                         std::to_string(XML_GetCurrentColumnNumber(parser.get())));
            }
        }

        std::string elements;
        for (const auto& [name, count] : counts) elements += (elements.empty() ? "\"" : ",\"") + name + "\":" + std::to_string(static_cast<long long>(count));
        return "{\"bytes\":" + std::to_string(static_cast<long long>(bytes)) + ",\"reads\":" + std::to_string(reads) + ",\"elements\":{" + elements + "}}";
    }
};
