#pragma once

// An iOS app's windows, one for each scene of the app's that connects: what a scene opens with, and what crossbind/app's
// windows.* reach of them (windows.mm).
#import <UIKit/UIKit.h>

#include <cstdint>
#include <string>

// What a scene's window opens with: its page's path and its name and title, as windows.open() asked for them, or a
// restored scene kept them; the window the system opens as an iPad's user asks for another has none, and shows '/'.
// request names the windows.open() that waits for the window's id.
struct SceneWindow {
    std::string path = "/";
    std::string name;
    std::string title;
    std::string request;
};

// What the scene of this session opens with, which it keeps for iOS to restore it with.
SceneWindow sceneWindowOf(UISceneSession *session, UISceneConnectionOptions *options);
// Whether a user activity is the one windows.open() asks iOS for a scene with, which reaches no extension.
bool isWindowActivity(NSUserActivity *activity);
// The window of a scene opened, with its id, on the main thread.
void sceneOpened(UIWindowScene *scene, uint64_t id, const SceneWindow &window);
// The scene of the window of this id came to the front, on the main thread: a window closed in the background goes now.
void sceneActivated(uint64_t id);
// The scene of the window of this id went, on the main thread: the app's window used last takes the front from one
// closed in front.
void sceneClosed(uint64_t id);
