#include "native.h"

#include <fstream>

int countLines(const std::string &path) {
    std::ifstream file(path);
    int lines = 0;
    for (std::string line; std::getline(file, line);) lines += 1;
    return lines;
}

void append(const std::string &path, const std::string &line) {
    std::ofstream(path, std::ios::app) << line << '\n';
}
