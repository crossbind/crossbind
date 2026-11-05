// The page's menus, the tray's icon in the menu bar and the system's notifications on macOS. The page's menus follow the
// app menu the host starts the app with.
#import <Cocoa/Cocoa.h>
#import <UserNotifications/UserNotifications.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

#include "menu.h"

#include "crossbind/app.h"

#include <cctype>
#include <cstdio>
#include <map>
#include <stdexcept>

// What a click of one of the page's items does: it tells the page, after toggling the item when it has checked. A click
// of the tray's icon without a menu tells the page as well.
@interface CrossbindMenuTarget : NSObject
- (void)clicked:(NSMenuItem *)item;
- (void)trayClicked:(id)sender;
@end

// What a click of one of a popup's items does: the popup answers with its id. AppKit sends the action before the popup
// returns.
@interface CrossbindPopupTarget : NSObject {
@public
    NSString *picked;
}
- (void)picked:(NSMenuItem *)item;
@end

namespace crossbind::menu {
namespace {

// The tags of the page's items.
constexpr NSInteger CHECKABLE = 1;
constexpr NSInteger DISABLED = 2;
// The size of the icons in macOS's menu bar.
constexpr CGFloat TRAY_ICON_SIZE = 18;

MenuClicked onClick;
// A menu item holds its target weakly.
CrossbindMenuTarget *target;
NSStatusItem *tray;

// A menu bar and its Window menu, which AppKit lists the app's windows in.
struct Bar {
    NSMenu *menu = nil;
    NSMenu *windows = nil;
};
// The menus each window's page set, by the window's id, which the menu bar shows while that window is key, and the bar
// the host started the app with, for a window that set none.
std::map<uint64_t, Bar> bars;
Bar startBar;
// The Window menu the last bar made has, as windowMenu makes it.
NSMenu *madeWindowsMenu;

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

void onMain(void (^block)(void)) { dispatch_async(dispatch_get_main_queue(), block); }

NSMenuItem *item(NSString *title, SEL action, NSString *key, NSEventModifierFlags modifiers = NSEventModifierFlagCommand) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
    item.keyEquivalentModifierMask = modifiers;
    return item;
}

// A standard item, which its role names and AppKit's responder chain does.
NSMenuItem *roleItem(const std::string &role) {
    if (role == "undo") return item(@"Undo", @selector(undo:), @"z");
    if (role == "redo") return item(@"Redo", @selector(redo:), @"z", NSEventModifierFlagCommand | NSEventModifierFlagShift);
    if (role == "cut") return item(@"Cut", @selector(cut:), @"x");
    if (role == "copy") return item(@"Copy", @selector(copy:), @"c");
    if (role == "paste") return item(@"Paste", @selector(paste:), @"v");
    if (role == "selectAll") return item(@"Select All", @selector(selectAll:), @"a");
    if (role == "minimize") return item(@"Minimize", @selector(performMiniaturize:), @"m");
    if (role == "close") return item(@"Close", @selector(performClose:), @"w");
    if (role == "quit") return item([@"Quit " stringByAppendingString:ns(appName())], @selector(terminate:), @"q");
    throw std::invalid_argument("crossbind: no menu item has the role " + role);
}

void addEditItems(NSMenu *edit) {
    [edit addItem:roleItem("undo")];
    [edit addItem:roleItem("redo")];
    [edit addItem:NSMenuItem.separatorItem];
    [edit addItem:roleItem("cut")];
    [edit addItem:roleItem("copy")];
    [edit addItem:roleItem("paste")];
    [edit addItem:item(@"Paste and Match Style", @selector(pasteAsPlainText:), @"v",
                       NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift)];
    [edit addItem:item(@"Delete", @selector(delete:), @"")];
    [edit addItem:roleItem("selectAll")];
}

// AppKit lists the app's windows below, once its bar shows.
void addWindowItems(NSMenu *window) {
    [window addItem:roleItem("minimize")];
    [window addItem:item(@"Zoom", @selector(performZoom:), @"")];
    [window addItem:NSMenuItem.separatorItem];
    [window addItem:roleItem("close")];
    madeWindowsMenu = window;
}

const std::map<std::string, unichar> NAMED_KEYS{
    {"Enter", '\r'}, {"Escape", 0x1b}, {"Tab", '\t'}, {"Space", ' '}, {"Backspace", NSBackspaceCharacter},
    {"Delete", NSDeleteFunctionKey}, {"Up", NSUpArrowFunctionKey}, {"Down", NSDownArrowFunctionKey},
    {"Left", NSLeftArrowFunctionKey}, {"Right", NSRightArrowFunctionKey}, {"Home", NSHomeFunctionKey},
    {"End", NSEndFunctionKey}, {"PageUp", NSPageUpFunctionKey}, {"PageDown", NSPageDownFunctionKey}, {"Plus", '+'},
    {"Minus", '-'}, {"Comma", ','}, {"Period", '.'},
};

void setAccelerator(NSMenuItem *made, const Accelerator &accelerator) {
    const std::string &key = accelerator.key;
    unichar character = 0;
    if (accelerator.function) {
        character = static_cast<unichar>(NSF1FunctionKey + accelerator.function - 1);
    } else if (key.size() == 1) {
        character = static_cast<unichar>(std::tolower(static_cast<unsigned char>(key[0])));
    } else if (const auto named = NAMED_KEYS.find(key); named != NAMED_KEYS.end()) {
        character = named->second;
    } else {
        throw std::invalid_argument("crossbind: no accelerator has the key " + key);
    }
    made.keyEquivalent = [NSString stringWithCharacters:&character length:1];
    made.keyEquivalentModifierMask = (accelerator.command ? NSEventModifierFlagCommand : 0) |
                                     (accelerator.control ? NSEventModifierFlagControl : 0) |
                                     (accelerator.alt ? NSEventModifierFlagOption : 0) |
                                     (accelerator.shift ? NSEventModifierFlagShift : 0);
}

NSMenuItem *itemOf(const MenuItem &page);

NSMenuItem *menuOf(const MenuItem &page) {
    const bool isEdit = page.role == "editMenu";
    const bool isWindow = page.role == "windowMenu";
    NSString *title = !page.label.empty() ? ns(page.label) : isEdit ? @"Edit" : isWindow ? @"Window" : @"";
    NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
    if (isEdit) {
        addEditItems(menu);
    } else if (isWindow) {
        addWindowItems(menu);
    } else {
        for (const auto &child : page.items) [menu addItem:itemOf(child)];
    }
    NSMenuItem *holder = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
    holder.submenu = menu;
    return holder;
}

NSMenuItem *itemOf(const MenuItem &page) {
    if (page.isSeparator) return NSMenuItem.separatorItem;
    if (page.isSubmenu || page.role == "editMenu" || page.role == "windowMenu") return menuOf(page);
    NSMenuItem *made = nil;
    if (page.role.empty()) {
        made = [[NSMenuItem alloc] initWithTitle:ns(page.label) action:@selector(clicked:) keyEquivalent:@""];
        made.target = target;
        made.representedObject = ns(page.id);
        made.tag = (page.checked ? CHECKABLE : 0) | (page.isEnabled ? 0 : DISABLED);
        if (page.checked) made.state = *page.checked ? NSControlStateValueOn : NSControlStateValueOff;
    } else {
        made = roleItem(page.role);
        if (!page.label.empty()) made.title = ns(page.label);
    }
    if (page.accelerator) setAccelerator(made, *page.accelerator);
    return made;
}

// The window of the app's whose bar a menu is in, by the bar's top menu; 0 for the tray's and the Dock's.
uint64_t windowOfMenu(NSMenu *menu) {
    while (menu.supermenu) menu = menu.supermenu;
    for (const auto &[window, bar] : bars) {
        if (bar.menu == menu) return window;
    }
    return 0;
}

// The window of the app's of an NSWindow: a sheet's parent, whose bar shows while the sheet is key.
uint64_t idOf(NSWindow *window) {
    if (window.sheetParent) window = window.sheetParent;
    for (const Window &open : openWindows()) {
        if ((__bridge NSWindow *)open.native() == window) return open.id();
    }
    return 0;
}

// The menu bar shows the menus of this window's page, or those the app started with, and the app menu moves to them.
void showBarOf(uint64_t window) {
    const auto found = bars.find(window);
    const Bar shown = found == bars.end() ? startBar : found->second;
    if (!shown.menu || shown.menu == NSApp.mainMenu) return;
    if (NSMenuItem *app = NSApp.mainMenu.itemArray.firstObject) {
        [NSApp.mainMenu removeItem:app];
        [shown.menu insertItem:app atIndex:0];
    }
    NSApp.mainMenu = shown.menu;
    NSApp.windowsMenu = shown.windows;
}

// The key window's bar shows, from the first menus a page sets on.
void watchKeyWindows() {
    static bool isWatching = false;
    if (isWatching) return;
    isWatching = true;
    startBar = Bar{NSApp.mainMenu, NSApp.windowsMenu};
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidBecomeKeyNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *note) {
                                                  showBarOf(idOf(note.object));
                                                }];
}

}  // namespace
}  // namespace crossbind::menu

@implementation CrossbindMenuTarget

- (void)clicked:(NSMenuItem *)item {
    std::optional<bool> checked;
    if (item.tag & crossbind::menu::CHECKABLE) {
        item.state = item.state == NSControlStateValueOn ? NSControlStateValueOff : NSControlStateValueOn;
        checked = item.state == NSControlStateValueOn;
    }
    NSString *itemId = item.representedObject;
    if (crossbind::menu::onClick && itemId.length > 0) crossbind::menu::onClick(crossbind::menu::windowOfMenu(item.menu), itemId.UTF8String, checked);
}

- (void)trayClicked:(id)sender {
    crossbind::app::emitEventToFront("tray");
}

// AppKit enables an item whose target takes its action, unless the item says otherwise.
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    return !(item.tag & crossbind::menu::DISABLED);
}

@end

@implementation CrossbindPopupTarget

- (void)picked:(NSMenuItem *)item {
    picked = item.representedObject;
}

- (BOOL)validateMenuItem:(NSMenuItem *)item {
    return !(item.tag & crossbind::menu::DISABLED);
}

@end

namespace crossbind::menu {

// A window's menus follow the app menu, which the app keeps from the menus the host starts it with, and show while it
// is the key window.
void setMenu(uint64_t window, std::vector<MenuItem> menus, MenuClicked clicked, std::function<void(Failure)> done) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!windowOf(window)) {
          done(std::string("crossbind: the page's window has closed"));
          return;
      }
      try {
          if (!target) target = [CrossbindMenuTarget new];
          watchKeyWindows();
          madeWindowsMenu = nil;
          NSMenu *bar = [NSMenu new];
          for (const auto &menu : menus) [bar addItem:itemOf(menu)];
          // The bar it replaces lets go of the app menu first.
          const bool isShown = bars.count(window) && bars[window].menu == NSApp.mainMenu;
          if (isShown) showBarOf(0);
          bars[window] = Bar{bar, madeWindowsMenu};
          onClick = clicked;
          if (isShown || idOf(NSApp.keyWindow) == window) showBarOf(window);
          done(std::nullopt);
      } catch (const std::exception &error) {
          done(std::string(error.what()));
      }
    });
}

void dropMenus(uint64_t window) {
    const auto found = bars.find(window);
    if (found == bars.end()) return;
    if (found->second.menu == NSApp.mainMenu) showBarOf(0);
    bars.erase(found);
}

namespace {

// A popup's items of the page's answer the popup, not the page's menus.
void answerPopup(NSMenu *menu, CrossbindPopupTarget *popup) {
    for (NSMenuItem *entry in menu.itemArray) {
        if (entry.target == target) {
            entry.target = popup;
            entry.action = @selector(picked:);
        }
        if (entry.submenu) answerPopup(entry.submenu, popup);
    }
}

}  // namespace

// WKWebView's points are the page's CSS pixels at its zoom, from its top left. The menu's loop runs the main queue's
// blocks, and so the page's next popup, which waits for none.
void popupMenu(uint64_t window, std::vector<MenuItem> items, double x, double y, std::function<void(Failure, std::optional<std::string>)> done) {
    dispatch_async(dispatch_get_main_queue(), ^{
      static bool isOpen = false;
      const std::optional<Window> open = windowOf(window);
      WKWebView *view = open ? (__bridge WKWebView *)open->webView() : nil;
      if (!view.window) {
          done(std::string("crossbind: the app has no window to show a menu in"), std::nullopt);
          return;
      }
      if (isOpen) {
          done(std::string("crossbind: a menu of the page's is open already"), std::nullopt);
          return;
      }
      CrossbindPopupTarget *popup = [CrossbindPopupTarget new];
      NSMenu *menu = [NSMenu new];
      try {
          if (!target) target = [CrossbindMenuTarget new];
          for (const auto &item : items) [menu addItem:itemOf(item)];
      } catch (const std::exception &error) {
          done(std::string(error.what()), std::nullopt);
          return;
      }
      answerPopup(menu, popup);
      NSPoint at = NSMakePoint(x * view.pageZoom, y * view.pageZoom);
      if (!view.isFlipped) at.y = NSHeight(view.bounds) - at.y;
      isOpen = true;
      [menu popUpMenuPositioningItem:nil atLocation:at inView:view];
      isOpen = false;
      done(std::nullopt, popup->picked.length > 0 ? std::optional<std::string>(popup->picked.UTF8String) : std::nullopt);
    });
}

namespace {

// The Dock's menu of the page's, which the app's delegate gives the Dock, none before the page sets one.
NSMenu *dockMenu;
// Whether the app's delegate gives the Dock dockMenu, as answerDockMenu() made it.
bool isAnsweringDock = false;

}  // namespace

void answerDockMenu() {
    id delegate = NSApp.delegate;
    if (!delegate || isAnsweringDock) return;
    if ([delegate respondsToSelector:@selector(applicationDockMenu:)]) {
        std::fprintf(stderr, "crossbind: the app's delegate gives the Dock a menu of its own, which menu.setDock leaves as it is\n");
        return;
    }
    const char *types = protocol_getMethodDescription(@protocol(NSApplicationDelegate), @selector(applicationDockMenu:), NO, YES).types;
    class_addMethod([delegate class], @selector(applicationDockMenu:), imp_implementationWithBlock(^NSMenu *(id, NSApplication *) {
                        return dockMenu;
                    }),
                    types);
    isAnsweringDock = true;
    // AppKit learns what a delegate answers as it is set.
    NSApp.delegate = nil;
    NSApp.delegate = delegate;
}

void setDockMenu(std::vector<MenuItem> items, MenuClicked clicked, std::function<void(Failure)> done) {
    dispatch_async(dispatch_get_main_queue(), ^{
      try {
          if (!isAnsweringDock) throw std::runtime_error("crossbind: the app's delegate gives the Dock no menu of the page's");
          if (!target) target = [CrossbindMenuTarget new];
          NSMenu *menu = items.empty() ? nil : [NSMenu new];
          for (const auto &item : items) [menu addItem:itemOf(item)];
          dockMenu = menu;
          onClick = clicked;
          done(std::nullopt);
      } catch (const std::exception &error) {
          done(std::string(error.what()));
      }
    });
}

// The tray's icon is the app's own. A click opens its menu, or without one tells the page.
void setTray(TrayOptions options, MenuClicked clicked, std::function<void(Failure)> done) {
    dispatch_async(dispatch_get_main_queue(), ^{
      try {
          if (!target) target = [CrossbindMenuTarget new];
          NSMenu *menu = nil;
          if (!options.menu.empty()) {
              menu = [NSMenu new];
              for (const auto &item : options.menu) [menu addItem:itemOf(item)];
          }
          if (!tray) {
              tray = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
              NSImage *icon = [NSApp.applicationIconImage copy];
              icon.size = NSMakeSize(TRAY_ICON_SIZE, TRAY_ICON_SIZE);
              tray.button.image = icon;
              // A right click tells the page as a click does elsewhere.
              [tray.button sendActionOn:NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp];
          }
          tray.button.toolTip = options.tooltip.empty() ? nil : ns(options.tooltip);
          tray.button.target = target;
          tray.button.action = menu ? nil : @selector(trayClicked:);
          tray.menu = menu;
          onClick = clicked;
          done(std::nullopt);
      } catch (const std::exception &error) {
          done(std::string(error.what()));
      }
    });
}

void removeTray(std::function<void(Failure)> done) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (tray) [NSStatusBar.systemStatusBar removeStatusItem:tray];
      tray = nil;
      done(std::nullopt);
    });
}

// macOS asks its user the first time, and has no notifications for an executable outside a bundle, as a development
// session may run. The host's notification center shows each while the app is in front, and hands menu.cpp its taps.
void showNotification(Notification notification, std::function<void(Failure)> done) {
    onMain(^{
      if (!NSBundle.mainBundle.bundleIdentifier) {
          done("crossbind: a macOS app shows notifications from its bundle alone");
          return;
      }
      UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
      UNMutableNotificationContent *content = [UNMutableNotificationContent new];
      content.title = ns(notification.title);
      content.body = ns(notification.body);
      content.sound = UNNotificationSound.defaultSound;
      [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound
                            completionHandler:^(BOOL isAllowed, NSError *refused) {
                              if (!isAllowed) {
                                  const std::string why = refused ? refused.localizedDescription.UTF8String : "its user turned them off";
                                  onMain(^{
                                    done("crossbind: macOS does not let the app show notifications: " + why);
                                  });
                                  return;
                              }
                              NSString *id = [@(NOTIFICATION_ID_PREFIX) stringByAppendingString:NSUUID.UUID.UUIDString];
                              UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:id content:content trigger:nil];
                              [center addNotificationRequest:request withCompletionHandler:^(NSError *failed) {
                                const Failure failure = failed ? Failure(std::string("crossbind: macOS did not show the notification: ") +
                                                                         failed.localizedDescription.UTF8String)
                                                               : Failure();
                                onMain(^{
                                  done(failure);
                                });
                              }];
                            }];
    });
}

}  // namespace crossbind::menu
