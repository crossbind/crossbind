#include "dialog.h"

#include <gtk/gtk.h>

namespace crossbind::dialog {
namespace {

// The window a dialog is modal to: the calling page's, or the app's oldest.
GtkWindow *parentOf(uint64_t window) {
    const std::optional<Window> open = windowOf(window);
    return static_cast<GtkWindow *>(open ? open->native() : appWindow());
}

// GTK matches a pattern in one case alone, where macOS and Windows match an extension in any; "*" is any file.
std::string patternOf(const std::string &extension) {
    if (extension == "*") return "*";
    std::string pattern = "*.";
    for (const char c : extension) {
        const char lower = g_ascii_tolower(c);
        const char upper = g_ascii_toupper(c);
        pattern += lower == upper ? std::string(1, c) : std::string{'[', lower, upper, ']'};
    }
    return pattern;
}

void addFilters(GtkFileChooser *chooser, const std::vector<app::FileFilter> &filters) {
    for (const auto &filter : filters) {
        GtkFileFilter *kind = gtk_file_filter_new();
        gtk_file_filter_set_name(kind, filter.name.c_str());
        for (const auto &extension : filter.extensions) gtk_file_filter_add_pattern(kind, patternOf(extension).c_str());
        gtk_file_chooser_add_filter(chooser, kind);
    }
}

}  // namespace

// The portal's chooser where there is one, as in a Flatpak, else GTK's own; modal to the app's window.
void showOpenDialog(uint64_t window, app::OpenOptions options, std::function<void(Picked)> done) {
    onMainThread([window, options = std::move(options), done = std::move(done)] {
        GtkFileChooserNative *dialog = gtk_file_chooser_native_new(options.title.empty() ? nullptr : options.title.c_str(), parentOf(window),
            options.directory ? GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER : GTK_FILE_CHOOSER_ACTION_OPEN, nullptr, nullptr);
        GtkFileChooser *chooser = GTK_FILE_CHOOSER(dialog);
        gtk_file_chooser_set_select_multiple(chooser, options.multiple);
        if (!options.defaultPath.empty()) gtk_file_chooser_set_current_folder(chooser, options.defaultPath.c_str());
        addFilters(chooser, options.filters);
        Picked picked;
        if (gtk_native_dialog_run(GTK_NATIVE_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
            picked.emplace();
            GSList *files = gtk_file_chooser_get_filenames(chooser);
            for (GSList *file = files; file; file = file->next) {
                picked->push_back(static_cast<char *>(file->data));
                g_free(file->data);
            }
            g_slist_free(files);
        }
        g_object_unref(dialog);
        done(std::move(picked));
    });
}

void showSaveDialog(uint64_t window, app::SaveOptions options, std::function<void(std::optional<std::string>)> done) {
    onMainThread([window, options = std::move(options), done = std::move(done)] {
        GtkFileChooserNative *dialog = gtk_file_chooser_native_new(options.title.empty() ? nullptr : options.title.c_str(), parentOf(window),
            GTK_FILE_CHOOSER_ACTION_SAVE, nullptr, nullptr);
        GtkFileChooser *chooser = GTK_FILE_CHOOSER(dialog);
        gtk_file_chooser_set_do_overwrite_confirmation(chooser, TRUE);
        if (!options.defaultPath.empty()) gtk_file_chooser_set_current_folder(chooser, options.defaultPath.c_str());
        if (!options.defaultName.empty()) gtk_file_chooser_set_current_name(chooser, options.defaultName.c_str());
        addFilters(chooser, options.filters);
        std::optional<std::string> file;
        if (gtk_native_dialog_run(GTK_NATIVE_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
            if (char *name = gtk_file_chooser_get_filename(chooser)) {
                file = name;
                g_free(name);
            }
        }
        g_object_unref(dialog);
        done(std::move(file));
    });
}

// Modal to the app's window, its buttons in GNOME's order: the first, the default, on the right.
void showMessageDialog(uint64_t window, app::MessageOptions options, std::function<void(int)> done) {
    onMainThread([window, options = std::move(options), done = std::move(done)] {
        const GtkMessageType type = options.kind == app::MessageKind::error     ? GTK_MESSAGE_ERROR
                                    : options.kind == app::MessageKind::warning ? GTK_MESSAGE_WARNING
                                                                                : GTK_MESSAGE_INFO;
        GtkWidget *dialog = gtk_message_dialog_new(parentOf(window), GTK_DIALOG_MODAL, type, options.buttons.empty() ? GTK_BUTTONS_OK : GTK_BUTTONS_NONE,
                                                   "%s", options.message.c_str());
        if (!options.detail.empty()) gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog), "%s", options.detail.c_str());
        gtk_window_set_title(GTK_WINDOW(dialog), appName().c_str());
        for (int i = static_cast<int>(options.buttons.size()) - 1; i >= 0; i -= 1) {
            // A label's underscores stay as they are.
            gtk_button_set_use_underline(GTK_BUTTON(gtk_dialog_add_button(GTK_DIALOG(dialog), options.buttons[i].c_str(), i)), FALSE);
        }
        gtk_dialog_set_default_response(GTK_DIALOG(dialog), options.buttons.empty() ? GTK_RESPONSE_OK : 0);
        const int response = gtk_dialog_run(GTK_DIALOG(dialog));
        gtk_widget_destroy(dialog);
        // Escape and closing the dialog answer GTK_RESPONSE_DELETE_EVENT.
        done(response >= 0 ? response : response == GTK_RESPONSE_OK ? 0 : NO_BUTTON);
    });
}

}  // namespace crossbind::dialog
