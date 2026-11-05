// The shell on Linux, which GIO and the desktop's file manager answer.
#include "shell.h"

#include <gio/gio.h>

#include <memory>

namespace crossbind::shell {
namespace {

using Failure = std::optional<std::string>;

// What the system opens a URI with, or why it cannot.
Failure launch(const std::string &uri, const std::string &what) {
    GError *error = nullptr;
    if (g_app_info_launch_default_for_uri(uri.c_str(), nullptr, &error)) return std::nullopt;
    const std::string reason = error ? error->message : "nothing opens it";
    g_clear_error(&error);
    return "crossbind: cannot open " + what + ": " + reason;
}

// A file revealFile shows, until the file manager answers.
struct Reveal {
    std::string path;
    Done done;
};

void openFolderOf(const Reveal &reveal) {
    gchar *folder = g_path_get_dirname(reveal.path.c_str());
    gchar *folderUri = g_filename_to_uri(folder, nullptr, nullptr);
    reveal.done(folderUri ? launch(folderUri, folder) : Failure("crossbind: there is no folder of " + reveal.path));
    g_free(folderUri);
    g_free(folder);
}

}  // namespace

void openUrl(std::string url, Done done) {
    onMainThread([url = std::move(url), done = std::move(done)] { done(launch(url, url)); });
}

void openFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        gchar *uri = g_file_test(path.c_str(), G_FILE_TEST_EXISTS) ? g_filename_to_uri(path.c_str(), nullptr, nullptr) : nullptr;
        if (!uri) {
            done("crossbind: there is no " + path);
            return;
        }
        done(launch(uri, path));
        g_free(uri);
    });
}

// A mount without a trash, as a network share may be, fails it rather than deleting the file.
void trashFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        if (!g_file_test(path.c_str(), G_FILE_TEST_EXISTS)) {
            done("crossbind: there is no " + path);
            return;
        }
        GFile *file = g_file_new_for_path(path.c_str());
        GError *error = nullptr;
        if (g_file_trash(file, nullptr, &error)) {
            done(std::nullopt);
        } else {
            done("crossbind: cannot move " + path + " to the trash: " + error->message);
            g_error_free(error);
        }
        g_object_unref(file);
    });
}

// The file managers of GNOME, KDE and others show a file selected when asked over D-Bus; without one, its folder opens.
// The answer comes back to the loop, which a file manager that has to start first would hold up otherwise.
void revealFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)]() mutable {
        gchar *uri = g_file_test(path.c_str(), G_FILE_TEST_EXISTS) ? g_filename_to_uri(path.c_str(), nullptr, nullptr) : nullptr;
        if (!uri) {
            done("crossbind: there is no " + path);
            return;
        }
        auto reveal = std::make_unique<Reveal>(Reveal{std::move(path), std::move(done)});
        GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
        if (!bus) {
            openFolderOf(*reveal);
            g_free(uri);
            return;
        }
        const gchar *uris[] = {uri, nullptr};
        g_dbus_connection_call(bus, "org.freedesktop.FileManager1", "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1",
                               "ShowItems", g_variant_new("(^ass)", uris, ""), nullptr, G_DBUS_CALL_FLAGS_NONE, -1, nullptr,
                               [](GObject *source, GAsyncResult *result, gpointer data) {
                                   const std::unique_ptr<Reveal> reveal(static_cast<Reveal *>(data));
                                   GVariant *shown = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, nullptr);
                                   if (!shown) {
                                       openFolderOf(*reveal);
                                       return;
                                   }
                                   g_variant_unref(shown);
                                   reveal->done(std::nullopt);
                               },
                               reveal.release());
        g_object_unref(bus);
        g_free(uri);
    });
}

}  // namespace crossbind::shell
