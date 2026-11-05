#pragma once

// What the probe's sources share, from the folder its descriptor's includes names.
#ifdef __cplusplus
#include "crossbind/extension.h"

// What the probe adds on its platform alone, from the source of the platform's.
void probePlatform(crossbind::Registry &registry);

extern "C" {
#endif

// A sum the probe's C source makes, with the offset its descriptor's defines give it.
int crossbind_probe_sum(int a, int b);

#ifdef __cplusplus
}
#endif
