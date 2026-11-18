#pragma once

#include <map>
#include <string>
#include <vector>

// A std::vector parameter takes a plain array.
double mean(const std::vector<double> &values);

// A returned vector or map arrives as an object of its own;
// the module's toArray makes an array of a vector.
std::vector<std::string> split(std::string text, char separator);
std::map<std::string, int> countWords(const std::string &text);
