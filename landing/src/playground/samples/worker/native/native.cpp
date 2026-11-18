#include "native.h"

#include <cmath>

double slowSum(int count) {
    double sum = 0;
    for (int i = 1; i <= count; ++i) sum += std::sqrt(i);
    return sum;
}
