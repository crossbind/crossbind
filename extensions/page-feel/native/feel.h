#pragma once

namespace crossbind::pagefeel {

// ASCII alone, as Android and Windows take it without converting it.
extern const char *const PAGE_SCRIPT;

// Has a window's webview run PAGE_SCRIPT in each of its pages, and turns off what its platform's settings turn off, before
// its first page loads.
void configure(void *webView);

}  // namespace crossbind::pagefeel
