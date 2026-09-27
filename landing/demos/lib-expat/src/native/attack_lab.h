#pragma once

// expat.h declares the amplification limits only when XML_GE is 1; this build compiles them in.
#ifndef XML_GE
#define XML_GE 1
#endif
#include <expat.h>

#include <algorithm>
#include <memory>
#include <stdexcept>
#include <string>

#include "../support/attacks.h"
#include "../support/json.h"

// Runs hostile XML against Expat's defences and reports where and why each attack stopped. The
// amplification limits are Expat's own. Expat has no depth limit, so the lab enforces one from its
// start-element handler with XML_StopParser. External entities go to a handler that logs them and
// loads nothing: Expat never opens a file or a URL by itself.
class AttackLab {
public:
    // "laughs" (size = levels, 1 to 10), "quadratic" (size = entity length and reference count,
    // 1,000 to 100,000), "external" (size unused) or "deep" (size = nesting depth, 1 to 100,000).
    static std::string build(const std::string& attack, int size) {
        if (attack == "laughs") return attacks::laughs(size);
        if (attack == "quadratic") return attacks::quadratic(size);
        if (attack == "external") return attacks::external();
        if (attack == "deep") return attacks::deep(size);
        throw std::invalid_argument("unknown attack: " + attack);
    }

    // Parses `xml` under the limits; a `depthLimit` of 0 means none. JSON: {"ok","code","error","line",
    // "column","inputBytes","textBytes","elements","maxDepth","stoppedByDepth","entityCount","entities",
    // "doctype","external"}.
    static std::string parse(const std::string& xml, double maxAmplification, double activationBytes, int depthLimit) {
        Run run(depthLimit);
        XML_Parser parser = run.parser.get();
        if (!XML_SetBillionLaughsAttackProtectionMaximumAmplification(parser, static_cast<float>(maxAmplification))) {
            throw std::invalid_argument("the maximum amplification must be at least 1");
        }
        if (activationBytes < 0 || !XML_SetBillionLaughsAttackProtectionActivationThreshold(parser, static_cast<unsigned long long>(activationBytes))) {
            throw std::invalid_argument("the activation threshold must be a byte count");
        }
        XML_SetUserData(parser, &run);
        XML_SetElementHandler(parser, onStart, onEnd);
        XML_SetCharacterDataHandler(parser, onText);
        XML_SetEntityDeclHandler(parser, onEntity);
        XML_SetStartDoctypeDeclHandler(parser, onDoctype);
        XML_SetExternalEntityRefHandler(parser, onExternal);
        const bool ok = XML_Parse(parser, xml.data(), static_cast<int>(xml.size()), XML_TRUE) == XML_STATUS_OK;
        return report(run, ok, xml.size());
    }

private:
    static constexpr size_t LISTED = 12;

    struct Run {
        explicit Run(int limit) : parser(XML_ParserCreate(nullptr), XML_ParserFree), depthLimit(limit) {
            if (!parser) throw std::runtime_error("out of memory");
        }
        std::unique_ptr<XML_ParserStruct, void (*)(XML_Parser)> parser;
        int depthLimit;
        int depth = 0;
        int maxDepth = 0;
        double elements = 0;
        double textBytes = 0;
        bool stoppedByDepth = false;
        size_t entityCount = 0;
        std::string entities;
        std::string doctype = "null";
        std::string external;
    };

    static void XMLCALL onStart(void* data, const XML_Char*, const XML_Char**) {
        Run& run = *static_cast<Run*>(data);
        run.elements += 1;
        run.depth += 1;
        run.maxDepth = std::max(run.maxDepth, run.depth);
        if (run.depthLimit > 0 && run.depth > run.depthLimit && !run.stoppedByDepth) {
            run.stoppedByDepth = true;
            XML_StopParser(run.parser.get(), XML_FALSE);
        }
    }

    static void XMLCALL onEnd(void* data, const XML_Char*) { static_cast<Run*>(data)->depth -= 1; }

    static void XMLCALL onText(void* data, const XML_Char*, int length) { static_cast<Run*>(data)->textBytes += length; }

    static void XMLCALL onEntity(void* data, const XML_Char* name, int parameter, const XML_Char* value, int length, const XML_Char*,
                                 const XML_Char* systemId, const XML_Char*, const XML_Char*) {
        Run& run = *static_cast<Run*>(data);
        if (run.entityCount++ >= LISTED) return;
        std::string entry = "{\"name\":" + json::quote(std::string(parameter ? "%" : "") + name);
        entry += value ? ",\"bytes\":" + std::to_string(length) : ",\"systemId\":" + json::quote(systemId ? systemId : "");
        run.entities += (run.entities.empty() ? "" : ",") + entry + "}";
    }

    static void XMLCALL onDoctype(void* data, const XML_Char* name, const XML_Char* systemId, const XML_Char*, int) {
        static_cast<Run*>(data)->doctype = "{\"name\":" + json::quote(name) + ",\"systemId\":" + (systemId ? json::quote(systemId) : "null") + "}";
    }

    // Logs the reference and returns without creating an external entity parser: nothing is loaded.
    static int XMLCALL onExternal(XML_Parser parser, const XML_Char* context, const XML_Char*, const XML_Char* systemId, const XML_Char*) {
        Run& run = *static_cast<Run*>(XML_GetUserData(parser));
        run.external += (run.external.empty() ? "" : ",") + std::string("{\"entity\":") + (context ? json::quote(context) : "null") +
                        ",\"systemId\":" + json::quote(systemId) + "}";
        return XML_STATUS_OK;
    }

    static std::string report(const Run& run, bool ok, size_t inputBytes) {
        XML_Parser parser = run.parser.get();
        const XML_Error code = ok ? XML_ERROR_NONE : XML_GetErrorCode(parser);
        return "{\"ok\":" + std::string(ok ? "true" : "false") + ",\"code\":" + std::to_string(static_cast<int>(code)) +
               ",\"error\":" + (ok ? std::string("null") : json::quote(XML_ErrorString(code))) +
               ",\"line\":" + std::to_string(XML_GetCurrentLineNumber(parser)) + ",\"column\":" + std::to_string(XML_GetCurrentColumnNumber(parser)) +
               ",\"inputBytes\":" + std::to_string(inputBytes) + ",\"textBytes\":" + json::integer(run.textBytes) +
               ",\"elements\":" + json::integer(run.elements) + ",\"maxDepth\":" + std::to_string(run.maxDepth) +
               ",\"stoppedByDepth\":" + (run.stoppedByDepth ? "true" : "false") + ",\"entityCount\":" + std::to_string(run.entityCount) +
               ",\"entities\":[" + run.entities + "],\"doctype\":" + run.doctype + ",\"external\":[" + run.external + "]}";
    }
};
