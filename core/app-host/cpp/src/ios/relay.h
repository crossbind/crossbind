#pragma once

// A debug app on an iPhone or iPad loads its page from the device's own localhost and carries that port to the dev server
// on the Mac. A release app has none of it.
#ifdef CROSSBIND_APP_DEV

#include "host_core.h"

#include <functional>

// Listens on the device's localhost, IPv4 and IPv6, at the port of the page's URL, and carries every connection there,
// both ways, to the dev server CROSSBIND_APP_DEV_SERVER names; without it, as in the Simulator, does nothing. Ends the
// app, saying why, where another app holds that port.
void relayDevServer(crossbind::app::Core &core, const char *devUrl);
// Runs `load` on the main thread once the dev server has answered through the relay, at once without a relay.
void whenDevServerAnswers(std::function<void()> load);

#endif
