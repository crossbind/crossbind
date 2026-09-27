#pragma once

// expat.h declares the amplification limits only when XML_GE is 1; this build compiles them in.
#ifndef XML_GE
#define XML_GE 1
#endif
#include <expat.h>

#include <memory>
#include <stdexcept>
#include <string>

// Untrusted XML with entities expanded under Expat's limits. Once `activationBytes` of input and
// entity text have been processed, the expansion may be at most `maxAmplification` times the input;
// Expat's defaults are 100 and 8 MiB. A breach stops the parse like any other error.
class XmlGuard {
public:
    // The document's character data, entities expanded.
    static std::string text(const std::string& xml, double maxAmplification, double activationBytes) {
        std::unique_ptr<XML_ParserStruct, void (*)(XML_Parser)> parser(XML_ParserCreate(nullptr), XML_ParserFree);
        if (!parser) throw std::runtime_error("out of memory");
        if (!XML_SetBillionLaughsAttackProtectionMaximumAmplification(parser.get(), static_cast<float>(maxAmplification))) {
            throw std::invalid_argument("the maximum amplification must be at least 1");
        }
        if (activationBytes < 0 || !XML_SetBillionLaughsAttackProtectionActivationThreshold(parser.get(), static_cast<unsigned long long>(activationBytes))) {
            throw std::invalid_argument("the activation threshold must be a byte count");
        }
        std::string text;
        XML_SetUserData(parser.get(), &text);
        XML_SetCharacterDataHandler(parser.get(), [](void* data, const XML_Char* chunk, int length) {
            static_cast<std::string*>(data)->append(chunk, static_cast<size_t>(length));
        });
        if (XML_Parse(parser.get(), xml.data(), static_cast<int>(xml.size()), XML_TRUE) != XML_STATUS_OK) {
            throw std::runtime_error(std::string(XML_ErrorString(XML_GetErrorCode(parser.get()))) + " at line " +
                                     std::to_string(XML_GetCurrentLineNumber(parser.get())) + ", column " +
                                     std::to_string(XML_GetCurrentColumnNumber(parser.get())));
        }
        return text;
    }
};
