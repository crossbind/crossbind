// The crossbind app's previews of its account's projects: the extension's entry, the account signed in and its token as
// the system's store keeps them, the list the page read last, the snapshots' versions as they were opened, and the
// links that name a session.
#include "preview.h"

#include "crossbind/app.h"

#include <filesystem>
#include <fstream>
#include <mutex>
#include <sstream>
#include <stdexcept>

namespace preview {
namespace {

namespace fs = std::filesystem;
using crossbind::Call;

Config cloud;
std::optional<crossbind::Events> events;

std::mutex stateMutex;
bool isRead = false;
bool isReading = false;
std::vector<std::function<void()>> afterRead;
std::optional<Account> signedIn;
std::string token;
bool keyring = true;
std::vector<Session> list;

std::mutex versionsMutex;
const std::string VERSIONS = "versions.json";

fs::path pathOf(const std::string &text) { return fs::path(std::u8string(text.begin(), text.end())); }

fs::path dataFileOf(const std::string &name) { return pathOf(crossbind::app::paths().data) / "preview" / pathOf(name); }

Value readVersions() {
    const std::optional<std::string> text = readDataFile(VERSIONS);
    try {
        Value versions = text ? parseJson(*text) : Value();
        return versions.isObject() ? versions : Value(Value::Object{});
    } catch (const std::exception &) {
        return Value::Object{};
    }
}

// What the store keeps: the token and the account it signs in to, so that a start needs no network to know it.
std::string secretOf(const Account &account, const std::string &kept) {
    return Value(Value::Object{{"token", kept}, {"account", Value::Object{{"id", account.id}, {"name", account.name}}}}).json();
}

void readStore() {
    readSecret(cloud.api, [](Failure failure, std::optional<std::string> secret) {
        std::optional<Account> account;
        std::string found;
        try {
            if (secret) {
                const Value kept = parseJson(*secret);
                found = textOf(kept["token"]);
                account = Account{textOf(kept["account"]["id"]), textOf(kept["account"]["name"])};
            }
        } catch (const std::exception &) {
            // What the store holds that is no sign-in is none.
        }
        if (found.empty() || !account || account->id.empty() || account->name.empty()) {
            account.reset();
            found.clear();
        }
        std::vector<std::function<void()>> waiting;
        {
            std::lock_guard<std::mutex> lock(stateMutex);
            signedIn = account;
            token = found;
            keyring = !failure;
            isRead = true;
            waiting.swap(afterRead);
        }
        for (const auto &fn : waiting) fn();
    });
}

void accountFunction(Call call) {
    withAccount([call](std::optional<Account> account, std::string) {
        const Value shown = account ? Value(Value::Object{{"id", account->id}, {"name", account->name}}) : Value();
        call.resolve(Value::Object{{"account", shown}, {"cloud", config().api}, {"keyring", hasKeyring()}});
    });
}

}  // namespace

const Config &config() { return cloud; }

void holdEvent(const std::string &name, const Value &value) { events->hold(name, value); }

void withAccount(std::function<void(std::optional<Account> account, std::string token)> fn) {
    std::optional<Account> account;
    std::string kept;
    bool isReady = false;
    bool shouldRead = false;
    {
        std::lock_guard<std::mutex> lock(stateMutex);
        if (isRead) {
            isReady = true;
            account = signedIn;
            kept = token;
        } else {
            afterRead.push_back([fn] { withAccount(fn); });
            shouldRead = !isReading;
            isReading = true;
        }
    }
    if (isReady) fn(account, kept);
    else if (shouldRead) readStore();
}

void keepSignIn(Account account, std::string kept, std::function<void(bool isKept)> done) {
    const std::string secret = secretOf(account, kept);
    {
        std::lock_guard<std::mutex> lock(stateMutex);
        signedIn = std::move(account);
        token = std::move(kept);
    }
    writeSecret(cloud.api, secret, [done](Failure failure) {
        {
            std::lock_guard<std::mutex> lock(stateMutex);
            keyring = !failure;
        }
        done(!failure);
    });
}

void forgetSignIn(std::function<void()> done) {
    {
        std::lock_guard<std::mutex> lock(stateMutex);
        signedIn.reset();
        token.clear();
        list.clear();
    }
    forgetOpener();
    deleteSecret(cloud.api, [done](Failure) { done(); });
}

bool hasKeyring() {
    std::lock_guard<std::mutex> lock(stateMutex);
    return keyring;
}

void keepList(std::vector<Session> sessions) {
    std::lock_guard<std::mutex> lock(stateMutex);
    list = std::move(sessions);
}

std::optional<Session> listed(const std::string &id) {
    std::lock_guard<std::mutex> lock(stateMutex);
    for (const Session &session : list) {
        if (session.id == id) return session;
    }
    return std::nullopt;
}

void dropListed(const std::string &id) {
    std::lock_guard<std::mutex> lock(stateMutex);
    std::erase_if(list, [&id](const Session &session) { return session.id == id; });
}

std::optional<int> openedVersion(const std::string &id) {
    std::lock_guard<std::mutex> lock(versionsMutex);
    return integerOf(readVersions()[id]);
}

void noteOpened(const std::string &id, int version) {
    std::lock_guard<std::mutex> lock(versionsMutex);
    // Held by name: the object a temporary's asObject() gives goes with the temporary, before the loop reads it.
    const Value read = readVersions();
    Value::Object versions;
    for (const auto &[session, opened] : read.asObject()) {
        if (session != id) versions.emplace_back(session, opened);
    }
    versions.emplace_back(id, version);
    writeDataFile(VERSIONS, Value(std::move(versions)).json());
}

std::optional<std::string> readDataFile(const std::string &name) {
    std::ifstream in(dataFileOf(name), std::ios::binary);
    if (!in) return std::nullopt;
    std::stringstream text;
    text << in.rdbuf();
    return text.str();
}

Failure writeDataFile(const std::string &name, const std::string &text) {
    const fs::path file = dataFileOf(name);
    std::error_code error;
    fs::create_directories(file.parent_path(), error);
    if (error) return error.message();
    const fs::path written = fs::path(file).concat(".new");
    {
        std::ofstream out(written, std::ios::binary | std::ios::trunc);
        out << text;
        out.close();
        if (!out) return std::string("the file could not be written");
    }
    fs::rename(written, file, error);
    if (!error) return std::nullopt;
    std::error_code ignored;
    fs::remove(written, ignored);
    return error.message();
}

}  // namespace preview

void crossbind_extension_preview(crossbind::Registry &registry) {
    const crossbind::Value options = registry.options();
    preview::cloud = {preview::textOf(options["api"]), preview::textOf(options["snapshots"]), preview::textOf(options["version"]),
        crossbind::appId() + ".cloud", preview::platformName(), preview::systemVersion()};
    if (preview::cloud.api.empty() || preview::cloud.snapshots.empty()) throw std::runtime_error("crossbind: preview's options name no cloud: its fromApp gives them.");
    preview::events = registry.events();
    registry.function("preview.account", preview::accountFunction);
    preview::addCloudFunctions(registry);
    preview::addOpenerFunctions(registry);
    preview::addPageRequests(registry);
    // A link of the app's scheme, or on a phone of crossbind.dev/open, names a session alone, which the app's page opens
    // from the account's list: the preview open ends, so that the page shows again and asks for the link as it loads.
    registry.onOpenUrl([](const crossbind::OpenUrl &open) {
        const std::string session = preview::linkedSession(open.url).value_or("");
        preview::endPreview();
        if (session.empty()) preview::holdEvent("link", crossbind::Value::Object{{"message", "This link opens no preview."}});
        else preview::holdEvent("link", crossbind::Value::Object{{"session", session}});
    });
}
