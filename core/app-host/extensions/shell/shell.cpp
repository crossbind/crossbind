// The ways out of the app the page calls through crossbind/app's shell, and the app's own code through <crossbind/app.h>:
// an address in its browser, a file in its app, one in the file manager and one in the trash. The page reaches the places
// it may alone; the app's own code reaches any path.
#include "shell.h"

#include "crossbind/app.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <filesystem>
#include <stdexcept>
#include <vector>

namespace crossbind::shell {
namespace {

namespace fs = std::filesystem;

fs::path pathOf(const std::string &text) { return fs::path(std::u8string(text.begin(), text.end())); }

// ASCII alone, whatever locale GTK sets.
char lower(char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c; }

// An address opens outside the app only when it is one a browser or a mail app takes. It goes on in ASCII, with a space,
// a quote, any other byte and a % that escapes nothing escaped: every system opens it alike, no handler's command line
// splits it, and Windows finds no %VARIABLE% to expand in it.
std::string checkedUrl(const std::string &url) {
    const auto colon = url.find(':');
    std::string scheme = url.substr(0, colon == std::string::npos ? 0 : colon);
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), lower);
    const bool hasControl = std::any_of(url.begin(), url.end(), [](unsigned char c) { return c < ' ' || c == 0x7f; });
    if ((scheme != "http" && scheme != "https" && scheme != "mailto") || hasControl) {
        throw std::invalid_argument("crossbind: openExternal opens http, https and mailto addresses alone, not " + url);
    }
    std::string escaped;
    for (size_t i = 0; i < url.size(); i += 1) {
        const unsigned char c = url[i];
        const bool isEscape = c == '%' && i + 2 < url.size() && std::isxdigit(static_cast<unsigned char>(url[i + 1])) &&
                              std::isxdigit(static_cast<unsigned char>(url[i + 2]));
        if (c < 0x80 && c != ' ' && c != '"' && (c != '%' || isEscape)) {
            escaped += static_cast<char>(c);
            continue;
        }
        char hex[4];
        std::snprintf(hex, sizeof hex, "%%%02X", c);
        escaped += hex;
    }
    return escaped;
}

// A relative path would mean the host's own working folder.
void checkPath(const std::string &path, const std::string &function) {
    if (path.empty() || path.find('\0') != std::string::npos || !pathOf(path).is_absolute()) {
        throw std::invalid_argument("crossbind: " + function + " takes an absolute path, not \"" + path + "\"");
    }
}

// A path as written, without a trailing separator: comparing never touches the disk or a network share.
fs::path normal(std::string text) {
#ifdef _WIN32
    // Windows names a file in any case.
    std::transform(text.begin(), text.end(), text.begin(), lower);
#endif
    const fs::path path = pathOf(text).lexically_normal();
    return path.has_filename() ? path : path.parent_path();
}

bool isWithin(const fs::path &path, const fs::path &folder) {
    return std::mismatch(folder.begin(), folder.end(), path.begin(), path.end()).first == folder.end();
}

// What the app's dialogs picked during this run, as normal() writes it.
std::vector<fs::path> picked() {
    std::vector<fs::path> out;
    for (const auto &path : allowedPaths()) out.push_back(normal(path));
    return out;
}

// The page reaches places by name: the app's folders as app.paths() names them, and "picked", what its dialogs picked, a
// picked folder with what is in it.
void checkScope(const std::string &path, const char *function, const std::vector<std::string> &places, const char *rule) {
    // The system follows a link before a .., which leads it elsewhere than the path reads.
    for (const auto &part : pathOf(path)) {
        if (part == "." || part == "..") throw std::invalid_argument(std::string("crossbind: the page's ") + function + " takes a path without . or .., not " + path);
    }
    const fs::path asked = normal(path);
    const app::Paths folders = app::paths();
    std::vector<fs::path> allowed;
    for (const auto &place : places) {
        if (place == "data") allowed.push_back(normal(folders.data));
        if (place == "cache") allowed.push_back(normal(folders.cache));
        if (place == "logs") allowed.push_back(normal(folders.logs));
        if (place == "picked") {
            const std::vector<fs::path> paths = picked();
            allowed.insert(allowed.end(), paths.begin(), paths.end());
        }
    }
    if (std::none_of(allowed.begin(), allowed.end(), [&](const fs::path &folder) { return isWithin(asked, folder); })) {
        throw std::invalid_argument(std::string("crossbind: the page's ") + function + " " + rule + ", not " + path +
                                    "; the app's native code reaches any path through <crossbind/app.h>");
    }
}

// Where a path written as normal() writes it leads, the links of the folders above it followed; the system's trash
// follows those and moves the last name itself, a link as well. None when the system cannot tell.
std::optional<fs::path> followedParent(const fs::path &path) {
    std::error_code error;
    const std::u8string parent = fs::weakly_canonical(path.parent_path(), error).u8string();
    if (error) return std::nullopt;
    return normal(std::string(parent.begin(), parent.end())) / path.filename();
}

// A folder written as normal() writes it, its links followed.
fs::path followed(const fs::path &folder) {
    std::error_code error;
    const std::u8string real = fs::weakly_canonical(folder, error).u8string();
    return error ? folder : normal(std::string(real.begin(), real.end()));
}

// The page's trash takes what is in the app's folders, but none of the folders, and what its dialogs picked, both as
// the path is written and where it leads.
void checkTrash(const std::string &path) {
    const char *rule = "trashes what is in the app's folders and what its dialogs picked";
    checkScope(path, "shell.trash", {"data", "cache", "logs", "picked"}, rule);
    const std::optional<fs::path> asked = followedParent(normal(path));
    if (!asked) throw std::invalid_argument("crossbind: the page's shell.trash cannot tell where " + path + " leads");
    const app::Paths folders = app::paths();
    std::vector<fs::path> allowed;
    for (const auto &folder : {folders.data, folders.cache, folders.logs}) {
        allowed.push_back(followed(normal(folder)));
        if (normal(path) == normal(folder) || *asked == allowed.back()) {
            throw std::invalid_argument("crossbind: the page's shell.trash takes what is in the app's folders, not " + path + " itself");
        }
    }
    // A picked folder's own link is followed as well, and a picked file's is not.
    for (const auto &item : picked()) {
        allowed.push_back(followed(item));
        if (const auto parent = followedParent(item)) allowed.push_back(*parent);
    }
    if (std::none_of(allowed.begin(), allowed.end(), [&](const fs::path &folder) { return isWithin(*asked, folder); })) {
        throw std::invalid_argument(std::string("crossbind: the page's shell.trash ") + rule + ", not " + path + ", which a link leads out of them");
    }
}

Done answered(Call call) {
    return [call = std::move(call)](std::optional<std::string> failure) {
        if (failure) call.reject(*failure);
        else call.resolve();
    };
}

// The places app.openPath lists, which the build checked.
std::vector<std::string> placesOf(const Value &list) {
    std::vector<std::string> out;
    if (list.isNull()) return out;
    for (const Value &place : list.asArray()) out.push_back(place.asString());
    return out;
}

// The absolute path a call names: the page's call names its function as crossbind/app does, the app's own code's as
// <crossbind/app.h> does.
std::string pathIn(const Call &call, const char *function) {
    const std::string path = call.options()["path"].asString("");
    checkPath(path, call.isFromPage() ? std::string("shell.") + function : std::string(function));
    return path;
}

}  // namespace
}  // namespace crossbind::shell

void crossbind_extension_shell(crossbind::Registry &registry) {
    using namespace crossbind::shell;
    using crossbind::Call;
    // Opening a program runs it: the page opens files where the app lets it alone.
    const std::vector<std::string> openPlaces = placesOf(registry.options()["openPath"]);
    registry.function("shell.openExternal", [](Call call) { openUrl(checkedUrl(call.options()["url"].asString("")), answered(call)); });
    registry.function("shell.openPath", [openPlaces](Call call) {
        const std::string path = pathIn(call, "openPath");
        if (call.isFromPage()) {
            checkScope(path, "shell.openPath", openPlaces, "opens what app.openPath in crossbind.config.js lists of data, cache, logs and picked");
        }
        openFile(path, answered(call));
    });
    registry.function("shell.revealInFolder", [](Call call) {
        const std::string path = pathIn(call, "revealInFolder");
        if (call.isFromPage()) checkScope(path, "shell.revealInFolder", {"data", "cache", "logs", "picked"}, "reaches the app's folders and what its dialogs picked");
        revealFile(path, answered(call));
    });
    registry.function("shell.trash", [](Call call) {
        const std::string path = pathIn(call, "trash");
        if (call.isFromPage()) checkTrash(path);
        trashFile(path, answered(call));
    });
}
