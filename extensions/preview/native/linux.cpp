// Linux's own for the preview extension: the Secret Service keeps the app's token, through libsecret, and where no
// keyring runs the extension keeps it for the run alone; GLib makes HMAC-SHA256 and SHA-256; the default browser shows
// the page that approves a sign-in.
#include "preview.h"

#include <libsecret/secret.h>
#include <sys/random.h>

#include <fstream>
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

}  // namespace preview
