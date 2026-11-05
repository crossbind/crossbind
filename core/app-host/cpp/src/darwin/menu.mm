#import <Cocoa/Cocoa.h>

#include "crossbind_app.h"
#include "platform.h"

#include <stdexcept>

namespace {

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

}  // namespace

// The menus of a Mac app made from Xcode's template, without its File and Help menus, which the page would fill. The
// host's menu extension puts the page's menus after the app menu.
void installAppMenu() {
    NSMenu *bar = [NSMenu new];
    addAppMenu(bar);
    addEditItems(submenu(bar, @"Edit"));
    NSMenu *view = submenu(bar, @"View");
    [view addItem:item(@"Enter Full Screen", @selector(toggleFullScreen:), @"f", NSEventModifierFlagCommand | NSEventModifierFlagControl)];
    // An app's windows stay apart, not as tabs, so AppKit adds no tab items to these menus.
    NSWindow.allowsAutomaticWindowTabbing = NO;
    addWindowItems(submenu(bar, @"Window"));
    NSApp.mainMenu = bar;
}
