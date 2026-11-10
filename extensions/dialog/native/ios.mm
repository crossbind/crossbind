#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <objc/runtime.h>

#include "dialog.h"

#include <memory>
#include <stdexcept>

// A document picker's answer, given once. The picker holds it, so a picker that goes without its user's pick or cancel,
// as when its scene goes, answers as cancelled as it goes.
@interface CBPickAnswer : NSObject <UIDocumentPickerDelegate>
- (instancetype)initWithDone:(std::function<void(crossbind::dialog::Picked)>)done isFolder:(BOOL)isFolder;
- (void)give:(crossbind::dialog::Picked)picked;
@end

@implementation CBPickAnswer {
    std::function<void(crossbind::dialog::Picked)> done;
    BOOL isFolder;
}

- (instancetype)initWithDone:(std::function<void(crossbind::dialog::Picked)>)answer isFolder:(BOOL)folder {
    if ((self = [super init])) {
        done = std::move(answer);
        isFolder = folder;
    }
    return self;
}

- (void)give:(crossbind::dialog::Picked)picked {
    if (!done) return;
    const auto answer = std::move(done);
    done = nullptr;
    answer(std::move(picked));
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
    std::vector<std::string> paths;
    for (NSURL *url in urls) {
        // A folder stays where its user keeps it, which the app reaches while it runs.
        if (isFolder) [url startAccessingSecurityScopedResource];
        paths.push_back(url.path.UTF8String);
    }
    [self give:paths];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
    [self give:std::nullopt];
}

- (void)dealloc {
    [self give:std::nullopt];
}

@end

namespace crossbind::dialog {
namespace {

char ANSWER_KEY;

NSString *ns(const std::string &text) { return [NSString stringWithUTF8String:text.c_str()] ?: @""; }

void onMain(void (^block)(void)) { dispatch_async(dispatch_get_main_queue(), block); }

// The picker offers every filter's files at once; none at all, or "*", lets it offer any file.
NSArray<UTType *> *typesOf(const std::vector<FileFilter> &filters) {
    NSMutableArray<UTType *> *types = [NSMutableArray new];
    for (const auto &filter : filters) {
        for (const auto &extension : filter.extensions) {
            if (extension == "*") return @[ UTTypeItem ];
            if (UTType *type = [UTType typeWithFilenameExtension:ns(extension)]) [types addObject:type];
        }
    }
    return types.count > 0 ? types : @[ UTTypeItem ];
}

// A message dialog's answer, given once. UIKit can let an alert go without a click, as when its scene goes, and then
// the last of its actions to go answers it as closed.
struct MessageAnswer {
    std::function<void(int)> done;
    bool isGiven = false;

    void give(int button) {
        if (isGiven) return;
        isGiven = true;
        done(button);
    }
    ~MessageAnswer() { give(NO_BUTTON); }
};

// Over whatever the window of this id, or the app's oldest, shows on top; false when it has nothing to show it over.
bool presentOnTop(UIViewController *controller, uint64_t window) {
    const std::optional<Window> open = windowOf(window);
    UIViewController *top = ((__bridge UIWindow *)(open ? open->native() : appWindow())).rootViewController;
    while (top.presentedViewController) top = top.presentedViewController;
    if (!top || top.isBeingDismissed) return false;
    [top presentViewController:controller animated:YES completion:nil];
    return true;
}

}  // namespace

// The system's document picker, which has no title. The files it gives are copies in the app's temporary folder, which
// the system empties in time; a folder is its user's own, reached where it is.
void showOpenDialog(uint64_t window, OpenOptions options, std::function<void(Picked)> done) {
    onMain(^{
      NSArray<UTType *> *types = options.directory ? @[ UTTypeFolder ] : typesOf(options.filters);
      UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:types
                                                                                                        asCopy:!options.directory];
      picker.allowsMultipleSelection = options.multiple;
      if (!options.defaultPath.empty()) picker.directoryURL = [NSURL fileURLWithPath:ns(options.defaultPath)];
      CBPickAnswer *answer = [[CBPickAnswer alloc] initWithDone:done isFolder:options.directory];
      picker.delegate = answer;
      objc_setAssociatedObject(picker, &ANSWER_KEY, answer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      if (!presentOnTop(picker, window)) [answer give:std::nullopt];
    });
}

// A file the page makes reaches its user's folders as a download, which shows the system's export sheet.
void showSaveDialog(uint64_t, SaveOptions, std::function<void(std::optional<std::string>)>) {
    throw std::runtime_error("crossbind: an iOS app saves a file as the page's download, which shows the system's export sheet, not with dialog.save");
}

// The last of several buttons is the one a keyboard's Escape clicks, which iOS places where its apps put Cancel.
void showMessageDialog(uint64_t window, MessageOptions options, std::function<void(int)> done) {
    onMain(^{
      auto answer = std::make_shared<MessageAnswer>();
      answer->done = done;
      UIAlertController *alert = [UIAlertController alertControllerWithTitle:ns(options.message)
                                                                     message:options.detail.empty() ? nil : ns(options.detail)
                                                              preferredStyle:UIAlertControllerStyleAlert];
      const std::vector<std::string> labels = options.buttons.empty() ? std::vector<std::string>{"OK"} : options.buttons;
      for (size_t i = 0; i < labels.size(); i += 1) {
          const bool isCancel = labels.size() > 1 && i == labels.size() - 1;
          UIAlertAction *action = [UIAlertAction actionWithTitle:ns(labels[i])
                                                           style:isCancel ? UIAlertActionStyleCancel : UIAlertActionStyleDefault
                                                         handler:^(UIAlertAction *) { answer->give(static_cast<int>(i)); }];
          [alert addAction:action];
          if (i == 0) alert.preferredAction = action;
      }
      if (!presentOnTop(alert, window)) answer->give(NO_BUTTON);
    });
}

}  // namespace crossbind::dialog
