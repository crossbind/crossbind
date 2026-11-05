#import <Cocoa/Cocoa.h>

#include "clipboard.h"

namespace crossbind::clipboard {
namespace {

// The text whole, a null in it as well.
std::string utf8(NSString *text) {
    NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
    return data ? std::string(static_cast<const char *>(data.bytes), data.length) : std::string();
}

}  // namespace

void readText(Call call) {
    onMainThread([call] { call.resolve(utf8([NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString])); });
}

void writeText(Call call, std::string text) {
    onMainThread([call, text] {
        NSString *string = [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding];
        NSPasteboard *board = NSPasteboard.generalPasteboard;
        [board clearContents];
        if (string && [board setString:string forType:NSPasteboardTypeString]) {
            call.resolve();
        } else {
            call.reject("crossbind: the clipboard took no text");
        }
    });
}

}  // namespace crossbind::clipboard
