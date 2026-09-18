#ifndef _CROSSBIND_CONFORMANCE_CONFPOINTERS_H
#define _CROSSBIND_CONFORMANCE_CONFPOINTERS_H

#include <cstdlib>
#include <string>

// Pointer handles and the helpers that read and write them: numbers, bytes, void*, structs by
// pointer, opaque C-API handles, pointer slots (T**) and out-parameters. Header-only like the
// rest of the kit; every definition is inline because more than one bridge includes this file.

struct ConfPtrPoint {
    int x;
    int y;
};

struct ConfPtrOpaque;
typedef struct ConfPtrOpaque *ConfPtrHandle;

extern "C" {
inline int confPtrSum(const int *values, int count) {
    int total = 0;
    for (int i = 0; i < count; ++i) total += values[i];
    return total;
}
inline void confPtrFill(int *values, int count, int start) {
    for (int i = 0; i < count; ++i) values[i] = start + i;
}
inline double confPtrMean(const double *values, int count) {
    double total = 0;
    for (int i = 0; i < count; ++i) total += values[i];
    return count ? total / count : 0;
}
inline int confPtrByteAt(const unsigned char *bytes, int index) { return bytes[index]; }
inline const int *confPtrPrimes() {
    static const int primes[3] = {2, 3, 5};
    return primes;
}
inline int confPtrPointSum(const ConfPtrPoint *point) { return point ? point->x * 10 + point->y : -1; }
inline ConfPtrPoint *confPtrMakePoint(int x, int y) {
    ConfPtrPoint *point = static_cast<ConfPtrPoint *>(std::malloc(sizeof(ConfPtrPoint)));
    point->x = x;
    point->y = y;
    return point;
}
inline void confPtrFreePoint(ConfPtrPoint *point) { std::free(point); }
inline ConfPtrHandle confPtrOpen(int seed) {
    int *cell = static_cast<int *>(std::malloc(sizeof(int)));
    *cell = seed;
    return reinterpret_cast<ConfPtrHandle>(cell);
}
inline int confPtrRead(ConfPtrHandle handle) { return handle ? *reinterpret_cast<int *>(handle) : -1; }
inline void confPtrClose(ConfPtrHandle handle) { std::free(handle); }
inline int confPtrSwap(int *a, int *b) {
    int kept = *a;
    *a = *b;
    *b = kept;
    return *a * 10 + *b;
}
inline void *confPtrRaw(int tag) {
    int *cell = static_cast<int *>(std::malloc(sizeof(int)));
    *cell = tag;
    return cell;
}
inline int confPtrTag(const void *raw) { return raw ? *static_cast<const int *>(raw) : -1; }
inline void confPtrFreeRaw(void *raw) { std::free(raw); }
inline int confPtrDouble(int **slot) {
    if (!slot || !*slot) return -1;
    **slot *= 2;
    return **slot;
}
}

inline int confPtrOutRef(int &out, int value) {
    out = value * 3;
    return value;
}
inline void confPtrAppend(std::string &text) { text += "!"; }

#endif
