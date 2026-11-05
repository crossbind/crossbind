#import <Cocoa/Cocoa.h>

#include "power.h"

#include "crossbind/app.h"

void crossbind::power::listen() {
    NSNotificationCenter *center = NSWorkspace.sharedWorkspace.notificationCenter;
    [center addObserverForName:NSWorkspaceWillSleepNotification
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification *) {
                      crossbind::app::emitEvent("suspend");
                    }];
    [center addObserverForName:NSWorkspaceDidWakeNotification
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification *) {
                      crossbind::app::emitEvent("resume");
                    }];
}
