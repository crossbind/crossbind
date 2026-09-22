#import "CrossbindModule.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#import <RNCrossbindSpec/RNCrossbindSpec.h>
#include <jsi/jsi.h>

namespace emscripten {
namespace internal {
__attribute__((used)) void _embind_initialize_bindings(facebook::jsi::Runtime& rt, std::string path);
}
}

using namespace facebook;

@interface CrossbindModule () <NativeRNJsiLibSpec, RCTTurboModuleWithJSIBindings>
@end

@implementation CrossbindModule

RCT_EXPORT_MODULE(RNJsiLib)

- (std::shared_ptr<react::TurboModule>)getTurboModule:(const react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<react::NativeRNJsiLibSpecJSI>(params);
}

// React Native calls this once per module instance, on the JS thread, before JS
// can reach the module. Registering the embind bindings a second time aborts
// with "Cannot register public name ... twice", so the one-shot contract has to
// live here rather than in start:.
- (void)installJSIBindingsWithRuntime:(jsi::Runtime &)runtime
                          callInvoker:(const std::shared_ptr<react::CallInvoker> &)callInvoker
{
    NSString *bundlePath = [[NSBundle mainBundle] bundlePath];
    emscripten::internal::_embind_initialize_bindings(runtime, std::string([bundlePath UTF8String]));
}

- (void)start:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    resolve(@YES);
}

@end
