#include "native.h"

void invert(uint8_t *pixels, size_t length) {
    for (size_t i = 0; i < length; ++i) pixels[i] = 255 - pixels[i];
}

uint32_t checksum(const uint8_t *bytes, size_t length) {
    uint32_t sum = 0;
    for (size_t i = 0; i < length; ++i) sum = sum * 31 + bytes[i];
    return sum;
}
