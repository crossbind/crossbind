#pragma once

// What an app's host does for the app's own code: the app's folders, quitting and opening anew, and events for the page.
// Call them from the module's code, which an app builds with CROSSBIND_APP defined, on any thread. What fails throws a
// std::runtime_error, which says why. A phone's app has paths(), emitEvent() and holdEvent() alone: the others throw
// there. The functions of the app's extensions, which the page reaches through crossbind/app, its native code calls by
// their names, with <crossbind/extension.h>'s invoke().
#include <cstdint>
#include <string>

namespace crossbind::app {

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
// their name: one emitted before, as before its page loads or once the app quits, reaches none. The events active,
// inactive, window-opened and window-closed are the host's own, and each of crossbind's own extensions names its own.
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

}  // namespace crossbind::app
