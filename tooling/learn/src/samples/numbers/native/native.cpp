#include "native.h"

double average(int a, int b) {
    return (a + b) / 2.0;
}

bool isEven(int value) {
    return value % 2 == 0;
}

int64_t fibonacci(int n) {
    int64_t previous = 0;
    int64_t current = 1;
    for (int i = 0; i < n; ++i) {
        const int64_t next = previous + current;
        previous = current;
        current = next;
    }
    return previous;
}
