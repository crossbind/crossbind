#ifndef _CROSSBIND_CONFORMANCE_CONFEXTEND_H
#define _CROSSBIND_CONFORMANCE_CONFEXTEND_H

#include <memory>
#include <string>

// The class whose hand-written interface, confextend.i beside this header, adds methods with %extend.

class ConfExtended {
public:
    explicit ConfExtended(const std::string &name) : value(name) {}
    static std::shared_ptr<ConfExtended> shared(const std::string &name) { return std::make_shared<ConfExtended>(name); }
    std::string name() const { return value; }
    int size() const { return static_cast<int>(value.size()); }

private:
    std::string value;
};

#endif
