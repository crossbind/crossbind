#pragma once

// A function pointer parameter takes a JavaScript function,
// which C++ then calls like any other.
typedef void (*Visitor)(int value);
typedef int (*Transform)(int value);

void countdown(int from, Visitor visit);
int applyTwice(Transform transform, int value);
