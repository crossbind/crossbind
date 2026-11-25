// The dialog up over the app's window, as its user reads it, and its buttons as its user clicks them: the run's way to
// the preview extension's question on Linux.
#include "crossbind/extension.h"

#include <gtk/gtk.h>

#include <vector>

namespace {

using crossbind::Call;
using crossbind::Value;

GtkWidget *dialogUp() {
    GtkWidget *found = nullptr;
    GList *windows = gtk_window_list_toplevels();
    for (GList *each = windows; each; each = each->next) {
        if (GTK_IS_MESSAGE_DIALOG(each->data) && gtk_widget_get_visible(GTK_WIDGET(each->data))) found = GTK_WIDGET(each->data);
    }
    g_list_free(windows);
    return found;
}

void collect(GtkWidget *widget, gpointer buttons) {
    if (GTK_IS_BUTTON(widget) && gtk_button_get_label(GTK_BUTTON(widget))) static_cast<std::vector<GtkWidget *> *>(buttons)->push_back(widget);
    if (GTK_IS_CONTAINER(widget)) gtk_container_forall(GTK_CONTAINER(widget), collect, buttons);
}

std::vector<GtkWidget *> buttonsOf(GtkWidget *dialog) {
    std::vector<GtkWidget *> buttons;
    gtk_container_forall(GTK_CONTAINER(dialog), collect, &buttons);
    return buttons;
}

Value labelOf(GtkWidget *widget) { return widget && GTK_IS_BUTTON(widget) ? Value(gtk_button_get_label(GTK_BUTTON(widget))) : Value(); }

}  // namespace

// What the dialog up shows, or null: its text and its secondary text, its buttons, the default and the one with the
// focus.
void questionUp(Call call) {
    crossbind::onMainThread([call] {
        GtkWidget *dialog = dialogUp();
        if (!dialog) {
            call.resolve();
            return;
        }
        gchar *text = nullptr;
        gchar *secondary = nullptr;
        g_object_get(dialog, "text", &text, "secondary-text", &secondary, nullptr);
        const Value::Array texts{Value(text ? text : ""), Value(secondary ? secondary : "")};
        g_free(text);
        g_free(secondary);
        Value::Array titles;
        for (GtkWidget *button : buttonsOf(dialog)) titles.push_back(labelOf(button));
        GtkWindow *window = GTK_WINDOW(dialog);
        call.resolve(Value::Object{{"texts", texts}, {"buttons", titles}, {"preferred", labelOf(gtk_window_get_default_widget(window))},
            {"focused", labelOf(gtk_window_get_focus(window))}});
    });
}

void pressInQuestion(Call call) {
    const std::string label = call.options()["button"].asString();
    crossbind::onMainThread([call, label] {
        GtkWidget *dialog = dialogUp();
        for (GtkWidget *button : dialog ? buttonsOf(dialog) : std::vector<GtkWidget *>{}) {
            if (label != gtk_button_get_label(GTK_BUTTON(button))) continue;
            gtk_button_clicked(GTK_BUTTON(button));
            call.resolve();
            return;
        }
        call.reject("crossbind e2e: no dialog up has a button " + label);
    });
}
