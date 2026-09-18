#ifndef _CROSSBIND_CONFORMANCE_CONFPRELUDE_H
#define _CROSSBIND_CONFORMANCE_CONFPRELUDE_H

// Not self-contained on purpose: ConfPreludeUnit comes from confpreludedeps.h, which the kit's
// config lists as this header's prelude (export.headerPrelude).
inline ConfPreludeUnit confPreludeTwice(ConfPreludeUnit value) { return value * 2 + confPreludeBase(); }

#endif
