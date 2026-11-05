#pragma once

// What an app's host does for the app's own code: the dialogs that pick files or show a message, opening an address or
// a file outside the app, moving a file to the trash, the app's folders, quitting and opening anew, events for the page
// and a desktop app's updates. The page reaches the same through crossbind/app, where openPath() opens files where
// app.openPath lets it alone, and revealInFolder() and trash() reach the app's folders and what a dialog picked alone;
// here they reach any path. Call them from the module's code, which an app builds with CROSSBIND_APP defined, once the
// module has started: the dialogs, the updater's and the functions that open something wait for the app's main thread,
// which calls none of them, and paths(), quit(), requestQuit(), emitEvent() and holdEvent() any thread calls. Those
// that wait throw when called before the app can answer, as from a static initializer, or once the app quits. What
// fails throws a std::runtime_error, which says why. An iOS app has messageDialog(), paths(), openExternal(),
// emitEvent() and holdEvent() alone, and an Android app messageDialog(), paths(), emitEvent() and holdEvent(): the
// others throw there.
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace crossbind::app {

// A kind of file a dialog offers: its name, and the extensions, with or without the dot, that make it; "*" is any file.
struct FileFilter {
    std::string name;
    std::vector<std::string> extensions;
};

struct OpenOptions {
    std::string title;
    // The folder the dialog shows first.
    std::string defaultPath;
    std::vector<FileFilter> filters;
    // Folders instead of files.
    bool directory = false;
    bool multiple = false;
};

struct SaveOptions {
    std::string title;
    // The folder the dialog shows first.
    std::string defaultPath;
    std::string defaultName;
    std::vector<FileFilter> filters;
};

enum class MessageKind { info, warning, error };

struct MessageOptions {
    std::string message;
    // Smaller text under the message.
    std::string detail;
    // Windows shows its icon for each, and macOS a caution sign for error; Linux, iOS and Android show none.
    MessageKind kind = MessageKind::info;
    // One to three labels, the first the default; none is OK.
    std::vector<std::string> buttons;
};

// The app's own folders, made when first asked for: what it keeps, what it can lose, and its logs; the read-only one of
// the files app.files lists, each in the place it had in the project; and an iOS app's App Group's, which the targets of
// its extensions' that ask for it share, or none.
struct Paths {
    std::string data;
    std::string cache;
    std::string logs;
    std::string resources;
    std::string group;
};

// The files or folders the user picked, or nothing when they cancelled.
std::optional<std::vector<std::string>> openDialog(const OpenOptions &options = {});
// The file the user chose to save to, or nothing when they cancelled.
std::optional<std::string> saveDialog(const SaveOptions &options = {});
// The index of the button the user clicked: Return gives the first, and Escape or closing the dialog the last.
int messageDialog(const MessageOptions &options);
// A web or mail address in the default browser or mail app: http, https and mailto alone.
void openExternal(const std::string &url);
// A file in the app the system opens its kind with, at an absolute path.
void openPath(const std::string &path);
// A file, selected, in the system's file manager.
void revealInFolder(const std::string &path);
// A file or folder moved to the system's trash, which fails and moves nothing where the system has no trash.
void trash(const std::string &path);
Paths paths();
// Ends the app as closing its last window does, without asking the extensions that may keep a window open.
void quit();
// Asks the extensions' onQuitRequest, as the app's user's Quit does, then ends the app as quit() does, unless one keeps
// it running: from any thread, without waiting. A desktop app's alone.
void requestQuit();
// Ends the app as quit() does, then opens it anew, with no arguments.
void relaunch();
// Sends every page that listens to it an event, whose listeners through crossbind/app's events.on get the value json
// holds, a JSON text. It waits for nothing, so any thread may call it. A page gets the events emitted once it listens to
// their name: one emitted before, as before its page loads or once the app quits, reaches none. The events menu,
// second-instance, open-url, suspend, resume, active, inactive, drop, open-files, tray, notification, user-activity,
// shortcut-item, window-opened and window-closed are the host's own.
void emitEvent(const std::string &event, const std::string &json = "null");
// Sends an event as emitEvent() does to one page alone, by its id, as an extension's Page names it: none once that page
// went.
void emitEvent(const std::string &event, const std::string &json, uint64_t page);
// Sends an event as emitEvent() does to the page in front that listens to it, of the window its user used last, for
// what one page is to act on once.
void emitEventToFront(const std::string &event, const std::string &json = "null");
// Sends an event as emitEvent() does, which the host holds until a page asks for the events of its name with
// crossbind/app's events.held() since it loaded, as what came before it listened, then hands to the page in front that
// asked, of the window its user used last: each reaches one page once, in that answer or as the event while it
// listens, and one a reload cut off waits for the next ask. The host holds 1,000 of a name at most. Any thread may call
// it, before the module starts as well, as an extension's onStart does.
void holdEvent(const std::string &event, const std::string &json = "null");
// The version app.updater.url in crossbind.config.js offers when it is newer than this app's, or nothing. It waits for
// the download, and throws while another check or install runs.
std::optional<std::string> checkForUpdate();
// Downloads that version, checks that the key of app.updater.publicKey signed it and installs it in place of this app,
// which then quits and opens the new version. It throws when the app is up to date or the update fails.
void installUpdate();

}  // namespace crossbind::app
