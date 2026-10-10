#include "native.h"

std::string greet(const std::string &name) {
    return "Hello, " + name + "!";
}

Counter::Counter(int start) : current(start) {}

int Counter::increment() {
    return ++current;
}

int Counter::value() const {
    return current;
}
