#include "dialogs.h"

// The host's page-dialogs: the page's alert(), confirm() and prompt() in the platform's own dialog, as an app's
// extension of this name may show them otherwise.
void crossbind_extension_page_dialogs(crossbind::Registry &registry) { registry.onPageDialog(showPageDialog); }
