// The files the system opens the app with that no extension's type takes, those of app.fileTypes among them, which the
// build gives this extension: the page asks for those that came before it listened with crossbind/app's
// app.launchFiles(), and hears of each later opening as the event open-files.
#include "crossbind/app.h"
#include "crossbind/extension.h"

void crossbind_extension_files(crossbind::Registry &registry) {
    registry.onOpenFiles([](const std::vector<std::string> &paths) {
        crossbind::app::holdEvent("open-files", crossbind::Value(crossbind::Value::Object{{"paths", paths}}).json());
    });
}
