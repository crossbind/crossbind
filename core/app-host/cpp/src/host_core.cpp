#include "host_core.h"

#include <emscripten/bind.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <future>
#include <random>
#include <sstream>

namespace crossbind::app {

namespace {

class VectorBuffer : public jsi::MutableBuffer {
public:
    explicit VectorBuffer(std::vector<uint8_t> bytes) : bytes_(std::move(bytes)) {}
    size_t size() const override { return bytes_.size(); }
    uint8_t *data() override { return bytes_.data(); }

private:
    std::vector<uint8_t> bytes_;
};

constexpr char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

}  // namespace

std::string toBase64(const uint8_t *bytes, size_t length) {
    std::string out;
    out.reserve((length + 2) / 3 * 4);
    size_t i = 0;
    for (; i + 2 < length; i += 3) {
        const uint32_t n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[n >> 18];
        out += B64[(n >> 12) & 63];
        out += B64[(n >> 6) & 63];
        out += B64[n & 63];
    }
    if (i < length) {
        const uint32_t n = (bytes[i] << 16) | ((i + 1 < length ? bytes[i + 1] : 0) << 8);
        out += B64[n >> 18];
        out += B64[(n >> 12) & 63];
        out += i + 1 < length ? B64[(n >> 6) & 63] : '=';
        out += '=';
    }
    return out;
}

std::vector<uint8_t> fromBase64(const std::string &text) {
    static const auto index = [] {
        std::array<uint8_t, 256> table{};
        for (uint8_t i = 0; i < 64; i += 1) table[static_cast<uint8_t>(B64[i])] = i;
        return table;
    }();
    const size_t padding = text.size() >= 2 && text[text.size() - 1] == '=' ? (text[text.size() - 2] == '=' ? 2 : 1) : 0;
    std::vector<uint8_t> bytes(text.size() / 4 * 3 - padding);
    size_t o = 0;
    for (size_t i = 0; i + 3 < text.size(); i += 4) {
        const uint32_t n = (index[static_cast<uint8_t>(text[i])] << 18) | (index[static_cast<uint8_t>(text[i + 1])] << 12)
            | (index[static_cast<uint8_t>(text[i + 2])] << 6) | index[static_cast<uint8_t>(text[i + 3])];
        if (o < bytes.size()) bytes[o++] = n >> 16;
        if (o < bytes.size()) bytes[o++] = (n >> 8) & 255;
        if (o < bytes.size()) bytes[o++] = n & 255;
    }
    return bytes;
}

namespace {

std::vector<uint8_t> bytesOf(const std::string &text) { return std::vector<uint8_t>(text.begin(), text.end()); }

// The app's one module, which the app's native code emits events through from any thread, and the events sent before it
// started, as from an extension's onStart, which it gets first as it starts, in their order.
std::atomic<Core *> running{nullptr};
struct EarlyEvent {
    std::string event;
    std::string json;
    bool isHeld;
};
std::mutex earlyMutex;
std::vector<EarlyEvent> earlyEvents;

// 128 random bits, as hex.
std::string randomToken() {
    std::random_device random;
    char token[33];
    std::snprintf(token, sizeof token, "%08x%08x%08x%08x", random(), random(), random(), random());
    return token;
}

void setFunction(jsi::Runtime &rt, const char *name, unsigned params, jsi::HostFunctionType fn) {
    rt.global().setProperty(rt, name, jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), params, std::move(fn)));
}

// The page's requests for bytes, each answered by a function of the host bundle: a message with its attachments in the
// request body, and a large result read after its reply.
const std::map<std::string, std::string> ROUTES{
    {"/b/frame", "__crossbind_frame"},
    {"/b/result", "__crossbind_result"},
};

const std::map<std::string, std::string> MIME_TYPES{
    {"html", "text/html; charset=utf-8"},
    {"js", "text/javascript; charset=utf-8"},
    {"mjs", "text/javascript; charset=utf-8"},
    {"css", "text/css; charset=utf-8"},
    {"json", "application/json"},
    {"map", "application/json"},
    {"txt", "text/plain; charset=utf-8"},
    {"svg", "image/svg+xml"},
    {"png", "image/png"},
    {"jpg", "image/jpeg"},
    {"jpeg", "image/jpeg"},
    {"gif", "image/gif"},
    {"webp", "image/webp"},
    {"ico", "image/x-icon"},
    {"wasm", "application/wasm"},
    {"woff", "font/woff"},
    {"woff2", "font/woff2"},
    {"ttf", "font/ttf"},
    {"otf", "font/otf"},
    {"avif", "image/avif"},
    {"bmp", "image/bmp"},
    {"mp4", "video/mp4"},
    {"m4v", "video/mp4"},
    {"mov", "video/quicktime"},
    {"webm", "video/webm"},
    {"ogv", "video/ogg"},
    {"mp3", "audio/mpeg"},
    {"m4a", "audio/mp4"},
    {"aac", "audio/aac"},
    {"wav", "audio/wav"},
    {"ogg", "audio/ogg"},
    {"oga", "audio/ogg"},
    {"opus", "audio/ogg"},
    {"flac", "audio/flac"},
    {"vtt", "text/vtt; charset=utf-8"},
    {"csv", "text/csv; charset=utf-8"},
    {"xml", "application/xml"},
    {"pdf", "application/pdf"},
    {"zip", "application/zip"},
};

// A Value as the module's JavaScript holds it, its bytes a Uint8Array.
jsi::Value jsiOf(jsi::Runtime &rt, const Value &value) {
    if (value.isNull()) return jsi::Value::null();
    if (value.isBool()) return jsi::Value(value.asBool());
    if (value.isNumber()) return jsi::Value(value.asNumber());
    if (value.isString()) return jsi::Value(rt, jsi::String::createFromUtf8(rt, validUtf8(value.asString())));
    if (value.isBytes()) {
        jsi::ArrayBuffer buffer(rt, std::make_shared<VectorBuffer>(value.asBytes()));
        return rt.global().getPropertyAsFunction(rt, "Uint8Array").callAsConstructor(rt, std::move(buffer));
    }
    if (value.isArray()) {
        const Value::Array &items = value.asArray();
        jsi::Array array(rt, items.size());
        for (size_t i = 0; i < items.size(); i += 1) array.setValueAtIndex(rt, i, jsiOf(rt, items[i]));
        return jsi::Value(rt, array);
    }
    jsi::Object object(rt);
    for (const auto &[name, member] : value.asObject()) object.setProperty(rt, jsi::PropNameID::forUtf8(rt, validUtf8(name)), jsiOf(rt, member));
    return jsi::Value(rt, object);
}

// A path as a URL has it, its %XX escapes undone, as a URL's parser does, which leaves a "%" before anything else as it
// is: none for a NUL, which no file's name holds.
std::optional<std::string> decodedPath(const std::string &path) {
    std::string decoded;
    decoded.reserve(path.size());
    for (size_t i = 0; i < path.size(); i += 1) {
        if (path[i] != '%' || i + 2 >= path.size() || !std::isxdigit(static_cast<unsigned char>(path[i + 1]))
            || !std::isxdigit(static_cast<unsigned char>(path[i + 2]))) {
            decoded += path[i];
            continue;
        }
        const char byte = static_cast<char>(std::stoi(path.substr(i + 1, 2), nullptr, 16));
        if (byte == '\0') return std::nullopt;
        decoded += byte;
        i += 2;
    }
    return decoded;
}

std::string abortReply(const std::string &name) { return errorReply("crossbind: " + name + " was cancelled", "AbortError"); }

// A failed call's reply with how many of its messages went before it.
std::string countedReply(std::string reply, double sent) {
    reply.insert(reply.size() - 1, "," + std::to_string(static_cast<long long>(sent)));
    return reply;
}

SchemeResponse binaryCall(jsi::Runtime &rt, const std::string &function, SchemeRequest &request) {
    jsi::ArrayBuffer body(rt, std::make_shared<VectorBuffer>(std::move(request.body)));
    auto reply = rt.global().getPropertyAsFunction(rt, function.c_str()).call(rt, jsi::String::createFromUtf8(rt, request.query), std::move(body));
    if (reply.isString()) return SchemeResponse{200, "application/json", bytesOf(reply.asString(rt).utf8(rt))};
    auto view = reply.asObject(rt);
    auto buffer = view.getProperty(rt, "buffer").asObject(rt).getArrayBuffer(rt);
    const auto offset = static_cast<size_t>(view.getProperty(rt, "byteOffset").asNumber());
    const auto length = static_cast<size_t>(view.getProperty(rt, "byteLength").asNumber());
    const uint8_t *data = buffer.data(rt) + offset;
    return SchemeResponse{200, "application/octet-stream", std::vector<uint8_t>(data, data + length)};
}

// A file of the page: a directory names its index.html, and no path leaves the page's directory.
SchemeResponse pageFile(const std::string &pageDir, const std::string &path) {
    if (path.find("..") != std::string::npos) return SchemeResponse{404, "text/plain", {}};
    std::filesystem::path file = pageDir + path;
    std::error_code error;
    if (std::filesystem::is_directory(file, error)) file /= "index.html";
    // A device, such as Windows' CON, or a pipe would hold the read up.
    if (!std::filesystem::is_regular_file(file, error)) return SchemeResponse{404, "text/plain", {}};
    std::ifstream stream(file, std::ios::binary);
    if (!stream) return SchemeResponse{404, "text/plain", {}};
    std::ostringstream content;
    content << stream.rdbuf();
    return SchemeResponse{200, mimeTypeOf(file), bytesOf(content.str())};
}

}  // namespace

std::string mimeTypeOf(const std::filesystem::path &file) {
    std::string extension = file.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const auto mime = extension.empty() ? MIME_TYPES.end() : MIME_TYPES.find(extension.substr(1));
    return mime == MIME_TYPES.end() ? "application/octet-stream" : mime->second;
}

std::string errorReply(const std::string &message, const std::string &name) {
    const auto escaped = [](const std::string &text) {
        std::string out;
        for (const char c : validUtf8(text)) {
            if (static_cast<unsigned char>(c) < 0x20) {
                out += ' ';
                continue;
            }
            if (c == '"' || c == '\\') out += '\\';
            out += c;
        }
        return out;
    };
    return "[1,{\"name\":\"" + escaped(name) + "\",\"message\":\"" + escaped(message) + "\"}]";
}

std::string readFile(const std::string &path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("cannot read " + path);
    std::ostringstream text;
    text << file.rdbuf();
    return text.str();
}

void JsThread::start(Task boot) {
    thread_ = std::thread([this, boot = std::move(boot)] { loop(boot); });
}

void JsThread::post(Task task) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        tasks_.push_back(std::move(task));
    }
    wake_.notify_one();
}

void JsThread::postAfter(double ms, Task task) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        timers_.emplace(Clock::now() + std::chrono::microseconds(static_cast<long long>(ms * 1000)), std::move(task));
    }
    wake_.notify_one();
}

void JsThread::stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    wake_.notify_one();
    if (thread_.joinable()) thread_.join();
}

JsThread::Task JsThread::next() {
    std::unique_lock<std::mutex> lock(mutex_);
    for (;;) {
        if (!tasks_.empty()) {
            Task task = std::move(tasks_.front());
            tasks_.pop_front();
            return task;
        }
        if (!timers_.empty() && timers_.begin()->first <= Clock::now()) {
            Task task = std::move(timers_.begin()->second);
            timers_.erase(timers_.begin());
            return task;
        }
        if (stopping_) return nullptr;
        if (timers_.empty()) {
            wake_.wait(lock);
        } else {
            wake_.wait_until(lock, timers_.begin()->first);
        }
    }
}

void JsThread::loop(const Task &boot) {
    auto config = ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).withES6BlockScoping(true).build();
    runtime_ = facebook::hermes::makeHermesRuntime(config);
    run(boot);
    while (Task task = next()) run(task);
}

void JsThread::postOrRun(Task task) {
    if (std::this_thread::get_id() != thread_.get_id()) {
        post(std::move(task));
        return;
    }
    run(task, false);
}

void JsThread::run(const Task &task, bool drains) {
    try {
        task(*runtime_);
        while (drains && !runtime_->drainMicrotasks()) {
        }
    } catch (const jsi::JSError &error) {
        std::fprintf(stderr, "crossbind: %s\n%s\n", error.getMessage().c_str(), error.getStack().c_str());
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: %s\n", error.what());
    }
}

void Core::installHostFunctions(jsi::Runtime &rt) {
    setFunction(rt, "__host_log", 2, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
        const std::string level = args[0].asString(rt).utf8(rt);
        std::FILE *out = level == "warn" || level == "error" ? stderr : stdout;
        std::fprintf(out, "%s\n", args[1].asString(rt).utf8(rt).c_str());
        std::fflush(out);
        return jsi::Value::undefined();
    });
    setFunction(rt, "__host_timer", 2, [this](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
        const double id = args[0].asNumber();
        js_.postAfter(args[1].asNumber(), [id](jsi::Runtime &rt) {
            rt.global().getPropertyAsFunction(rt, "__host_timer_fire").call(rt, id);
        });
        return jsi::Value::undefined();
    });
    setFunction(rt, "__host_b64encode", 3, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
        const auto buffer = args[0].asObject(rt).getArrayBuffer(rt);
        const auto offset = static_cast<size_t>(args[1].asNumber());
        const auto length = static_cast<size_t>(args[2].asNumber());
        return jsi::Value(rt, jsi::String::createFromAscii(rt, toBase64(buffer.data(rt) + offset, length)));
    });
    setFunction(rt, "__host_b64decode", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
        auto bytes = fromBase64(args[0].asString(rt).utf8(rt));
        return jsi::Value(rt, jsi::ArrayBuffer(rt, std::make_shared<VectorBuffer>(std::move(bytes))));
    });
    setFunction(rt, "__host_page_function", 1, [this](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
        return pageFunction(rt, static_cast<long long>(args[0].asNumber()));
    });
    // A call of the page to one of the app's functions: its reply's call, the function's name, its options, the page's id
    // of it and whether the page takes its messages.
    setFunction(rt, "__app_call", 5, [this](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
        std::string call = args[0].asString(rt).utf8(rt);
        if (replies_.count(call) > 0) {
            callApp(rt, std::move(call), args[1].asString(rt).utf8(rt), args[2], static_cast<long long>(args[3].asNumber()),
                args[4].isBool() && args[4].getBool());
        }
        return jsi::Value::undefined();
    });
    setFunction(rt, "__app_cancel", 2, [this](jsi::Runtime &, const jsi::Value &, const jsi::Value *args, size_t) {
        cancelCall(static_cast<long long>(args[0].asNumber()), args[1].isBool() && args[1].getBool());
        return jsi::Value::undefined();
    });
    setFunction(rt, "__host_reply", 2, [this](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) {
        reply(args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt));
        return jsi::Value::undefined();
    });
}

void Core::reply(const std::string &call, const std::string &text) {
    const auto pending = replies_.find(call);
    if (pending == replies_.end()) return;
    const ReplyFn reply = std::move(pending->second);
    replies_.erase(pending);
    reply(text);
}

void Core::callApp(jsi::Runtime &rt, std::string call, const std::string &name, const jsi::Value &options, long long id, bool wantsMessages) {
    const long long page = page_;
    PageCall answers;
    // The JS thread encodes the result as the page decodes it, after the messages before it have joined the pushes. A
    // failure tells their count too, as the page takes them before it.
    answers.answer = [this, call, page, id](Failure failure, Value result, double sent) {
        js_.post([this, call, page, id, failure = std::move(failure), result = std::move(result), sent](jsi::Runtime &rt) {
            if (page != page_) {
                reply(call, errorReply("crossbind: the page that made the call went away"));
                return;
            }
            openCalls_.erase(id);
            if (failure) {
                reply(call, countedReply(errorReply(*failure), sent));
                return;
            }
            try {
                rt.global().getPropertyAsFunction(rt, "__crossbind_answered").call(rt, jsi::String::createFromUtf8(rt, call), jsiOf(rt, result), sent);
            } catch (const std::exception &error) {
                reply(call, countedReply(errorReply(error.what()), sent));
            }
        });
    };
    if (wantsMessages) {
        // A message the page cannot be given still counts, as null.
        answers.message = [this, page, id](Value message) {
            js_.post([this, page, id, message = std::move(message)](jsi::Runtime &rt) {
                if (page != page_) return;
                const jsi::Function deliver = rt.global().getPropertyAsFunction(rt, "__crossbind_message");
                try {
                    deliver.call(rt, static_cast<double>(id), jsiOf(rt, message));
                } catch (const std::exception &error) {
                    std::fprintf(stderr, "crossbind: a message of the call %lld reached the page as null: %s\n", id, error.what());
                    deliver.call(rt, static_cast<double>(id), jsi::Value::null());
                }
            });
        };
    }
    answers.page = static_cast<uint64_t>(page);
    answers.window = window_;
    std::shared_ptr<StateOf<Call>> state = pageCall(rt, name, options, std::move(answers));
    if (!state) return;
    if (cancelledEarly_.erase(id) > 0) {
        if (app::cancelCall(state)) reply(call, abortReply(name));
        return;
    }
    openCalls_.insert_or_assign(id, OpenCall{state, std::move(call), name});
    runCall(std::move(state));
}

// Far more than a page cancels of calls still on their way.
constexpr size_t MAX_EARLY_CANCELS = 1000;

void Core::cancelCall(long long id, bool isFramed) {
    const auto open = openCalls_.find(id);
    if (open == openCalls_.end()) {
        // A call that came as a message came before its cancel, which the page sends no more once it has its answer.
        if (isFramed && cancelledEarly_.size() < MAX_EARLY_CANCELS) cancelledEarly_.insert(id);
        return;
    }
    const OpenCall call = std::move(open->second);
    openCalls_.erase(open);
    const std::shared_ptr<StateOf<Call>> state = call.state.lock();
    if (state && app::cancelCall(state)) reply(call.reply, abortReply(call.name));
}

std::string Core::boot(std::string bundle, const std::string &sourceUrl, const std::string &dataPath) {
    token_ = randomToken();
    std::promise<std::string> booted;
    js_.start([&](jsi::Runtime &rt) {
        try {
            installHostFunctions(rt);
            rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(std::move(bundle)), sourceUrl);
            emscripten::internal::_embind_initialize_bindings(rt, dataPath);
            rt.global().getPropertyAsFunction(rt, "__crossbind_start").call(rt);
            // The main thread waits for this boot, so it answers the module's waits from now on alone.
            answerWaits(true);
            booted.set_value("");
        } catch (const jsi::JSError &error) {
            booted.set_value(error.getMessage() + "\n" + error.getStack());
        } catch (const std::exception &error) {
            booted.set_value(error.what());
        }
    });
    const std::string error = booted.get_future().get();
    // The app's native code reaches the page through the module once it has started, and its thread is known: what it
    // sent before goes first.
    if (error.empty()) {
        std::lock_guard<std::mutex> lock(earlyMutex);
        for (auto &early : earlyEvents) postEvent(std::move(early.event), std::move(early.json), early.isHeld);
        earlyEvents.clear();
        running = this;
    }
    return error;
}

void Core::receive(std::string message, ReplyFn reply) {
    if (message.compare(0, token_.size(), token_) != 0) {
        reply(errorReply("crossbind: this message does not carry the page's token"));
        return;
    }
    message.erase(0, token_.size());
    js_.post([this, message = std::move(message), reply = std::move(reply)](jsi::Runtime &rt) {
        const std::string call = std::to_string(nextReply_++);
        replies_.emplace(call, reply);
        try {
            rt.global().getPropertyAsFunction(rt, "__crossbind_receive")
                .call(rt, jsi::String::createFromUtf8(rt, call), jsi::String::createFromUtf8(rt, message));
        } catch (const std::exception &error) {
            replies_.erase(call);
            reply(errorReply(error.what()));
        }
    });
}

void Core::serve(SchemeRequest request, SchemeRespond answer) {
    SchemeRespond respond = !corsOrigin.empty() ? SchemeRespond([answer = std::move(answer), origin = corsOrigin](SchemeResponse response) {
        response.headers.emplace_back("Access-Control-Allow-Origin", origin);
        response.headers.emplace_back("Access-Control-Expose-Headers", "*");
        answer(std::move(response));
    })
                                                : std::move(answer);
    // A dev server's page asks first for a request with headers of its own, as a route's Range is in some webviews.
    if (!corsOrigin.empty() && request.method == "OPTIONS") {
        SchemeResponse allowed{204, "text/plain", {}};
        allowed.headers.emplace_back("Access-Control-Allow-Methods", "GET, HEAD, POST");
        allowed.headers.emplace_back("Access-Control-Allow-Headers", "*");
        respond(std::move(allowed));
        return;
    }
    // Every platform gives the path as the URL has it, which is decoded here alone.
    std::optional<std::string> path = decodedPath(request.path);
    if (!path) {
        respond(SchemeResponse{400, "text/plain", bytesOf("crossbind: the request's path holds a NUL")});
        return;
    }
    request.path = std::move(*path);
    if (request.path.compare(0, 5, "/ext/") == 0) {
        serveRoute(std::move(request), std::move(respond));
        return;
    }
    const auto route = ROUTES.find(request.path);
    if (route == ROUTES.end()) {
        respond(pageFile(pageDir_, request.path));
        return;
    }
    if (("&" + request.query + "&").find("&t=" + token_ + "&") == std::string::npos) {
        respond(SchemeResponse{403, "text/plain", bytesOf("crossbind: this request does not carry the page's token")});
        return;
    }
    if (request.path == "/b/frame") {
        serveFrame(std::move(request), std::move(respond));
        return;
    }
    js_.post([function = route->second, request = std::move(request), respond = std::move(respond)](jsi::Runtime &rt) mutable {
        try {
            respond(binaryCall(rt, function, request));
        } catch (const std::exception &error) {
            respond(SchemeResponse{500, "text/plain", bytesOf(error.what())});
        }
    });
}

// A frame answers once its message has, which a call of the app's functions does later.
void Core::serveFrame(SchemeRequest request, SchemeRespond respond) {
    js_.post([this, request = std::move(request), respond = std::move(respond)](jsi::Runtime &rt) mutable {
        const std::string call = std::to_string(nextReply_++);
        replies_.emplace(call, [respond](const std::string &text) { respond(SchemeResponse{200, "application/json", bytesOf(text)}); });
        try {
            jsi::ArrayBuffer body(rt, std::make_shared<VectorBuffer>(std::move(request.body)));
            rt.global().getPropertyAsFunction(rt, "__crossbind_frame")
                .call(rt, jsi::String::createFromUtf8(rt, call), jsi::String::createFromUtf8(rt, request.query), std::move(body));
        } catch (const std::exception &error) {
            if (replies_.erase(call) > 0) respond(SchemeResponse{500, "text/plain", bytesOf(error.what())});
        }
    });
}

void Core::reset() {
    const Page page = newPage();
    // After the calls the page before made, which the module's thread takes in order, and before the new page's.
    js_.post([this, page](jsi::Runtime &rt) {
        page_ = static_cast<long long>(page.id());
        window_ = page.windowId();
        pageFunctions_.clear();
        // The page before's calls reach no page: each that waits is cancelled.
        const auto open = std::move(openCalls_);
        openCalls_.clear();
        cancelledEarly_.clear();
        for (const auto &[id, call] : open) {
            const std::shared_ptr<StateOf<Call>> state = call.state.lock();
            if (state && app::cancelCall(state)) reply(call.reply, abortReply(call.name));
        }
        pageStarted(page);
        rt.global().getPropertyAsFunction(rt, "__crossbind_reset").call(rt);
    });
}

void Core::postEvent(std::string event, std::string json, bool isHeld) {
    js_.postOrRun([event = std::move(event), json = std::move(json), isHeld](jsi::Runtime &rt) {
        rt.global().getPropertyAsFunction(rt, "__crossbind_event")
            .call(rt, jsi::String::createFromUtf8(rt, event), jsi::String::createFromUtf8(rt, json), isHeld);
    });
}

// A function the page passed, as the module holds it. It counts the messages that passed it to this one, which the
// page, told the count once Hermes collects it, takes from its own, so that a message still on its way keeps it.
struct Core::PageFunction {
    PageFunction(Core *core, long long page, long long id) : core(core), page(page), id(id) {}
    PageFunction(const PageFunction &) = delete;
    PageFunction &operator=(const PageFunction &) = delete;
    ~PageFunction() { core->dropped(page, id, passed); }

    Core *core;
    long long page;
    long long id;
    double passed = 0;
};

jsi::Value Core::pageFunction(jsi::Runtime &rt, long long id) {
    const auto held = pageFunctions_.find(id);
    if (held != pageFunctions_.end()) {
        const std::shared_ptr<PageFunction> state = held->second.first.lock();
        jsi::Value function = held->second.second.lock(rt);
        if (state && function.isObject()) {
            state->passed += 1;
            return function;
        }
    }
    auto state = std::make_shared<PageFunction>(this, page_, id);
    state->passed = 1;
    jsi::Function function = jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "pageFunction"), 0,
        [this, state](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
            if (state->page != page_) return jsi::Value::undefined();
            std::vector<jsi::Value> forwarded;
            forwarded.reserve(count + 1);
            forwarded.emplace_back(static_cast<double>(state->id));
            for (size_t i = 0; i < count; i += 1) forwarded.emplace_back(rt, args[i]);
            rt.global().getPropertyAsFunction(rt, "__crossbind_called").call(rt, static_cast<const jsi::Value *>(forwarded.data()), forwarded.size());
            return jsi::Value::undefined();
        });
    pageFunctions_.insert_or_assign(id, std::make_pair(std::weak_ptr<PageFunction>(state), jsi::WeakObject(rt, function)));
    return jsi::Value(rt, function);
}

// Hermes collects functions while JS runs, so the page hears of one in a task of its own.
void Core::dropped(long long page, long long id, double passed) {
    js_.post([this, page, id, passed](jsi::Runtime &rt) {
        if (page != page_) return;
        const auto held = pageFunctions_.find(id);
        if (held != pageFunctions_.end() && held->second.first.expired()) pageFunctions_.erase(held);
        rt.global().getPropertyAsFunction(rt, "__crossbind_dropped").call(rt, static_cast<double>(id), passed);
    });
}

void postEvent(std::string event, std::string json, bool isHeld) {
    if (Core *core = running.load()) {
        core->postEvent(std::move(event), std::move(json), isHeld);
        return;
    }
    std::lock_guard<std::mutex> lock(earlyMutex);
    if (Core *core = running.load()) core->postEvent(std::move(event), std::move(json), isHeld);
    else earlyEvents.push_back({std::move(event), std::move(json), isHeld});
}

}  // namespace crossbind::app
