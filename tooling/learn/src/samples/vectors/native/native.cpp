#include "native.h"

#include <sstream>

double mean(const std::vector<double> &values) {
    double sum = 0;
    for (const double value : values) sum += value;
    return values.empty() ? 0 : sum / values.size();
}

std::vector<std::string> split(std::string text, char separator) {
    std::vector<std::string> parts;
    std::istringstream stream(text);
    std::string part;
    while (std::getline(stream, part, separator)) {
        parts.push_back(part);
    }
    return parts;
}

std::map<std::string, int> countWords(const std::string &text) {
    std::map<std::string, int> counts;
    for (const std::string &word : split(text, ' ')) counts[word] += 1;
    return counts;
}
