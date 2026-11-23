#pragma once

#include <cstdint>

// int, double and bool cross as JavaScript numbers and booleans.
double average(int a, int b);
bool isEven(int value);

// A 64-bit integer crosses as a BigInt, exact past 2^53.
int64_t fibonacci(int n);
