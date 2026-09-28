#ifndef CONF_CONSTANTS_H
#define CONF_CONSTANTS_H

#include "confconstantsbase.h"

// A constant binds only when a leg imports it by name; no leg imports CONF_NOT_IMPORTED.
#define CONF_INT 42
#define CONF_NEGATIVE (-7)
#define CONF_HEX 0x10
#define CONF_EXPRESSION (CONF_INT * 2 + CONF_BASE)
#define CONF_DOUBLE 2.5
#define CONF_STRING "crossbind"
#define CONF_CHAR 'A'
#define CONF_WIDE 4294967296LL
#define CONF_TRUE true
#define CONF_NOT_IMPORTED 99

// SWIG reads the #else branch; each platform's compiler picks its own.
#if defined(__EMSCRIPTEN__)
#define CONF_PLATFORM 1
#else
#define CONF_PLATFORM 2
#endif

inline constexpr int confGlobal = 5;
inline constexpr const char *confGlobalName = "global";
inline int confMutable = 6;

#endif
