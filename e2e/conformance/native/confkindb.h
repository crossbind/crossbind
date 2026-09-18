#ifndef _CROSSBIND_CONFORMANCE_CONFKINDB_H
#define _CROSSBIND_CONFORMANCE_CONFKINDB_H

// See confkinda.h.
enum class ConfKind { Solid = 1, Dashed = 2 };

inline int confKindB(ConfKind kind) { return static_cast<int>(kind) * 100; }

#endif
