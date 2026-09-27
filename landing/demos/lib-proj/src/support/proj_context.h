#pragma once

#include <proj.h>

#include <memory>
#include <stdexcept>
#include <string>

// What the app wrappers share: one PROJ context per wrapper object and PROJ objects owned by
// unique_ptr. PROJ tells why a definition failed only through its log ("crs not found:
// EPSG:99999"), so the context keeps the last error it logged and throws with it.
namespace projapp {

struct Release {
    void operator()(PJ* object) const { proj_destroy(object); }
};
using Object = std::unique_ptr<PJ, Release>;

class Context {
public:
    Context() : context(proj_context_create()) { proj_log_func(context, &error, remember); }
    ~Context() { proj_context_destroy(context); }
    Context(const Context&) = delete;
    Context& operator=(const Context&) = delete;

    PJ_CONTEXT* get() const { return context; }

    // Owns what a PROJ call returned, or throws PROJ's reason when it returned nothing.
    Object own(PJ* object, const std::string& fallback) {
        if (!object) fail(fallback);
        return Object(object);
    }

    Object crs(const std::string& definition) {
        error.clear();
        Object object = own(proj_create(context, definition.c_str()), "PROJ cannot read " + shortened(definition));
        if (!proj_is_crs(object.get())) throw std::runtime_error(shortened(definition) + " is not a coordinate reference system");
        return object;
    }

    [[noreturn]] void fail(const std::string& fallback) {
        const std::string reason = error.empty() ? fallback : error;
        error.clear();
        throw std::runtime_error(reason);
    }

    static std::string shortened(const std::string& text) { return text.size() > 60 ? text.substr(0, 57) + "..." : text; }

private:
    static void remember(void* error, int level, const char* message) {
        if (level == PJ_LOG_ERROR) *static_cast<std::string*>(error) = message;
    }

    PJ_CONTEXT* context;
    std::string error;
};

}  // namespace projapp
