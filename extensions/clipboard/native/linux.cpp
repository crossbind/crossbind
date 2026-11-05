#include "clipboard.h"

#include <gtk/gtk.h>

#include <memory>

namespace crossbind::clipboard {

// GTK asks the clipboard's owner for its text, which may be another app, and answers on the main loop.
void readText(Call call) {
    onMainThread([call] {
        gtk_clipboard_request_text(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD), [](GtkClipboard *, const gchar *text, gpointer data) {
            const std::unique_ptr<Call> asked(static_cast<Call *>(data));
            asked->resolve(std::string(text ? text : ""));
        }, new Call(call));
    });
}

void writeText(Call call, std::string text) {
    onMainThread([call, text] {
        gtk_clipboard_set_text(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD), text.data(), static_cast<gint>(text.size()));
        call.resolve();
    });
}

}  // namespace crossbind::clipboard
