// The dialog up over the app's window, as its user reads it, and its buttons as its user clicks them: the run's way to
// the preview extension's question on Linux.
#include "crossbind/extension.h"

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

#include <memory>
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
// project's name and the preview's menu, its items with their words, and whether the web view may fill the screen; an
// item of the menu pressed as its user's click activates it.
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

std::vector<GtkWidget *> itemsOf(GtkWidget *menu) {
    std::vector<GtkWidget *> items;
    if (!menu) return items;
    GList *children = gtk_container_get_children(GTK_CONTAINER(menu));
    for (GList *each = children; each; each = each->next) items.push_back(GTK_WIDGET(each->data));
    g_list_free(children);
    return items;
}

GtkWidget *popupOf(GtkWidget *button) { return button ? GTK_WIDGET(gtk_menu_button_get_popup(GTK_MENU_BUTTON(button))) : nullptr; }

// A menu's items with their words, whether each takes a click and bears a check mark, and a submenu's own items.
Value::Array valuesOf(GtkWidget *menu) {
    Value::Array values;
    for (GtkWidget *item : itemsOf(menu)) {
        const gchar *words = gtk_menu_item_get_label(GTK_MENU_ITEM(item));
        const bool isChecked = GTK_IS_CHECK_MENU_ITEM(item) && gtk_check_menu_item_get_active(GTK_CHECK_MENU_ITEM(item));
        Value::Object each{{"words", Value(words ? words : "")}, {"enabled", static_cast<bool>(gtk_widget_get_sensitive(item))}, {"checked", isChecked}};
        if (GtkWidget *submenu = gtk_menu_item_get_submenu(GTK_MENU_ITEM(item))) each.emplace_back("items", valuesOf(submenu));
        values.emplace_back(std::move(each));
    }
    return values;
}

// The enabled item of these words, in the menu or in a submenu of it, that does something.
GtkWidget *itemOf(GtkWidget *menu, const std::string &words) {
    for (GtkWidget *item : itemsOf(menu)) {
        GtkWidget *submenu = gtk_menu_item_get_submenu(GTK_MENU_ITEM(item));
        const gchar *label = gtk_menu_item_get_label(GTK_MENU_ITEM(item));
        if (!submenu && label && words == label && gtk_widget_get_sensitive(item)) return item;
        if (GtkWidget *inner = submenu ? itemOf(submenu, words) : nullptr) return inner;
    }
    return nullptr;
}

}  // namespace

Value indicatorState() {
    GtkWidget *name = nullptr;
    GtkWidget *button = previewButton(&name);
    const gchar *title = crossbind::appWindow() ? gtk_window_get_title(GTK_WINDOW(crossbind::appWindow())) : nullptr;
    const Value::Array items = valuesOf(popupOf(button));
    // A dialog of the window's own holds its input while it is up, by a grab in the window's group, which the host gives
    // each window of its own.
    GtkWindow *window = crossbind::appWindow() ? GTK_WINDOW(crossbind::appWindow()) : nullptr;
    const bool isHeld = window && gtk_window_group_get_current_grab(gtk_window_get_group(window)) != nullptr;
    void *web = crossbind::appWebView();
    const bool isWebFullScreen = web && webkit_settings_get_enable_fullscreen(webkit_web_view_get_settings(WEBKIT_WEB_VIEW(web)));
    return Value::Object{{"up", button != nullptr}, {"title", Value(title ? title : "")}, {"name", name ? Value(gtk_label_get_text(GTK_LABEL(name))) : Value()},
        {"button", button ? Value(gtk_button_get_label(GTK_BUTTON(button))) : Value()}, {"items", button ? Value(items) : Value()},
        {"takesInput", window != nullptr && !isHeld}, {"webTakesFullScreen", isWebFullScreen}};
}

void indicatorUp(Call call) {
    crossbind::onMainThread([call] { call.resolve(indicatorState()); });
}

bool pressItem(const std::string &words) {
    GtkWidget *item = itemOf(popupOf(previewButton()), words);
    if (!item) return false;
    gtk_menu_item_activate(GTK_MENU_ITEM(item));
    return true;
}

// An item of the bar's menu activated now, or once ms passed, the call answered first, as when the press will reload
// or end the page that asked.
void pressIndicator(Call call) {
    const std::string words = call.options()["item"].asString();
    const double ms = call.options()["ms"].asNumber(0);
    crossbind::onMainThread([call, words, ms] {
        if (ms > 0) {
            call.resolve();
            g_timeout_add(static_cast<guint>(ms), [](gpointer data) -> gboolean {
                const std::unique_ptr<std::string> later(static_cast<std::string *>(data));
                pressItem(*later);
                return G_SOURCE_REMOVE;
            }, new std::string(words));
            return;
        }
        if (pressItem(words)) call.resolve();
        else call.reject("crossbind e2e: the preview's bar has no item " + words + " to press");
    });
}
