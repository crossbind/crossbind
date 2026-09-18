#ifndef _CROSSBIND_CONFORMANCE_CONFCALLBACKS_H
#define _CROSSBIND_CONFORMANCE_CONFCALLBACKS_H

// C function pointers take a JS function (or a native function pointer handed back as a handle),
// keep it in a slot until releaseCallback, and pass their arguments by the same rules as direct
// calls: const char* as a string, numbers as numbers, pointers as handles.

struct ConfCbPair {
    int left;
    int right;
};

typedef int (*ConfCbBinary)(int a, int b);
typedef void (*ConfCbNotify)(const char *message, int level);
typedef double (*ConfCbScale)(double value);
typedef int (*ConfCbPairFn)(const ConfCbPair *pair);

extern "C" {
inline int confCbPairSum(const ConfCbPair *pair) { return pair ? pair->left * 10 + pair->right : -1; }
}

inline int confCbApply(ConfCbBinary fn, int a, int b) { return fn ? fn(a, b) : -1; }
inline int confCbNotify(ConfCbNotify fn, const char *message, int level) {
    if (fn) fn(message, level);
    return level * 2;
}
inline double confCbScaleTwice(ConfCbScale fn, double value) { return fn(fn(value)); }
inline int confCbWithPair(ConfCbPairFn fn, int left, int right) {
    ConfCbPair pair = {left, right};
    return fn(&pair);
}
inline int confCbAdd(int a, int b) { return a + b; }
inline ConfCbBinary confCbNative() { return &confCbAdd; }

#ifndef SWIG
inline ConfCbBinary &confCbSlot() {
    static ConfCbBinary slot = nullptr;
    return slot;
}
#endif
inline void confCbRetain(ConfCbBinary fn) { confCbSlot() = fn; }
inline int confCbCallRetained(int a, int b) { return confCbSlot() ? confCbSlot()(a, b) : -1; }
inline int confCbVariadic(const char *format, ...) { return format ? 1 : 0; }

#endif
