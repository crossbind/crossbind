#ifndef _CROSSBIND_CONFORMANCE_H
#define _CROSSBIND_CONFORMANCE_H

#include <cmath>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// Header-only on purpose: the generated bridge TU includes this file, so every app compiles
// the same C++ conformance surface without scheduling a separate source file.

// Class core: constructor, public fields, instance methods, string/vector/number/bool wires,
// and a shared_ptr static factory.
class ConfBox {
public:
    int width;
    int height;

    ConfBox(int w, int h) : width(w), height(h) {}

    static std::shared_ptr<ConfBox> square(int side) {
        return std::make_shared<ConfBox>(side, side);
    }

    int area() { return width * height; }
    bool wide() { return width > height; }
    double scale(double factor) { return area() * factor; }
    std::string tag(std::string prefix) { return prefix + std::to_string(area()); }
    std::vector<int> dims() { return { width, height }; }
    std::vector<std::string> letters() { return { "x", "y" }; }
    int sum(std::vector<int> xs) {
        int total = 0;
        for (int x : xs) total += x;
        return total;
    }
    std::string join(std::vector<std::string> parts) {
        std::string out;
        for (const auto& p : parts) {
            if (!out.empty()) out += ",";
            out += p;
        }
        return out;
    }
    int areaPlusFifteen(int a1, int a2, int a3, int a4, int a5, int a6, int a7, int a8, int a9, int a10,
                        int a11, int a12, int a13, int a14, int a15) {
        return area() + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11 + a12 + a13 + a14 + a15;
    }
};

// Single-base virtual dispatch: describe() resolves kind() through the vtable, and the
// factory hands the derived instance out as shared_ptr<Base>.
class ConfShape {
public:
    virtual ~ConfShape() {}
    virtual std::string kind() { return "shape"; }
    std::string describe() { return "I am " + kind(); }
};

class ConfCircle : public ConfShape {
public:
    std::string kind() { return "circle"; }
    static std::shared_ptr<ConfShape> asShape() { return std::make_shared<ConfCircle>(); }
};

// Free-standing statics: exceptions -> JS Error, std::optional -> null/undefined.
class ConfOps {
public:
    static double checkedSqrt(double x) {
        if (x < 0) throw std::invalid_argument("sqrt of negative");
        return std::sqrt(x);
    }
    static std::optional<int> half(int v) {
        if (v % 2 != 0) return std::nullopt;
        return v / 2;
    }
    static std::string echo(std::string s) { return s; }
    static int sumOfSixteen(int a1, int a2, int a3, int a4, int a5, int a6, int a7, int a8, int a9, int a10,
                            int a11, int a12, int a13, int a14, int a15, int a16) {
        return a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11 + a12 + a13 + a14 + a15 + a16;
    }
};

#endif
