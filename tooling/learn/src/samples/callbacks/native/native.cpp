#include "native.h"

void countdown(int from, Visitor visit) {
    for (int value = from; value > 0; --value) visit(value);
}

int applyTwice(Transform transform, int value) {
    return transform(transform(value));
}
