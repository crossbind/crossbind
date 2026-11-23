#include "native.h"

double add(double a, double b) {
    return a + b;
}

double sumTo(int count) {
    double sum = 0;
    for (int i = 1; i <= count; ++i) sum = add(sum, i);
    return sum;
}
