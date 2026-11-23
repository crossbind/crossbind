#pragma once

// What the probe's sources share, from the folder its descriptor's includes names.
#ifdef __cplusplus
#include "crossbind/extension.h"

#include <functional>
#include <string>

// What the probe adds on its platform alone, from the source of the platform's.
void probePlatform(crossbind::Registry &registry);

// Closes the message dialog the app shows of this message, as its user would, from any thread: done gets whether one
// showed, and the title of its window on Windows and Linux, "" elsewhere. Windows' task dialog tells no text, so there
// the app's one dialog closes.
void closeMessageDialog(const std::string &message, std::function<void(bool isShown, const std::string &title)> done);

// The probe's origins and its fetch, from origins.cpp.
void probeOrigins(crossbind::Registry &registry);

#if defined(__APPLE__) || defined(_WIN32)
// Tells the app it became active or inactive as its system does, on the main thread.
void tellActive(bool isActive);
#endif

extern "C" {
#endif

// A sum the probe's C source makes, with the offset its descriptor's defines give it.
int crossbind_probe_sum(int a, int b);

#ifdef __cplusplus
}
#endif
