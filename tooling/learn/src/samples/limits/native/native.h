#pragma once

#include <string>

// A template has no single type to bind. A plain function
// over it does.
template <typename T>
T larger(T a, T b) { return a > b ? a : b; }
int largerInt(int a, int b);

// Overloads are told apart by how many arguments they take,
// so only one of the first two can be reached.
std::string describe(int value);
std::string describe(const std::string &text);
std::string describe(int value, const std::string &unit);
