#pragma once

#include <cstdint>

// Marsaglia's xorshift32. The apps generate their data with it so the page, the module and the
// Python reference behind the expected numbers all see the same values.
class XorShift32 {
public:
    explicit XorShift32(uint32_t seed) : state(seed) {}

    uint32_t next() {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return state;
    }

private:
    uint32_t state;
};
