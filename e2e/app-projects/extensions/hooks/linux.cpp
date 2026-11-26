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

// The preview's indicator as its user sees it on Linux: the app window's title, and the bar above its page, with the
// project's name and the preview's menu, its items with their words; an item of the menu pressed as its user's click
// activates it.
namespace {

// The bar the preview adds to the window's box, above the page: a box of a label and a menu button.
GtkWidget *menuButtonOf(GtkWidget *box, GtkWidget **name) {
    GtkWidget *found = nullptr;
    GList *children = gtk_container_get_children(GTK_CONTAINER(box));
    for (GList *each = children; each && !found; each = each->next) {
        if (!GTK_IS_BOX(each->data)) continue;
        GList *inner = gtk_container_get_children(GTK_CONTAINER(each->data));
        for (GList *part = inner; part; part = part->next) {
            if (GTK_IS_MENU_BUTTON(part->data)) found = GTK_WIDGET(part->data);
            else if (GTK_IS_LABEL(part->data) && name) *name = GTK_WIDGET(part->data);
        }
        g_list_free(inner);
    }
    g_list_free(children);
    return found;
}

GtkWidget *previewButton(GtkWidget **name = nullptr) {
    void *web = crossbind::appWebView();
    return web ? menuButtonOf(gtk_widget_get_parent(GTK_WIDGET(web)), name) : nullptr;
}

std::vector<GtkWidget *> itemsOf(GtkWidget *button) {
    std::vector<GtkWidget *> items;
    GtkMenu *menu = button ? gtk_menu_button_get_popup(GTK_MENU_BUTTON(button)) : nullptr;
    if (!menu) return items;
    GList *children = gtk_container_get_children(GTK_CONTAINER(menu));
    for (GList *each = children; each; each = each->next) items.push_back(GTK_WIDGET(each->data));
    g_list_free(children);
    return items;
}

}  // namespace

Value indicatorState() {
    GtkWidget *name = nullptr;
    GtkWidget *button = previewButton(&name);
    const gchar *title = crossbind::appWindow() ? gtk_window_get_title(GTK_WINDOW(crossbind::appWindow())) : nullptr;
    Value::Array items;
    for (GtkWidget *item : itemsOf(button)) {
        const gchar *words = gtk_menu_item_get_label(GTK_MENU_ITEM(item));
        items.emplace_back(Value::Object{{"words", Value(words ? words : "")}, {"enabled", static_cast<bool>(gtk_widget_get_sensitive(item))}});
    }
    // A dialog of the window's own holds its input while it is up.
    return Value::Object{{"up", button != nullptr}, {"title", Value(title ? title : "")}, {"name", name ? Value(gtk_label_get_text(GTK_LABEL(name))) : Value()},
        {"button", button ? Value(gtk_button_get_label(GTK_BUTTON(button))) : Value()}, {"items", button ? Value(items) : Value()},
        {"takesInput", gtk_grab_get_current() == nullptr}};
}

void indicatorUp(Call call) {
    crossbind::onMainThread([call] { call.resolve(indicatorState()); });
}

void pressIndicator(Call call) {
    const std::string words = call.options()["item"].asString();
    crossbind::onMainThread([call, words] {
        for (GtkWidget *item : itemsOf(previewButton())) {
            const gchar *label = gtk_menu_item_get_label(GTK_MENU_ITEM(item));
            if (!label || words != label || !gtk_widget_get_sensitive(item)) continue;
            gtk_menu_item_activate(GTK_MENU_ITEM(item));
            call.resolve();
            return;
        }
        call.reject("crossbind e2e: the preview's bar has no item " + words + " to press");
    });
}
