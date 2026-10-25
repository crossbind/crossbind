// A desktop app's updates. The manifest at app.updater.url names the newest version, its file beside the manifest and
// the signature the key of app.updater.publicKey checks, as `crossbind app build` writes them with the key in
// CROSSBIND_UPDATER_PRIVATE_KEY. The file downloads into the app's cache folder and, once its signature holds, takes
// the app's place: a macOS or Linux app is swapped for the one the file unpacks, and a Windows app's setup program
// installs it once the app has quit. The app then opens anew.
#include "host_core.h"
// app.updater, which crossbind writes into a desktop app's header.
#include "crossbind_app.h"

#include <stdexcept>
#include <string>

#ifdef CROSSBIND_APP_UPDATER_URL
#include "monocypher-ed25519.h"

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <map>
#include <mutex>
#include <vector>

#ifndef _WIN32
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
#endif
#endif

namespace crossbind::app {

#ifdef CROSSBIND_APP_UPDATER_URL

namespace {

namespace fs = std::filesystem;

// What the build signed the update for.
#if defined(__APPLE__)
constexpr const char *PLATFORM = "darwin";
#elif defined(_WIN32)
constexpr const char *PLATFORM = "win32";
#else
constexpr const char *PLATFORM = "linux";
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
constexpr const char *ARCH = "arm64";
#else
constexpr const char *ARCH = "x64";
#endif
constexpr uint8_t PUBLIC_KEY[32] = CROSSBIND_APP_UPDATER_KEY;
constexpr size_t SIGNATURE_SIZE = 64;
constexpr size_t SIGNATURE_TEXT_SIZE = (SIGNATURE_SIZE + 2) / 3 * 4;
// A manifest is three short fields; a server that sends more, or an update past what any app weighs, fills the disk.
constexpr std::uintmax_t MAX_MANIFEST_SIZE = 64 * 1024;
constexpr std::uintmax_t MAX_UPDATE_SIZE = std::uintmax_t{2} << 30;
constexpr size_t READ_CHUNK = 64 * 1024;

// A check and an install download into the same folder, so one runs at a time and another fails meanwhile.
std::mutex updating;

struct Manifest {
    std::string version;
    std::string file;
    std::string signature;
};

// A version as semver orders it: its three numbers, then its prerelease's identifiers. Build metadata does not count.
struct Version {
    std::vector<std::string> numbers;
    std::vector<std::string> prerelease;
};

struct NoManifest {};

// ASCII alone, whatever locale GTK sets.
bool isDigit(char c) { return c >= '0' && c <= '9'; }
bool isWordChar(char c) { return isDigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-'; }
bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }
bool isNumber(const std::string &part) { return !part.empty() && std::all_of(part.begin(), part.end(), isDigit); }
bool isIdentifier(const std::string &part) { return !part.empty() && std::all_of(part.begin(), part.end(), isWordChar); }

// The file a manifest names beside it: characters an address carries as they are, and no leading dot.
bool isFileName(const std::string &name) {
    return !name.empty() && name[0] != '.' &&
           std::all_of(name.begin(), name.end(), [](char c) { return isWordChar(c) || c == '.' || c == '_' || c == '~'; });
}

std::vector<std::string> split(const std::string &text, char separator) {
    std::vector<std::string> parts;
    size_t start = 0;
    for (size_t end = text.find(separator); end != std::string::npos; end = text.find(separator, start)) {
        parts.push_back(text.substr(start, end - start));
        start = end + 1;
    }
    parts.push_back(text.substr(start));
    return parts;
}

std::optional<Version> versionOf(const std::string &text) {
    const size_t plus = text.find('+');
    const std::string release = text.substr(0, plus);
    const size_t dash = release.find('-');
    const std::vector<std::string> numbers = split(release.substr(0, dash), '.');
    const std::vector<std::string> prerelease = dash == std::string::npos ? std::vector<std::string>() : split(release.substr(dash + 1), '.');
    const std::vector<std::string> build = plus == std::string::npos ? std::vector<std::string>() : split(text.substr(plus + 1), '.');
    const bool isValid = numbers.size() == 3 && std::all_of(numbers.begin(), numbers.end(), isNumber) &&
                         std::all_of(prerelease.begin(), prerelease.end(), isIdentifier) &&
                         std::all_of(build.begin(), build.end(), isIdentifier);
    return isValid ? std::optional<Version>(Version{numbers, prerelease}) : std::nullopt;
}

// Below, at or above zero as a sorts before, with or after b: numbers by their value and before words, words in ASCII
// order.
int compare(const std::string &a, const std::string &b) {
    if (isNumber(a) != isNumber(b)) return isNumber(a) ? -1 : 1;
    if (!isNumber(a)) return a.compare(b);
    const std::string x = a.substr(std::min(a.find_first_not_of('0'), a.size()));
    const std::string y = b.substr(std::min(b.find_first_not_of('0'), b.size()));
    if (x.size() != y.size()) return x.size() < y.size() ? -1 : 1;
    return x.compare(y);
}

bool isNewer(const Version &a, const Version &b) {
    for (size_t i = 0; i < a.numbers.size(); i += 1) {
        if (const int order = compare(a.numbers[i], b.numbers[i])) return order > 0;
    }
    // A release comes after its prereleases.
    if (a.prerelease.empty() || b.prerelease.empty()) return a.prerelease.empty() && !b.prerelease.empty();
    for (size_t i = 0; i < std::min(a.prerelease.size(), b.prerelease.size()); i += 1) {
        if (const int order = compare(a.prerelease[i], b.prerelease[i])) return order > 0;
    }
    return a.prerelease.size() > b.prerelease.size();
}

// The string fields of the JSON object a manifest is, which holds no other value and no escape.
std::map<std::string, std::string> fieldsOf(const std::string &text) {
    size_t at = 0;
    const auto skipSpace = [&] {
        while (at < text.size() && isSpace(text[at])) at += 1;
    };
    const auto skip = [&](char c) {
        skipSpace();
        if (at == text.size() || text[at] != c) return false;
        at += 1;
        return true;
    };
    const auto expect = [&](char c) {
        if (!skip(c)) throw NoManifest();
    };
    const auto string = [&] {
        expect('"');
        const size_t end = text.find('"', at);
        if (end == std::string::npos || text.find('\\', at) < end) throw NoManifest();
        std::string value = text.substr(at, end - at);
        at = end + 1;
        return value;
    };
    std::map<std::string, std::string> fields;
    expect('{');
    do {
        std::string key = string();
        expect(':');
        fields[std::move(key)] = string();
    } while (skip(','));
    expect('}');
    skipSpace();
    if (at != text.size()) throw NoManifest();
    return fields;
}

std::string replaced(std::string text, const std::string &from, const std::string &to) {
    for (size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size())) text.replace(at, from.size(), to);
    return text;
}

// app.updater.url for this app's platform and architecture.
std::string manifestUrl() { return replaced(replaced(CROSSBIND_APP_UPDATER_URL, "{platform}", PLATFORM), "{arch}", ARCH); }

// The update's file is beside its manifest.
std::string fileUrl(const std::string &manifest, const std::string &file) {
    const std::string address = manifest.substr(0, manifest.find_first_of("?#"));
    return address.substr(0, address.rfind('/') + 1) + file;
}

std::string textOf(const fs::path &path) {
    const std::u8string text = path.u8string();
    return std::string(text.begin(), text.end());
}

std::unique_lock<std::mutex> lockUpdates() {
    std::unique_lock<std::mutex> lock(updating, std::try_to_lock);
    if (!lock.owns_lock()) throw std::runtime_error("crossbind: the app is checking for or installing an update already");
    return lock;
}

// Emptied each time, so that no download outlives the next check; a setup program that still runs keeps its file.
fs::path updateFolder() {
    const fs::path folder = pathOf(appPaths().cache) / "update";
    std::error_code ignored;
    fs::remove_all(folder, ignored);
    fs::create_directories(folder);
    return folder;
}

Manifest fetchManifest(const fs::path &folder) {
    const std::string url = manifestUrl();
    const fs::path file = folder / "manifest.json";
    download(url, file, MAX_MANIFEST_SIZE);
    try {
        std::ifstream in(file, std::ios::binary);
        std::map<std::string, std::string> fields = fieldsOf(std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()));
        const Manifest manifest{fields["version"], fields["file"], fields["signature"]};
        if (!versionOf(manifest.version) || !isFileName(manifest.file) || manifest.signature.size() != SIGNATURE_TEXT_SIZE) throw NoManifest();
        return manifest;
    } catch (const NoManifest &) {
        throw std::runtime_error("crossbind: " + url + " is no update manifest, as `crossbind app build` writes beside an app's update");
    }
}

// The update the manifest offers when its version is newer than this app's.
std::optional<Manifest> newerUpdate(const fs::path &folder) {
    const Manifest manifest = fetchManifest(folder);
    if (!isNewer(versionOf(manifest.version).value(), versionOf(CROSSBIND_APP_UPDATER_VERSION).value())) return std::nullopt;
    return manifest;
}

std::string sha512Of(const fs::path &file) {
    std::ifstream in(file, std::ios::binary);
    crypto_sha512_ctx context;
    crypto_sha512_init(&context);
    std::vector<char> chunk(READ_CHUNK);
    while (in.read(chunk.data(), static_cast<std::streamsize>(chunk.size())) || in.gcount() > 0) {
        crypto_sha512_update(&context, reinterpret_cast<const uint8_t *>(chunk.data()), static_cast<size_t>(in.gcount()));
    }
    if (!in.eof()) throw std::runtime_error("crossbind: cannot read the update " + textOf(file));
    uint8_t hash[64];
    crypto_sha512_final(&context, hash);
    std::string hex;
    for (const uint8_t byte : hash) {
        char digits[3];
        std::snprintf(digits, sizeof digits, "%02x", byte);
        hex += digits;
    }
    return hex;
}

// The signature covers the app's id, its platform and architecture, the version and the file's SHA-512, as the build
// signed them, so that no update passes for another app's, platform's or version's.
void verify(const Manifest &manifest, const fs::path &file) {
    const std::vector<uint8_t> signature = fromBase64(manifest.signature);
    const std::string text =
        std::string("crossbind update\n" CROSSBIND_APP_ID "\n") + PLATFORM + "-" + ARCH + "\n" + manifest.version + "\n" + sha512Of(file) + "\n";
    const bool holds = signature.size() == SIGNATURE_SIZE && toBase64(signature.data(), signature.size()) == manifest.signature &&
                       crypto_ed25519_check(signature.data(), PUBLIC_KEY, reinterpret_cast<const uint8_t *>(text.data()), text.size()) == 0;
    if (!holds) {
        throw std::runtime_error("crossbind: the update to " + manifest.version +
                                 " is not signed with the key of app.updater.publicKey, so the app does not install it");
    }
}

#ifndef _WIN32

#ifdef __APPLE__
constexpr const char *READ_ONLY_HINT = "The app updates in a folder its user can change: one opened from its disk image, or from where it was "
                                       "downloaded to, updates once it is moved to Applications.";
#else
constexpr const char *READ_ONLY_HINT = "The app updates in a folder its user can change: one installed from its Debian package updates with the "
                                       "package manager.";
#endif

[[noreturn]] void cannotInstall(const std::string &why) { throw std::runtime_error("crossbind: cannot install the update: " + why); }

// The child's id, or -1 with errno saying why there is none.
pid_t spawn(const std::vector<std::string> &command) {
    std::vector<char *> argv;
    for (const auto &arg : command) argv.push_back(const_cast<char *>(arg.c_str()));
    argv.push_back(nullptr);
    pid_t child = 0;
    if (const int error = posix_spawn(&child, argv[0], nullptr, nullptr, argv.data(), environ)) {
        errno = error;
        return -1;
    }
    return child;
}

bool runs(const std::vector<std::string> &command) {
    const pid_t child = spawn(command);
    if (child < 0) return false;
    int status = 0;
    pid_t waited = 0;
    do {
        waited = waitpid(child, &status, 0);
    } while (waited < 0 && errno == EINTR);
    return waited == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

// The one folder an update unpacks to, or none.
fs::path unpackedApp(const fs::path &staging) {
    std::vector<fs::path> entries;
    for (const auto &entry : fs::directory_iterator(staging)) entries.push_back(entry.path());
    return entries.size() == 1 && fs::is_directory(fs::symlink_status(entries[0])) ? entries[0] : fs::path();
}

// Trades the two places at once, so that no moment leaves the app missing.
bool swapped(const fs::path &a, const fs::path &b) {
#ifdef __APPLE__
    return renamex_np(a.c_str(), b.c_str(), RENAME_SWAP) == 0;
#else
    return renameat2(AT_FDCWD, a.c_str(), AT_FDCWD, b.c_str(), RENAME_EXCHANGE) == 0;
#endif
}

// Puts the app the update unpacks in place of this one, and opens it once this one has quit. The update unpacks beside
// the app, on the same disk, whose file system swaps the two.
void replaceApp(const fs::path &update) {
#ifdef __APPLE__
    // A macOS app is its bundle, which ditto unpacks with its signature and Apple's ticket, and open opens anew.
    const fs::path app = pathOf(resourceDir()).parent_path().parent_path();
    const fs::path marker = fs::path("Contents") / "Info.plist";
    const std::vector<std::string> unpack = {"/usr/bin/ditto", "-x", "-k", update.string()};
    const std::vector<std::string> reopen = {"/usr/bin/open", "-n", app.string()};
#else
    // A Linux app is a folder, which tar unpacks as this user's, opened anew by its executable.
    const fs::path executable = fs::read_symlink("/proc/self/exe");
    const fs::path app = executable.parent_path();
    const fs::path marker = executable.filename();
    const std::vector<std::string> unpack = {"/bin/tar", "--no-same-owner", "-xzf", update.string(), "-C"};
    const std::vector<std::string> reopen = {executable.string()};
#endif
    std::string staging = (app.parent_path() / ".crossbind-update-XXXXXX").string();
    if (!mkdtemp(staging.data())) cannotInstall(app.parent_path().string() + ": " + std::strerror(errno) + ". " + READ_ONLY_HINT);
    std::error_code ignored;
    try {
        std::vector<std::string> command = unpack;
        command.push_back(staging);
        if (!runs(command)) cannotInstall(command[0] + " cannot unpack " + update.string());
        const fs::path unpacked = unpackedApp(staging);
        if (unpacked.empty() || !fs::exists(unpacked / marker)) cannotInstall(update.string() + " holds no app");
        checkSigner(unpacked);
        if (!swapped(unpacked, app)) cannotInstall(app.parent_path().string() + " cannot swap the app for its update: " + std::strerror(errno));
    } catch (...) {
        fs::remove_all(staging, ignored);
        throw;
    }
    // The old app is where the update was unpacked.
    fs::remove_all(staging, ignored);
    // A shell waits for this process to end, then opens the app.
    std::vector<std::string> waitThenOpen = {"/bin/sh", "-c", "while kill -0 \"$1\" 2>/dev/null; do sleep 0.1; done; shift; exec \"$@\"", "sh",
                                             std::to_string(getpid())};
    waitThenOpen.insert(waitThenOpen.end(), reopen.begin(), reopen.end());
    if (spawn(waitThenOpen) < 0) {
        throw std::runtime_error("crossbind: the update is installed, but the app cannot open it anew: " + std::string(std::strerror(errno)) + ". Open the app again");
    }
}

#endif

}  // namespace

std::optional<std::string> checkForUpdate() {
    const std::unique_lock<std::mutex> lock = lockUpdates();
    const std::optional<Manifest> manifest = newerUpdate(updateFolder());
    return manifest ? std::optional<std::string>(manifest->version) : std::nullopt;
}

void installUpdate() {
    const std::unique_lock<std::mutex> lock = lockUpdates();
    const fs::path folder = updateFolder();
    const std::optional<Manifest> manifest = newerUpdate(folder);
    if (!manifest) {
        throw std::runtime_error("crossbind: the app is up to date: " + manifestUrl() + " offers no version newer than " CROSSBIND_APP_UPDATER_VERSION);
    }
    const fs::path file = folder / manifest->file;
    try {
        download(fileUrl(manifestUrl(), manifest->file), file, MAX_UPDATE_SIZE);
        verify(*manifest, file);
#ifdef _WIN32
        checkSigner(file);
        runSetup(file);
#else
        replaceApp(file);
#endif
    } catch (...) {
        std::error_code ignored;
        fs::remove(file, ignored);
        throw;
    }
#ifndef _WIN32
    std::error_code ignored;
    fs::remove(file, ignored);
#endif
    quitApp();
}

#else

namespace {

[[noreturn]] void noUpdater() {
    throw std::runtime_error(
        "crossbind: this app does not update itself: a desktop app does with app.updater in crossbind.config.js, an iOS or Android app "
        "through its store");
}

}  // namespace

std::optional<std::string> checkForUpdate() { noUpdater(); }

void installUpdate() { noUpdater(); }

#endif

}  // namespace crossbind::app
