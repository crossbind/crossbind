#include "native.h"

int largerInt(int a, int b) {
    return larger(a, b);
}

std::string describe(int value) {
    return "the number " + std::to_string(value);
}

std::string describe(const std::string &text) {
    return "the text " + text;
}

std::string describe(int value, const std::string &unit) {
    return std::to_string(value) + " " + unit;
}
