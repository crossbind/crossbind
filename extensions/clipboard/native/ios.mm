#import <UIKit/UIKit.h>

#include "clipboard.h"

namespace crossbind::clipboard {
namespace {

// The text whole, a null in it as well.
std::string utf8(NSString *text) {
    NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
    return data ? std::string(static_cast<const char *>(data.bytes), data.length) : std::string();
}

}  // namespace

// iOS asks its user first when the text is another app's.
void readText(Call call) {
    onMainThread([call] { call.resolve(utf8(UIPasteboard.generalPasteboard.string)); });
}

void writeText(Call call, std::string text) {
    onMainThread([call, text] {
        NSString *string = [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding];
        if (!string) {
            call.reject("crossbind: the clipboard took no text");
            return;
        }
        UIPasteboard.generalPasteboard.string = string;
        call.resolve();
    });
}

}  // namespace crossbind::clipboard
