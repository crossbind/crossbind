#ifndef CONF_EXTRAS_H
#define CONF_EXTRAS_H

#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstring>

// What SWIG skips and crossbind binds for the names a leg imports: variadic functions, function-like macros, a macro
// naming a function and mutable globals.

// Reads one extra argument per letter of `kinds`, as the C ABI hands it over.
inline double confVaSum(const char *kinds, ...) {
    va_list ap;
    va_start(ap, kinds);
    double sum = 0;
    for (const char *kind = kinds; *kind; ++kind) {
        switch (*kind) {
            case 'i': sum += va_arg(ap, int); break;
            case 'u': sum += va_arg(ap, unsigned int); break;
            case 'l': sum += static_cast<double>(va_arg(ap, long)); break;
            case 'L': sum += static_cast<double>(va_arg(ap, long long)); break;
            case 'd': sum += va_arg(ap, double); break;
            case 's': sum += static_cast<double>(std::strlen(va_arg(ap, const char *))); break;
            case 'p': sum += *va_arg(ap, int *); break;
            case 'n': sum += va_arg(ap, void *) == nullptr ? 1000 : -1000; break;
            default: break;
        }
    }
    va_end(ap);
    return sum;
}

// A C library declared with __THROW makes its variadic functions noexcept in C++.
inline int confVaNoexcept(int count, ...) noexcept {
    va_list ap;
    va_start(ap, count);
    int sum = 0;
    for (int i = 0; i < count; ++i) sum += va_arg(ap, int);
    va_end(ap);
    return sum;
}

struct ConfVaBuffer {
    char text[64];
};

inline const char *confVaFormat(ConfVaBuffer *buffer, const char *format, ...) {
    va_list ap;
    va_start(ap, format);
    std::vsnprintf(buffer->text, sizeof buffer->text, format, ap);
    va_end(ap);
    return buffer->text;
}

inline int confMacroAdd_(int a, int b, int base) { return a + b + base; }
#define confMacroAdd(a, b) confMacroAdd_((a), (b), 100)

inline std::size_t confMacroLength_(const char *text) { return std::strlen(text); }
#define confMacroLength(text) (confMacroLength_((const char *)(text)))

inline double confMacroHalf_(double value) { return value / 2; }
#define confMacroHalf(value) confMacroHalf_(value)

inline long long confMacroWide_(long long value) { return value; }
#define confMacroWide(value) confMacroWide_(value)

inline int confRenamedTarget(int value) { return value * 3; }
#define confRenamed confRenamedTarget

inline int confCounter = 7;
inline const char *confGreeting = "hello";

inline int confCounterValue() { return confCounter; }
inline const char *confGreetingValue() { return confGreeting; }

#endif
