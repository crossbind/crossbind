// Linux's own for the preview extension: the Secret Service keeps the app's token, through libsecret, and where no
// keyring runs the extension keeps it for the run alone; GLib makes HMAC-SHA256 and SHA-256; the default browser shows
// the page that approves a sign-in; a project's question is a dialog of its window; and what shows that a preview is one
// is the window's title and a bar above the page, with the project's name and the preview's menu.
#include "preview.h"

#include <gtk/gtk.h>
#include <libsecret/secret.h>
#include <sys/random.h>
#include <webkit2/webkit2.h>

#include <fstream>
#include <map>
#include <memory>
#include <thread>

namespace preview {
namespace {

constexpr gsize DIGEST_BYTES = 32;

const SecretSchema SCHEMA = {
    "dev.crossbind.preview.Token",
    SECRET_SCHEMA_NONE,
    {{"service", SECRET_SCHEMA_ATTRIBUTE_STRING}, {"cloud", SECRET_SCHEMA_ATTRIBUTE_STRING}, {nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING}},
};

std::string wordsOf(GError *error) {
    const std::string words = error ? error->message : "the keyring answered nothing";
    if (error) g_error_free(error);
    return words;
}

constexpr int DONT_ALLOW_RESPONSE = 0;
constexpr int ALLOW_RESPONSE = 1;

// The question's dialog while it is up, and its answer's: on the main thread.
struct Asked {
    std::function<void(std::optional<bool>)> done;
    GtkWidget *dialog = nullptr;
};

// Escape and the window manager's close come as another response, which leaves it up.
void onQuestion(GtkDialog *dialog, gint response, gpointer data) {
    if (response != ALLOW_RESPONSE && response != DONT_ALLOW_RESPONSE) return;
    const std::shared_ptr<Asked> asked = *static_cast<std::shared_ptr<Asked> *>(data);
    gtk_widget_destroy(GTK_WIDGET(dialog));
    asked->done(response == ALLOW_RESPONSE);
}

void onQuestionGone(GtkWidget *, gpointer data) { (*static_cast<std::shared_ptr<Asked> *>(data))->dialog = nullptr; }

void forget(gpointer data, GClosure *) { delete static_cast<std::shared_ptr<Asked> *>(data); }

// What a window the indicator is up on had before it, which it gets back once it comes down, and the bar it shows; on
// the main thread.
struct Marked {
    std::string title;
    gboolean isWebFullScreen = TRUE;
    GtkWidget *bar = nullptr;
    GtkWidget *name = nullptr;
    GtkWidget *line = nullptr;
    GtkWidget *permissions = nullptr;
};
std::map<uint64_t, Marked> marked;
// The origin of the preview Permissions changes.
std::string menuOrigin;

void onReload(GtkMenuItem *, gpointer) { reloadPreview(); }

void onClose(GtkMenuItem *, gpointer) { closePreview(); }

// A kind's check mark turned: the answer kept, and the page reloaded so that it holds for it.
void onChanged(GtkCheckMenuItem *item, gpointer kind) {
    if (changeConsent(menuOrigin, *static_cast<std::string *>(kind), gtk_check_menu_item_get_active(item))) reloadPreview();
}

void forgetKind(gpointer kind, GClosure *) { delete static_cast<std::string *>(kind); }

// Permissions: the project's name, then a check mark for each kind its user answered, on where Allow is kept; or that
// nothing was asked yet. Made anew, each mark set before it is heard, as GTK's own setting of one activates it.
void fillPermissions(GtkWidget *menu, const Shown &shown) {
    GList *children = gtk_container_get_children(GTK_CONTAINER(menu));
    for (GList *each = children; each; each = each->next) gtk_widget_destroy(GTK_WIDGET(each->data));
    g_list_free(children);
    GtkWidget *name = gtk_menu_item_new_with_label(shown.project.c_str());
    gtk_widget_set_sensitive(name, FALSE);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), name);
    if (shown.answers.empty()) {
        GtkWidget *nothing = gtk_menu_item_new_with_label("Nothing asked yet.");
        gtk_widget_set_sensitive(nothing, FALSE);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), nothing);
    }
    for (const auto &[kind, isAllowed] : shown.answers) {
        GtkWidget *item = gtk_check_menu_item_new_with_label(controlWordOf(kind).c_str());
        gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(item), isAllowed);
        g_signal_connect_data(item, "toggled", G_CALLBACK(onChanged), new std::string(kind), forgetKind, GConnectFlags(0));
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
    }
    gtk_widget_show_all(menu);
}

// The project's name and a menu button: Reload, the project's name over its line, which does nothing, Permissions and
// Close preview. Each label is text, its underscores and its marks as they are.
Marked barOf(GtkWindow *window, WebKitWebView *web) {
    Marked made;
    const char *title = gtk_window_get_title(window);
    made.title = title ? title : "";
    made.isWebFullScreen = webkit_settings_get_enable_fullscreen(webkit_web_view_get_settings(web));
    made.bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_container_set_border_width(GTK_CONTAINER(made.bar), 4);
    made.name = gtk_label_new(nullptr);
    gtk_label_set_ellipsize(GTK_LABEL(made.name), PANGO_ELLIPSIZE_END);
    gtk_widget_set_halign(made.name, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(made.bar), made.name, TRUE, TRUE, 0);
    GtkWidget *menu = gtk_menu_new();
    GtkWidget *reload = gtk_menu_item_new_with_label("Reload");
    g_signal_connect(reload, "activate", G_CALLBACK(onReload), nullptr);
    made.line = gtk_menu_item_new_with_label("");
    gtk_widget_set_sensitive(made.line, FALSE);
    GtkWidget *permissions = gtk_menu_item_new_with_label("Permissions");
    made.permissions = gtk_menu_new();
    gtk_menu_item_set_submenu(GTK_MENU_ITEM(permissions), made.permissions);
    GtkWidget *close = gtk_menu_item_new_with_label("Close preview");
    g_signal_connect(close, "activate", G_CALLBACK(onClose), nullptr);
    for (GtkWidget *item : {reload, made.line, permissions, close}) gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
    gtk_widget_show_all(menu);
    GtkWidget *button = gtk_menu_button_new();
    gtk_button_set_label(GTK_BUTTON(button), "Preview");
    gtk_button_set_use_underline(GTK_BUTTON(button), FALSE);
    gtk_menu_button_set_popup(GTK_MENU_BUTTON(button), menu);
    gtk_box_pack_end(GTK_BOX(made.bar), button, FALSE, FALSE, 0);
    return made;
}

}  // namespace

void hmacSha256(const std::string &key, const std::string &text, Digest done) {
    GHmac *hmac = g_hmac_new(G_CHECKSUM_SHA256, reinterpret_cast<const guchar *>(key.data()), key.size());
    g_hmac_update(hmac, reinterpret_cast<const guchar *>(text.data()), static_cast<gssize>(text.size()));
    std::string digest(DIGEST_BYTES, '\0');
    gsize length = digest.size();
    g_hmac_get_digest(hmac, reinterpret_cast<guint8 *>(digest.data()), &length);
    g_hmac_unref(hmac);
    done(std::nullopt, digest);
}

void sha256(const std::string &text, Digest done) {
    GChecksum *checksum = g_checksum_new(G_CHECKSUM_SHA256);
    g_checksum_update(checksum, reinterpret_cast<const guchar *>(text.data()), static_cast<gssize>(text.size()));
    std::string digest(DIGEST_BYTES, '\0');
    gsize length = digest.size();
    g_checksum_get_digest(checksum, reinterpret_cast<guint8 *>(digest.data()), &length);
    g_checksum_free(checksum);
    done(std::nullopt, digest);
}

std::string randomBytes(std::size_t count) {
    std::string bytes(count, '\0');
    for (std::size_t filled = 0; filled < count;) {
        const ssize_t got = getrandom(bytes.data() + filled, count - filled, 0);
        if (got > 0) filled += static_cast<std::size_t>(got);
    }
    return bytes;
}

// libsecret's calls wait for the Secret Service, on a thread of their own.
void readSecret(const std::string &cloud, std::function<void(Failure failure, std::optional<std::string> secret)> done) {
    std::thread([cloud, done] {
        GError *error = nullptr;
        gchar *found = secret_password_lookup_sync(&SCHEMA, nullptr, &error, "service", config().service.c_str(), "cloud", cloud.c_str(), nullptr);
        if (error) {
            done(wordsOf(error), std::nullopt);
            return;
        }
        if (!found) {
            done(std::nullopt, std::nullopt);
            return;
        }
        const std::string secret(found);
        secret_password_free(found);
        done(std::nullopt, secret);
    }).detach();
}

void writeSecret(const std::string &cloud, const std::string &secret, Done done) {
    std::thread([cloud, secret, done] {
        GError *error = nullptr;
        const std::string label = crossbind::appName() + ": crossbind cloud";
        const gboolean isStored = secret_password_store_sync(&SCHEMA, SECRET_COLLECTION_DEFAULT, label.c_str(), secret.c_str(), nullptr, &error, "service",
            config().service.c_str(), "cloud", cloud.c_str(), nullptr);
        done(isStored ? Failure() : Failure(wordsOf(error)));
    }).detach();
}

void deleteSecret(const std::string &cloud, Done done) {
    std::thread([cloud, done] {
        GError *error = nullptr;
        secret_password_clear_sync(&SCHEMA, nullptr, &error, "service", config().service.c_str(), "cloud", cloud.c_str(), nullptr);
        done(error ? Failure(wordsOf(error)) : Failure());
    }).detach();
}

void openSignInPage(const std::string &url, Done done) {
    crossbind::invoke("shell.openExternal", Value::Object{{"url", url}}, [done](Failure failure, Value) { done(failure); });
}

std::string platformName() { return "linux"; }

// The distribution's version, as /etc/os-release's VERSION_ID names it, as "24.04"; 0 where it names none.
std::string systemVersion() {
    std::ifstream release("/etc/os-release");
    for (std::string line; std::getline(release, line);) {
        if (line.rfind("VERSION_ID=", 0) != 0) continue;
        std::string version;
        for (const char c : line.substr(11)) {
            if ((c >= '0' && c <= '9') || c == '.') version += c;
        }
        if (!version.empty() && version.front() != '.' && version.back() != '.') return version;
    }
    return "0";
}

bool asksForLocalNetwork() { return false; }

// A dialog of the window, modal to it, titled with the app's name: Don't Allow its default response, which Return takes,
// and its first focus; neither Escape nor the window manager's close answers it. It shows without a loop of its own, so
// the pages' calls go on meanwhile.
std::function<void()> showConsent(uint64_t window, const std::string &message, const std::string &detail,
    std::function<void(std::optional<bool> isAllowed)> done) {
    const std::optional<crossbind::Window> open = crossbind::windowOf(window);
    GtkWindow *parent = static_cast<GtkWindow *>(open ? open->native() : crossbind::appWindow());
    if (!parent) {
        done(std::nullopt);
        return nullptr;
    }
    GtkWidget *dialog = gtk_message_dialog_new(parent, static_cast<GtkDialogFlags>(GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT), GTK_MESSAGE_QUESTION,
        GTK_BUTTONS_NONE, "%s", message.c_str());
    gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog), "%s", detail.c_str());
    gtk_window_set_title(GTK_WINDOW(dialog), crossbind::appName().c_str());
    gtk_window_set_deletable(GTK_WINDOW(dialog), FALSE);
    // In GNOME's order, the default on the right; a label's underscores stay as they are.
    GtkWidget *allow = gtk_dialog_add_button(GTK_DIALOG(dialog), "Allow", ALLOW_RESPONSE);
    GtkWidget *dontAllow = gtk_dialog_add_button(GTK_DIALOG(dialog), "Don't Allow", DONT_ALLOW_RESPONSE);
    gtk_button_set_use_underline(GTK_BUTTON(allow), FALSE);
    gtk_button_set_use_underline(GTK_BUTTON(dontAllow), FALSE);
    gtk_dialog_set_default_response(GTK_DIALOG(dialog), DONT_ALLOW_RESPONSE);
    const auto asked = std::make_shared<Asked>(Asked{std::move(done), dialog});
    g_signal_connect(dialog, "delete-event", G_CALLBACK(gtk_true), nullptr);
    g_signal_connect_data(dialog, "response", G_CALLBACK(onQuestion), new std::shared_ptr<Asked>(asked), forget, GConnectFlags(0));
    g_signal_connect_data(dialog, "destroy", G_CALLBACK(onQuestionGone), new std::shared_ptr<Asked>(asked), forget, GConnectFlags(0));
    gtk_widget_show_all(dialog);
    gtk_widget_grab_focus(dontAllow);
    return [asked] {
        crossbind::onMainThread([asked] {
            if (asked->dialog) gtk_widget_destroy(asked->dialog);
        });
    };
}

// The window's title says it shows a preview, and the bar is above the page, in the window's own box; the web view's
// full screen is off, as a window that filled the screen would show no title.
void showIndicator(uint64_t window, const Shown &shown, std::function<void()> done) {
    crossbind::onMainThread([window, shown, done] {
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        if (open) {
            GtkWindow *native = static_cast<GtkWindow *>(open->native());
            WebKitWebView *web = WEBKIT_WEB_VIEW(open->webView());
            if (!marked.count(window)) {
                marked[window] = barOf(native, web);
                gtk_container_add(GTK_CONTAINER(gtk_widget_get_parent(GTK_WIDGET(web))), marked[window].bar);
                gtk_widget_show_all(marked[window].bar);
            }
            // Off before the project's page loads, so that its document has no full screen to ask for.
            webkit_settings_set_enable_fullscreen(webkit_web_view_get_settings(web), FALSE);
            const Marked &state = marked[window];
            gtk_label_set_text(GTK_LABEL(state.name), shown.project.c_str());
            gtk_label_set_text(GTK_LABEL(gtk_bin_get_child(GTK_BIN(state.line))), (shown.project + "\n" + shown.line).c_str());
            menuOrigin = shown.origin;
            fillPermissions(state.permissions, shown);
            gtk_window_set_title(native, (shown.project + " \xE2\x80\x93 crossbind preview").c_str());
        }
        done();
    });
}

void hideIndicator(uint64_t window) {
    crossbind::onMainThread([window] {
        const auto found = marked.find(window);
        if (found == marked.end()) return;
        if (const std::optional<crossbind::Window> open = crossbind::windowOf(window)) {
            gtk_window_set_title(static_cast<GtkWindow *>(open->native()), found->second.title.c_str());
            gtk_widget_destroy(found->second.bar);
        }
        marked.erase(found);
    });
}

// The web view's own full screen comes back as the preview ends: the app's page that comes next is made with it.
void endIndicator(uint64_t window, std::function<void(bool isShowingProject)> done) {
    crossbind::onMainThread([window, done] {
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        const auto found = marked.find(window);
        if (open && found != marked.end()) {
            webkit_settings_set_enable_fullscreen(webkit_web_view_get_settings(WEBKIT_WEB_VIEW(open->webView())), found->second.isWebFullScreen);
        }
        done(open && open->page().role() == "project");
    });
}

void reloadWindow(uint64_t window) {
    crossbind::onMainThread([window] {
        if (const std::optional<crossbind::Window> open = crossbind::windowOf(window)) webkit_web_view_reload(WEBKIT_WEB_VIEW(open->webView()));
    });
}

}  // namespace preview
