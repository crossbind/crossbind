// The crossbind app's previews of its account's projects: the extension's entry, the account signed in and its token as
// the system's store keeps them, the list the page read last, the snapshots' versions as they were opened, the note of
// the projects opened, and the links that name a session.
#include "preview.h"

#include "crossbind/app.h"

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <tuple>

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
std::mutex projectsMutex;
const std::string PROJECTS = "projects.json";
// The accounts deleted whose note could not be written, out of it for the run.
std::set<std::string> deletedAccounts;

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

void writeVersions(Value::Object versions) { writeDataFile(VERSIONS, Value(std::move(versions)).json()); }

// An entry of the note, or none for one of another shape: the project's name as the list shows one, and its snapshots'
// ids.
std::optional<Noted> notedOf(const std::string &origin, const Value &entry) {
    if (!isOriginName(origin) || !entry.isObject() || !entry["snapshots"].isArray()) return std::nullopt;
    Noted noted{origin, textOf(entry["name"]), textOf(entry["account"]), {}, textOf(entry["accountId"])};
    if (!isListedName(noted.project) || noted.account.empty() != noted.accountId.empty()) return std::nullopt;
    if (deletedAccounts.count(noted.accountId) > 0) noted.account = noted.accountId = "";
    for (const Value &id : entry["snapshots"].asArray()) {
        if (!isSessionId(textOf(id))) return std::nullopt;
        noted.snapshots.push_back(textOf(id));
    }
    return noted;
}

// The note, under its lock: each entry of its shape, the first of a name standing.
std::vector<Noted> readNote() {
    const std::optional<std::string> text = readDataFile(PROJECTS);
    std::vector<Noted> note;
    try {
        const Value kept = text ? parseJson(*text) : Value();
        if (!kept.isObject()) return note;
        for (const auto &[origin, entry] : kept.asObject()) {
            const bool isSeen = std::any_of(note.begin(), note.end(), [&origin](const Noted &each) { return each.origin == origin; });
            const std::optional<Noted> noted = isSeen ? std::nullopt : notedOf(origin, entry);
            if (noted) note.push_back(*noted);
        }
    } catch (const std::exception &) {
        // A note that is no JSON lists nothing.
    }
    return note;
}

std::string noteText(const std::vector<Noted> &note) {
    Value::Object entries;
    for (const Noted &each : note) {
        entries.emplace_back(each.origin, Value::Object{{"name", each.project}, {"account", each.account}, {"accountId", each.accountId}, {"snapshots", Value(each.snapshots)}});
    }
    return Value(std::move(entries)).json();
}

void writeNote(const std::vector<Noted> &note) {
    if (const Failure failure = writeDataFile(PROJECTS, noteText(note))) {
        std::fprintf(stderr, "crossbind: preview could not note a project in its %s: %s\n", PROJECTS.c_str(), failure->c_str());
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
    writeVersions(std::move(versions));
}

void forgetVersions(const std::vector<std::string> &ids) {
    std::lock_guard<std::mutex> lock(versionsMutex);
    const Value read = readVersions();
    Value::Object versions;
    for (const auto &[session, opened] : read.asObject()) {
        if (std::find(ids.begin(), ids.end(), session) == ids.end()) versions.emplace_back(session, opened);
    }
    if (versions.size() != read.asObject().size()) writeVersions(std::move(versions));
}

std::vector<Noted> notedProjects() {
    std::vector<Noted> note;
    {
        std::lock_guard<std::mutex> lock(projectsMutex);
        note = readNote();
    }
    std::sort(note.begin(), note.end(), [](const Noted &a, const Noted &b) { return std::tie(a.project, a.account, a.origin) < std::tie(b.project, b.account, b.origin); });
    return note;
}

std::optional<Noted> notedProject(const std::string &origin) {
    std::lock_guard<std::mutex> lock(projectsMutex);
    for (Noted &each : readNote()) {
        if (each.origin == origin) return each;
    }
    return std::nullopt;
}

void noteProject(const std::string &origin, const std::string &project, const Account &account, const std::string &snapshot) {
    std::lock_guard<std::mutex> lock(projectsMutex);
    std::vector<Noted> note = readNote();
    std::vector<std::string> snapshots;
    for (const Noted &each : note) {
        if (each.origin == origin) snapshots = each.snapshots;
    }
    std::erase_if(note, [&origin](const Noted &each) { return each.origin == origin; });
    if (!snapshot.empty() && std::find(snapshots.begin(), snapshots.end(), snapshot) == snapshots.end()) snapshots.push_back(snapshot);
    note.push_back({origin, project, account.name, std::move(snapshots), account.id});
    writeNote(note);
}

void forgetAccount(const std::string &id) {
    std::lock_guard<std::mutex> lock(projectsMutex);
    std::vector<Noted> note = readNote();
    bool isNoted = false;
    for (Noted &each : note) {
        if (each.accountId != id) continue;
        each.account = each.accountId = "";
        isNoted = true;
    }
    if (!isNoted) return;
    if (const Failure failure = writeDataFile(PROJECTS, noteText(note))) {
        deletedAccounts.insert(id);
        std::fprintf(stderr, "crossbind: preview could not take a deleted account out of its %s, which holds for this run: %s\n", PROJECTS.c_str(), failure->c_str());
    }
}

void forgetProject(const std::string &origin) {
    std::lock_guard<std::mutex> lock(projectsMutex);
    std::vector<Noted> note = readNote();
    if (std::erase_if(note, [&origin](const Noted &each) { return each.origin == origin; }) > 0) writeNote(note);
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
    preview::addIndicatorHooks(registry);
    preview::addClearingFunctions(registry);
    // A link of the app's scheme, or on a phone of crossbind.dev/open, names a session alone, which the app's page opens
    // from the account's list: the preview open ends, so that the page shows again and asks for the link as it loads.
    registry.onOpenUrl([](const crossbind::OpenUrl &open) {
        const std::string session = preview::linkedSession(open.url).value_or("");
        preview::endPreview();
        if (session.empty()) preview::holdEvent("link", crossbind::Value::Object{{"message", "This link opens no preview."}});
        else preview::holdEvent("link", crossbind::Value::Object{{"session", session}});
    });
}
