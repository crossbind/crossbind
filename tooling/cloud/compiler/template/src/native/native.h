#pragma once

#include <string>

// Everything this header declares can be called from JavaScript.
std::string greet(const std::string &name);

class Counter {
public:
    explicit Counter(int start);
    int increment();
    int value() const;

private:
    int current;
};
