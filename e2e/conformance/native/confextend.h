#ifndef _CROSSBIND_CONFORMANCE_CONFEXTEND_H
#define _CROSSBIND_CONFORMANCE_CONFEXTEND_H

#include <memory>
#include <string>

// The class whose hand-written interface, confextend.i beside this header, adds methods with %extend, and the
// templates whose instances it names with %template.

class ConfExtended {
public:
    explicit ConfExtended(const std::string &name) : value(name) {}
    static std::shared_ptr<ConfExtended> shared(const std::string &name) { return std::make_shared<ConfExtended>(name); }
    std::string name() const { return value; }
    int size() const { return static_cast<int>(value.size()); }

private:
    std::string value;
};

template <typename T> class ConfTemplateBox {
public:
    ConfTemplateBox() : value() {}
    void set(T v) { value = v; }
    T get() const { return value; }

private:
    T value;
};

template <typename T> T confLarger(T a, T b) { return a > b ? a : b; }

#endif
