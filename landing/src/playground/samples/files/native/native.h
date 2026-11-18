#pragma once

#include <string>

// C++ opens files with its own library. On the web they live in
// the module's file system, which JavaScript reads and writes.
int countLines(const std::string &path);
void append(const std::string &path, const std::string &line);
