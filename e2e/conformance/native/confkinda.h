#ifndef _CROSSBIND_CONFORMANCE_CONFKINDA_H
#define _CROSSBIND_CONFORMANCE_CONFKINDA_H

// The same enum name as confkindb.h: two bridges register it, the first claim wins, both work.
enum class ConfKind { Solid = 1, Dashed = 2 };

inline int confKindA(ConfKind kind) { return static_cast<int>(kind) * 10; }

#endif
