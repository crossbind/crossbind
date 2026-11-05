#include "dialogs.h"

#include <gtk/gtk.h>

using crossbind::PageDialog;

namespace {

// The dialog holds the page's until it goes, which then answers it as cancelled unless its user answered.
void forget(gpointer dialog, GClosure *) { delete static_cast<PageDialog *>(dialog); }

void responded(GtkDialog *box, gint response, gpointer data) {
    const auto *dialog = static_cast<const PageDialog *>(data);
    auto *entry = static_cast<GtkEntry *>(g_object_get_data(G_OBJECT(box), "crossbind-entry"));
    if (response == GTK_RESPONSE_OK) dialog->accept(entry ? gtk_entry_get_text(entry) : "");
    else dialog->cancel();
    gtk_widget_destroy(GTK_WIDGET(box));
}

}  // namespace

// A dialog of the app's window, with the app's name over the message, as GTK shows its own.
void showPageDialog(PageDialog dialog) {
    const std::string title = crossbind::appName();
    GtkWidget *box = gtk_message_dialog_new(static_cast<GtkWindow *>(crossbind::appWindow()), GtkDialogFlags(GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT),
                                            GTK_MESSAGE_OTHER, dialog.kind() == PageDialog::Kind::alert ? GTK_BUTTONS_OK : GTK_BUTTONS_OK_CANCEL, "%s",
                                            title.c_str());
    gtk_window_set_title(GTK_WINDOW(box), title.c_str());
    gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(box), "%s", dialog.message().c_str());
    if (dialog.kind() == PageDialog::Kind::prompt) {
        GtkWidget *entry = gtk_entry_new();
        gtk_entry_set_text(GTK_ENTRY(entry), dialog.defaultText().c_str());
        gtk_entry_set_activates_default(GTK_ENTRY(entry), TRUE);
        gtk_container_add(GTK_CONTAINER(gtk_message_dialog_get_message_area(GTK_MESSAGE_DIALOG(box))), entry);
        gtk_widget_show(entry);
        gtk_widget_grab_focus(entry);
        g_object_set_data(G_OBJECT(box), "crossbind-entry", entry);
    }
    gtk_dialog_set_default_response(GTK_DIALOG(box), GTK_RESPONSE_OK);
    g_signal_connect_data(box, "response", G_CALLBACK(responded), new PageDialog(std::move(dialog)), forget, GConnectFlags(0));
    gtk_window_present(GTK_WINDOW(box));
}
