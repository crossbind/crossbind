#include "crossbind/extension.h"

// The host's page-downloads: each download saves as the platform's host does, where the app's user picks, or on Linux
// in their Downloads folder.
void crossbind_extension_page_downloads(crossbind::Registry &registry) {
    registry.onDownload([](crossbind::Download download) { download.ask(); });
}
