#pragma once

#include <cstddef>
#include <cstdint>

// A raw pointer crosses as a handle: JavaScript allocates the
// block, C++ works on it in place, JavaScript reads it back.
void invert(uint8_t *pixels, size_t length);
uint32_t checksum(const uint8_t *bytes, size_t length);
