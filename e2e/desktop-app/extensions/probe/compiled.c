// The probe's C, which the host compiles as C, with the probe's include folder and macros.
#include "probe.h"

int crossbind_probe_sum(int a, int b) { return a + b + PROBE_OFFSET; }
