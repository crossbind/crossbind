// Node-API host for the embind runtime in @crossbind/core-embind-jsi. The environment whose start()
// runs first gets a JSI runtime; embind-jsi keeps one current runtime per process, so until runtimes
// are kept per environment a second one (a worker thread) is refused rather than left to race it.
#include <node_api.h>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

#include <atomic>
#include <cstring>
#include <memory>
#include <string>

#include <ApiLoaders/JSRuntimeApi.h>
#include <NodeApiJsiRuntime.h>
#include <emscripten/bind.h>

namespace {

using Microsoft::NodeApiJsi::FuncPtr;
using Microsoft::NodeApiJsi::IFuncResolver;
using Microsoft::NodeApiJsi::JSRuntimeApi;

// node-api-jsi reaches Node-API through a function table; each entry points at the symbol this
// addon already imports from the host process. On Windows the entries are looked up in the
// executable instead: node.exe and Electron both export Node-API, so the addon imports nothing from
// either and needs no import library. jsr_* engine extensions stay null on purpose: JSRuntimeApi
// falls back to its defaults for them.
struct ProcessResolver : IFuncResolver {
    FuncPtr getFuncPtr(const char *funcName) override {
#ifdef _WIN32
        return reinterpret_cast<FuncPtr>(GetProcAddress(GetModuleHandleW(nullptr), funcName));
#else
#define NODE_API_FUNC(func) \
    if (std::strcmp(funcName, #func) == 0) return reinterpret_cast<FuncPtr>(&func);
#include <ApiLoaders/NodeApi.inc>
        return nullptr;
#endif
    }
};

// The Node-API calls this file makes itself resolve the same way. They look the function up on each
// call rather than through a JSRuntimeApi, whose entries resolve against the current runtime's table,
// and there is none while the module initializes.
ProcessResolver processResolver;
#define NODE_API(func) reinterpret_cast<decltype(&::func)>(processResolver.getFuncPtr(#func))

struct EnvState {
    napi_env env = nullptr;
    ProcessResolver resolver;
    JSRuntimeApi api{&resolver};
    std::unique_ptr<facebook::jsi::Runtime> runtime;
};

std::atomic<napi_env> owner{nullptr};

// Native values can outlive the runtime they point into (thread-local ones are destroyed inside
// exit()); with no current runtime their release becomes a no-op instead of a call into a dead one.
void forgetRuntime(EnvState *state) {
    if (state == nullptr) {
        return;
    }
    if (emscripten::jsRuntime == state->runtime.get()) {
        emscripten::jsRuntime = nullptr;
    }
    napi_env finished = state->env;
    owner.compare_exchange_strong(finished, nullptr);
}

std::string readString(napi_env env, napi_value value) {
    size_t length = 0;
    NODE_API(napi_get_value_string_utf8)(env, value, nullptr, 0, &length);
    std::string result(length, '\0');
    NODE_API(napi_get_value_string_utf8)(env, value, result.data(), length + 1, &length);
    return result;
}

// start(dataPath, scope) registers every EMSCRIPTEN_BINDINGS block of the addon into this
// environment's embind runtime, so embind.js must already be loaded. scope is the object that
// runtime keeps its state on, which this addon's global() returns. A second call in the same
// environment is a no-op: registering twice fails with "Cannot register public name ... twice".
napi_value Start(napi_env env, napi_callback_info info) {
    void *existing = nullptr;
    NODE_API(napi_get_instance_data)(env, &existing);
    if (existing != nullptr) {
        return nullptr;
    }
    // The same environment may retry after a start that failed before it took ownership.
    napi_env current = nullptr;
    if (!owner.compare_exchange_strong(current, env) && current != env) {
        NODE_API(napi_throw_error)(env, nullptr,
            "crossbind: the native addon already runs in another Node environment; "
            "worker_threads are not supported yet");
        return nullptr;
    }

    size_t argc = 2;
    napi_value argv[2];
    NODE_API(napi_get_cb_info)(env, info, &argc, argv, nullptr, nullptr);
    const std::string dataPath = argc > 0 ? readString(env, argv[0]) : std::string();
    napi_valuetype scopeType = napi_undefined;
    if (argc > 1) NODE_API(napi_typeof)(env, argv[1], &scopeType);
    napi_value scope = scopeType == napi_object ? argv[1] : nullptr;

    // An exception must not unwind through Node-API, which would end the process.
    try {
        auto state = std::make_unique<EnvState>();
        state->env = env;
        JSRuntimeApi::setCurrent(&state->api);
        state->runtime = Microsoft::NodeApiJsi::makeNodeApiJsiRuntime(env, &state->api, [] {}, scope);
        // The environment owns it before any binding registers: registered functions point into it,
        // so it has to outlive a registration that fails halfway.
        EnvState *owned = state.release();
        NODE_API(napi_set_instance_data)(
            env, owned,
            [](napi_env, void *data, void *) {
                auto *finished = static_cast<EnvState *>(data);
                forgetRuntime(finished);
                delete finished;
            },
            nullptr);
        emscripten::internal::_embind_initialize_bindings(*owned->runtime, dataPath);
    } catch (const std::exception &error) {
        NODE_API(napi_throw_error)(env, nullptr, error.what());
    } catch (...) {
        NODE_API(napi_throw_error)(env, nullptr, "crossbind: the native module failed to start");
    }
    return nullptr;
}

// stop() runs from the environment's 'exit' event: no JS runs here afterwards, and process.exit()
// skips the teardown that would otherwise release the instance data.
napi_value Stop(napi_env env, napi_callback_info) {
    void *data = nullptr;
    NODE_API(napi_get_instance_data)(env, &data);
    forgetRuntime(static_cast<EnvState *>(data));
    return nullptr;
}

}  // namespace

NAPI_MODULE_INIT() {
    napi_value start;
    NODE_API(napi_create_function)(env, "start", NAPI_AUTO_LENGTH, Start, nullptr, &start);
    NODE_API(napi_set_named_property)(env, exports, "start", start);
    napi_value stop;
    NODE_API(napi_create_function)(env, "stop", NAPI_AUTO_LENGTH, Stop, nullptr, &stop);
    NODE_API(napi_set_named_property)(env, exports, "stop", stop);
    return exports;
}
