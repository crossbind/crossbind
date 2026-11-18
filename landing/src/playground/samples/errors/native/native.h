#pragma once

#include <optional>
#include <string>

// An empty std::optional arrives as no value.
std::optional<int> indexOf(const std::string &text, char letter);

// A C++ exception arrives as an Error you can catch.
int parsePercent(const std::string &text);
