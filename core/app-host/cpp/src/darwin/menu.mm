#import <Cocoa/Cocoa.h>

#include "crossbind_app.h"
#include "host_core.h"
#include "platform.h"

#include <cctype>
#include <map>
#include <stdexcept>

// What a click of one of the page's items does: it tells the page, after toggling the item when it has checked. A click
// of the tray's icon without a menu tells the page as well.
@interface CrossbindMenuTarget : NSObject
- (void)clicked:(NSMenuItem *)item;
- (void)trayClicked:(id)sender;
@end

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

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

NSMenuItem *item(NSString *title, SEL action, NSString *key, NSEventModifierFlags modifiers = NSEventModifierFlagCommand) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
    item.keyEquivalentModifierMask = modifiers;
    return item;
}

NSMenu *submenu(NSMenu *parent, NSString *title) {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
    NSMenuItem *holder = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
    holder.submenu = menu;
    [parent addItem:holder];
    return menu;
}

void addAppMenu(NSMenu *bar) {
    NSString *name = @(CROSSBIND_APP_NAME);
    NSMenu *app = submenu(bar, name);
    [app addItem:item([@"About " stringByAppendingString:name], @selector(orderFrontStandardAboutPanel:), @"")];
    [app addItem:NSMenuItem.separatorItem];
    NSApp.servicesMenu = submenu(app, @"Services");
    [app addItem:NSMenuItem.separatorItem];
    [app addItem:item([@"Hide " stringByAppendingString:name], @selector(hide:), @"h")];
    [app addItem:item(@"Hide Others", @selector(hideOtherApplications:), @"h", NSEventModifierFlagCommand | NSEventModifierFlagOption)];
    [app addItem:item(@"Show All", @selector(unhideAllApplications:), @"")];
    [app addItem:NSMenuItem.separatorItem];
    [app addItem:item([@"Quit " stringByAppendingString:name], @selector(terminate:), @"q")];
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
    if (role == "quit") return item([@"Quit " stringByAppendingString:@(CROSSBIND_APP_NAME)], @selector(terminate:), @"q");
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

// AppKit lists the app's windows below.
void addWindowItems(NSMenu *window) {
    [window addItem:roleItem("minimize")];
    [window addItem:item(@"Zoom", @selector(performZoom:), @"")];
    [window addItem:NSMenuItem.separatorItem];
    [window addItem:roleItem("close")];
    NSApp.windowsMenu = window;
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

}  // namespace

@implementation CrossbindMenuTarget

- (void)clicked:(NSMenuItem *)item {
    std::optional<bool> checked;
    if (item.tag & CHECKABLE) {
        item.state = item.state == NSControlStateValueOn ? NSControlStateValueOff : NSControlStateValueOn;
        checked = item.state == NSControlStateValueOn;
    }
    NSString *itemId = item.representedObject;
    if (onClick && itemId.length > 0) onClick(itemId.UTF8String, checked);
}

- (void)trayClicked:(id)sender {
    crossbind::app::postEvent("tray", "null");
}

// AppKit enables an item whose target takes its action, unless the item says otherwise.
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    return !(item.tag & DISABLED);
}

@end

// The menus of a Mac app made from Xcode's template, without its File and Help menus, which the page would fill.
void installAppMenu() {
    NSMenu *bar = [NSMenu new];
    addAppMenu(bar);
    addEditItems(submenu(bar, @"Edit"));
    NSMenu *view = submenu(bar, @"View");
    [view addItem:item(@"Enter Full Screen", @selector(toggleFullScreen:), @"f", NSEventModifierFlagCommand | NSEventModifierFlagControl)];
    // The app has one window, so AppKit adds no tab items to these menus.
    NSWindow.allowsAutomaticWindowTabbing = NO;
    addWindowItems(submenu(bar, @"Window"));
    NSApp.mainMenu = bar;
}

// The page's menus follow the app menu, which the app keeps.
void setMenu(std::vector<MenuItem> menus, MenuClicked clicked, std::function<void(Failure)> done) {
    dispatch_async(dispatch_get_main_queue(), ^{
      NSMenu *windows = NSApp.windowsMenu;
      NSMenu *services = NSApp.servicesMenu;
      try {
          if (!target) target = [CrossbindMenuTarget new];
          // windowMenu sets it again.
          NSApp.windowsMenu = nil;
          NSMenu *bar = [NSMenu new];
          addAppMenu(bar);
          for (const auto &menu : menus) [bar addItem:itemOf(menu)];
          onClick = clicked;
          NSApp.mainMenu = bar;
          done(std::nullopt);
      } catch (const std::exception &error) {
          NSApp.windowsMenu = windows;
          NSApp.servicesMenu = services;
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
