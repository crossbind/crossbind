#ifndef _CROSSBIND_CONFORMANCE_CONFTYPES2_H
#define _CROSSBIND_CONFORMANCE_CONFTYPES2_H

#include "conftypes.h"

// A second header using what the first defines (its bridge depends on types.h's bindings) and
// repeating one of its declarations, which only the first registration may claim.

int confTypeSides(const ConfTypeShape *shape);
inline int confType2Corners(const ConfTypeQuad *quad) { return quad ? quad->corners() * 10 : -1; }
inline ConfMode confType2Flip(ConfMode mode) { return confTypeSafer(mode); }

#endif
