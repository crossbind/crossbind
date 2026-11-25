// Linux's own for the preview extension: the Secret Service keeps the app's token, through libsecret, and where no
// keyring runs the extension keeps it for the run alone; GLib makes HMAC-SHA256 and SHA-256; the default browser shows
// the page that approves a sign-in; and a project's question is a dialog of its window.
#include "preview.h"

#include <gtk/gtk.h>
#include <libsecret/secret.h>
#include <sys/random.h>

#include <fstream>
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

}  // namespace preview
