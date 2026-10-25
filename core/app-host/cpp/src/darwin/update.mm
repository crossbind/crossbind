#import <Foundation/Foundation.h>
#import <Security/Security.h>

#include "platform.h"

#include <stdexcept>

namespace {

// How often the wait looks at what the download has received.
constexpr int64_t CHECK_NSEC = NSEC_PER_SEC / 4;

std::string describe(OSStatus status) {
    NSString *message = CFBridgingRelease(SecCopyErrorMessageString(status, nullptr));
    return message ? std::string(message.UTF8String) : "error " + std::to_string(status);
}

}  // namespace

// As Sparkle holds an update: the app it unpacked to meets the requirement this app's own signature states, which for a
// Developer ID names the app's identifier and its team. An ad hoc signature names no signer to hold it to.
void checkSigner(const std::filesystem::path &update) {
    @autoreleasepool {
        SecCodeRef running = nullptr;
        if (SecCodeCopySelf(kSecCSDefaultFlags, &running) != errSecSuccess) return;
        CFDictionaryRef signing = nullptr;
        const bool hasSigner = SecCodeCopySigningInformation(running, kSecCSSigningInformation, &signing) == errSecSuccess &&
                               CFDictionaryGetValue(signing, kSecCodeInfoCertificates) != nullptr;
        if (signing) CFRelease(signing);
        SecRequirementRef requirement = nullptr;
        OSStatus status = hasSigner ? SecCodeCopyDesignatedRequirement(running, kSecCSDefaultFlags, &requirement) : errSecSuccess;
        CFRelease(running);
        if (!hasSigner) return;
        SecStaticCodeRef code = nullptr;
        if (status == errSecSuccess) {
            NSURL *app = [NSURL fileURLWithPath:@(update.c_str()) isDirectory:YES];
            status = SecStaticCodeCreateWithPath((__bridge CFURLRef)app, kSecCSDefaultFlags, &code);
        }
        if (status == errSecSuccess) {
            status = SecStaticCodeCheckValidity(code, kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate, requirement);
        }
        if (code) CFRelease(code);
        if (requirement) CFRelease(requirement);
        if (status != errSecSuccess) {
            throw std::runtime_error("crossbind: cannot install the update: " + update.filename().string() + " is not signed as this app is: " +
                                     describe(status));
        }
    }
}

// A session that keeps nothing, so that every check asks the server anew.
void download(const std::string &url, const std::filesystem::path &file, std::uintmax_t maxBytes) {
    @autoreleasepool {
        NSString *address = [NSString stringWithUTF8String:url.c_str()];
        NSURL *source = address ? [NSURL URLWithString:address] : nil;
        if (!source) throw std::runtime_error("crossbind: " + url + " is no address");
        NSString *path = [NSString stringWithUTF8String:file.c_str()];
        if (!path) throw std::runtime_error("crossbind: cannot download to " + file.string());
        NSURL *target = [NSURL fileURLWithPath:path];
        NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration];
        dispatch_semaphore_t finished = dispatch_semaphore_create(0);
        __block std::string failure;
        NSURLSessionDownloadTask *task = [session downloadTaskWithURL:source
                                                    completionHandler:^(NSURL *location, NSURLResponse *response, NSError *error) {
                                                      const NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class]
                                                                                   ? ((NSHTTPURLResponse *)response).statusCode
                                                                                   : 0;
                                                      NSError *moved = nil;
                                                      if (error) {
                                                          failure = "crossbind: cannot download " + url + ": " +
                                                                    (error.localizedDescription.UTF8String ?: "no reason given");
                                                      } else if (status != 200) {
                                                          failure = "crossbind: " + url + " answered " + std::to_string(status);
                                                      } else {
                                                          // The task deletes its file once this returns.
                                                          [NSFileManager.defaultManager removeItemAtURL:target error:nil];
                                                          if (![NSFileManager.defaultManager moveItemAtURL:location toURL:target error:&moved]) {
                                                              failure = "crossbind: cannot keep the download of " + url + ": " +
                                                                        (moved.localizedDescription.UTF8String ?: "no reason given");
                                                          }
                                                      }
                                                      dispatch_semaphore_signal(finished);
                                                    }];
        [task resume];
        const auto isTooLarge = [&] { return static_cast<std::uintmax_t>(task.countOfBytesReceived) > maxBytes; };
        while (dispatch_semaphore_wait(finished, dispatch_time(DISPATCH_TIME_NOW, CHECK_NSEC)) != 0) {
            if (isTooLarge()) [task cancel];
        }
        [session finishTasksAndInvalidate];
        if (isTooLarge()) throw std::runtime_error("crossbind: " + url + " answered more than " + std::to_string(maxBytes) + " bytes");
        if (!failure.empty()) throw std::runtime_error(failure);
    }
}
