#include "native.h"

#include <stdexcept>

std::optional<int> indexOf(const std::string &text, char letter) {
    const auto at = text.find(letter);
    if (at == std::string::npos) return std::nullopt;
    return static_cast<int>(at);
}

int parsePercent(const std::string &text) {
    const int value = std::stoi(text);
    if (value < 0 || value > 100) {
        throw std::out_of_range("not between 0 and 100");
    }
    return value;
}
