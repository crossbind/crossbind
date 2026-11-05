// An Android app's native half: the module in Hermes behind JNI. The activity hands in the page's calls, each under an
// id of its own, and the requests for the page's files; the answers go back through CrossbindActivity's static
// callbacks, from whichever thread gives them. Extensions call their Java the same way, through callJava().
#include <android/log.h>
#include <jni.h>
#include <unistd.h>

#include "app.h"
#include "page_requests.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <future>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <unordered_map>

namespace {

namespace app = crossbind::app;

constexpr const char *TAG = "Crossbind";

JavaVM *vm;
jclass activityClass;
jmethodID onReply;
jmethodID onReplyBytes;
jmethodID callExtension;
jmethodID cancelExtension;
jmethodID responseOf;
jmethodID answerHttpAuthentication;
jmethodID answerDownload;
jmethodID stopDownload;
std::string resources;
// The app's own folders, which the activity names.
std::string dataDir;
std::string cacheDir;
app::Core *core;

JNIEnv *attachedEnv() {
    JNIEnv *env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
        vm->AttachCurrentThread(&env, nullptr);
        // ART aborts the app when a thread it attached ends attached, as a thread of the app's that showed a dialog
        // would.
        thread_local const struct Detach {
            ~Detach() { vm->DetachCurrentThread(); }
        } detach;
    }
    return env;
}

// An exception the activity threw is left behind, as the thread goes on making JNI calls.
void clearException(JNIEnv *env) {
    if (!env->ExceptionCheck()) return;
    env->ExceptionDescribe();
    env->ExceptionClear();
}

// Text goes to Java as UTF-8 bytes, which modified UTF-8 would not carry whole.
jbyteArray bytesOf(JNIEnv *env, const std::string &text) {
    jbyteArray bytes = env->NewByteArray(static_cast<jsize>(text.size()));
    env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(text.size()), reinterpret_cast<const jbyte *>(text.data()));
    return bytes;
}

void answer(jint call, bool ok, const std::string &text) {
    JNIEnv *env = attachedEnv();
    jbyteArray bytes = bytesOf(env, text);
    env->CallStaticVoidMethod(activityClass, onReply, call, static_cast<jboolean>(ok), bytes);
    clearException(env);
    env->DeleteLocalRef(bytes);
}

// A result's bytes go after four the activity fills with the page's id, so the page gets one ArrayBuffer per answer.
void answerBytes(jint call, const std::vector<uint8_t> &body) {
    JNIEnv *env = attachedEnv();
    jbyteArray framed = env->NewByteArray(static_cast<jsize>(body.size() + 4));
    env->SetByteArrayRegion(framed, 4, static_cast<jsize>(body.size()), reinterpret_cast<const jbyte *>(body.data()));
    env->CallStaticVoidMethod(activityClass, onReplyBytes, call, framed);
    clearException(env);
    env->DeleteLocalRef(framed);
}

// Queries are ASCII, which modified UTF-8 leaves alone; page text and paths arrive as UTF-8 bytes instead.
std::string asciiOf(JNIEnv *env, jstring value) {
    const char *chars = env->GetStringUTFChars(value, nullptr);
    std::string text(chars);
    env->ReleaseStringUTFChars(value, chars);
    return text;
}

std::string textOf(JNIEnv *env, jbyteArray value) {
    std::string text(static_cast<size_t>(env->GetArrayLength(value)), '\0');
    env->GetByteArrayRegion(value, 0, static_cast<jsize>(text.size()), reinterpret_cast<jbyte *>(text.data()));
    return text;
}

std::vector<std::string> textsOf(JNIEnv *env, jobjectArray values) {
    std::vector<std::string> texts;
    const jsize count = env->GetArrayLength(values);
    for (jsize index = 0; index < count; ++index) {
        auto value = static_cast<jbyteArray>(env->GetObjectArrayElement(values, index));
        texts.push_back(textOf(env, value));
        env->DeleteLocalRef(value);
    }
    return texts;
}

std::vector<crossbind::Value::Bytes> bytesListOf(JNIEnv *env, jobjectArray values) {
    std::vector<crossbind::Value::Bytes> all;
    for (const std::string &text : textsOf(env, values)) all.emplace_back(text.begin(), text.end());
    return all;
}

// A byte[][] of texts or bytes, each a byte[].
template <typename Items>
jobjectArray byteArraysOf(JNIEnv *env, const Items &items) {
    jclass type = env->FindClass("[B");
    jobjectArray all = env->NewObjectArray(static_cast<jsize>(items.size()), type, nullptr);
    env->DeleteLocalRef(type);
    for (size_t index = 0; index < items.size(); ++index) {
        jbyteArray bytes = env->NewByteArray(static_cast<jsize>(items[index].size()));
        env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(items[index].size()), reinterpret_cast<const jbyte *>(items[index].data()));
        env->SetObjectArrayElement(all, static_cast<jsize>(index), bytes);
        env->DeleteLocalRef(bytes);
    }
    return all;
}

// Android drops what a process writes to its standard output and error: the lines go to logcat instead, as an app's
// output goes to the terminal on the desktop. The WebView's Chromium runs in the process too, and logs its own lines,
// as "[...:ERROR:file.cc(12)] ...", to logcat as well, so those are left out.
void forward(int fd, int priority) {
    int fds[2];
    if (pipe(fds) != 0) return;
    dup2(fds[1], fd);
    std::thread([from = fds[0], priority] {
        char buffer[1024];
        std::string line;
        for (ssize_t n; (n = read(from, buffer, sizeof buffer)) > 0;) {
            for (ssize_t i = 0; i < n; i += 1) {
                if (buffer[i] != '\n') {
                    line += buffer[i];
                    continue;
                }
                if (line.rfind('[', 0) != 0 || line.find(".cc(") == std::string::npos) __android_log_write(priority, TAG, line.c_str());
                line.clear();
            }
        }
    }).detach();
}

}  // namespace

std::string resourceDir() { return resources; }

// The app's output goes to logcat, which has the reason already.
void showError(const std::string &) {}

// An Android app's folders are its own already.
crossbind::app::Paths appPaths() {
    const std::string logs = dataDir + "/logs";
    std::error_code error;
    std::filesystem::create_directories(logs, error);
    if (error) throw std::runtime_error("crossbind: cannot make the app's folder " + logs + ": " + error.message());
    return {dataDir, cacheDir, logs};
}

namespace {

using JavaAnswer = std::function<void(std::optional<std::string>, crossbind::Value)>;

// A call of an extension's Java: what waits for its answer, and where its messages go, where any do.
struct JavaCall {
    JavaAnswer done;
    std::function<void(crossbind::Value)> message;
};

// The calls of extensions' Java that wait for their answers, under the id the activity answers each with.
std::mutex javaMutex;
std::unordered_map<jint, JavaCall> javaCalls;
uint32_t nextJavaCall;

// Hands done the answer; what done throws stays out of the JVM, which would end the app: it is told, and the call done
// held fails as it lets go of it.
void answer(const JavaAnswer &done, std::optional<std::string> failure, crossbind::Value result) {
    try {
        done(std::move(failure), std::move(result));
    } catch (const std::exception &error) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "crossbind: the answer of an extension's Java failed: %s", error.what());
    } catch (...) {
        __android_log_write(ANDROID_LOG_ERROR, TAG, "crossbind: the answer of an extension's Java failed");
    }
}

void javaAnswered(jint call, bool ok, const std::string &text, const std::vector<crossbind::Value::Bytes> &bytes) {
    JavaAnswer done;
    {
        std::lock_guard<std::mutex> lock(javaMutex);
        const auto waiting = javaCalls.find(call);
        if (waiting == javaCalls.end()) return;
        done = std::move(waiting->second.done);
        javaCalls.erase(waiting);
    }
    if (!ok) {
        answer(done, text, {});
        return;
    }
    crossbind::Value result;
    try {
        result = app::valueWithBytes(text, bytes);
    } catch (const std::exception &error) {
        answer(done, error.what(), {});
        return;
    }
    answer(done, std::nullopt, std::move(result));
}

// A message of a call's Java, for the call's page; the native code's own calls, and those it let go of, take none.
void javaSent(jint call, const std::string &text, const std::vector<crossbind::Value::Bytes> &bytes) {
    std::function<void(crossbind::Value)> message;
    {
        std::lock_guard<std::mutex> lock(javaMutex);
        const auto waiting = javaCalls.find(call);
        if (waiting == javaCalls.end() || !waiting->second.message) return;
        message = waiting->second.message;
    }
    try {
        message(app::valueWithBytes(text, bytes));
    } catch (const std::exception &error) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "crossbind: a message of an extension's Java failed: %s", error.what());
    }
}

jint waitForJava(JavaCall waiting) {
    std::lock_guard<std::mutex> lock(javaMutex);
    const auto call = static_cast<jint>(nextJavaCall++);
    javaCalls.emplace(call, std::move(waiting));
    return call;
}

void startJava(jint call, const std::string &extension, const std::string &function, const crossbind::Value &options) {
    std::vector<crossbind::Value::Bytes> bytes;
    std::string json;
    try {
        json = app::jsonWithBytes(options, bytes);
    } catch (const std::exception &error) {
        javaAnswered(call, false, error.what(), {});
        return;
    }
    JNIEnv *env = attachedEnv();
    jbyteArray name = bytesOf(env, extension);
    jbyteArray called = bytesOf(env, function);
    jbyteArray text = bytesOf(env, json);
    jobjectArray attached = byteArraysOf(env, bytes);
    env->CallStaticVoidMethod(activityClass, callExtension, call, name, called, text, attached);
    const bool hasFailed = env->ExceptionCheck();
    clearException(env);
    env->DeleteLocalRef(attached);
    env->DeleteLocalRef(text);
    env->DeleteLocalRef(called);
    env->DeleteLocalRef(name);
    if (hasFailed) javaAnswered(call, false, "crossbind: the activity could not call " + extension + "." + function, {});
}

// The page cancelled the call: its Java's answer goes nowhere, and the Java hears of it.
void cancelJava(jint call) {
    {
        std::lock_guard<std::mutex> lock(javaMutex);
        javaCalls.erase(call);
    }
    JNIEnv *env = attachedEnv();
    env->CallStaticVoidMethod(activityClass, cancelExtension, call);
    clearException(env);
}

}  // namespace

namespace crossbind::android {

void callJava(const std::string &extension, const std::string &function, Value::Object options,
    std::function<void(std::optional<std::string> failure, Value result)> done) {
    startJava(waitForJava({std::move(done), {}}), extension, function, Value(std::move(options)));
}

void callJava(const std::string &extension, const std::string &function, Call call) {
    const jint id = waitForJava({[call](std::optional<std::string> failure, Value result) {
                                     if (failure) {
                                         call.reject(*failure);
                                     } else {
                                         call.resolve(std::move(result));
                                     }
                                 },
        [call](Value message) { call.send(std::move(message)); }});
    startJava(id, extension, function, call.options().isObject() ? call.options() : Value(Value::Object{}));
    // After the call, so the activity hears of a cancel after the call it cancels.
    call.onCancel([id] { cancelJava(id); });
}

}  // namespace crossbind::android

void quitApp() { throw std::runtime_error("crossbind: an Android app does not quit itself: the system ends it"); }

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *jvm, void *) {
    vm = jvm;
    forward(STDOUT_FILENO, ANDROID_LOG_INFO);
    forward(STDERR_FILENO, ANDROID_LOG_WARN);
    // Into a pipe, printf's lines would wait in a full buffer.
    setvbuf(stdout, nullptr, _IOLBF, 0);
    return JNI_VERSION_1_6;
}

// Starts the module once per process; a new activity of the same process gets the module it left, which its first page
// frees of the old page's objects. Returns the page's token and the dev server's page a debug host opens, or "".
extern "C" JNIEXPORT jobjectArray JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeStart(JNIEnv *env, jclass type,
    jstring files, jstring url, jstring data, jstring cache) {
    if (!core) {
        activityClass = static_cast<jclass>(env->NewGlobalRef(type));
        onReply = env->GetStaticMethodID(type, "onReply", "(IZ[B)V");
        onReplyBytes = env->GetStaticMethodID(type, "onReplyBytes", "(I[B)V");
        callExtension = env->GetStaticMethodID(type, "callExtension", "(I[B[B[B[[B)V");
        cancelExtension = env->GetStaticMethodID(type, "cancelExtension", "(I)V");
        responseOf = env->GetStaticMethodID(type, "responseOf", "(ILjava/lang/String;[[B[B[B[B)Landroid/webkit/WebResourceResponse;");
        answerHttpAuthentication = env->GetStaticMethodID(type, "answerHttpAuthentication", "(I[B[B)V");
        answerDownload = env->GetStaticMethodID(type, "answerDownload", "(II[B)V");
        stopDownload = env->GetStaticMethodID(type, "stopDownload", "(I)V");
        resources = asciiOf(env, files);
        dataDir = asciiOf(env, data);
        cacheDir = asciiOf(env, cache);
        if (url) setenv("CROSSBIND_APP_URL", asciiOf(env, url).c_str(), 1);
        core = &app::start(app::devUrl());
    }
    const char *devUrl = app::devUrl();
    // The activity's one WebView shows a page of no window, 0, whose channel every activity of the process shares.
    static const std::string token = core->addWindow(0);
    jobjectArray started = env->NewObjectArray(2, env->FindClass("java/lang/String"), nullptr);
    env->SetObjectArrayElement(started, 0, env->NewStringUTF(token.c_str()));
    env->SetObjectArrayElement(started, 1, env->NewStringUTF(devUrl ? devUrl : ""));
    return started;
}

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeMessage(JNIEnv *env, jclass, jint call,
    jbyteArray text) {
    core->receive(textOf(env, text), [call](const std::string &reply) { answer(call, true, reply); });
}

// The byte arrays of one message, answered as a crossbind:// POST to /b/frame is on the other platforms.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeFrame(JNIEnv *env, jclass, jint call, jstring query,
    jbyteArray frame, jint bodyOffset) {
    std::vector<uint8_t> body(static_cast<size_t>(env->GetArrayLength(frame) - bodyOffset));
    env->GetByteArrayRegion(frame, bodyOffset, static_cast<jsize>(body.size()), reinterpret_cast<jbyte *>(body.data()));
    core->serve(SchemeRequest{"POST", "/b/frame", asciiOf(env, query), std::move(body)}, [call](SchemeResponse response) {
        answer(call, response.status == 200, std::string(response.body.begin(), response.body.end()));
    });
}

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeResult(JNIEnv *env, jclass, jint call, jstring query) {
    core->serve(SchemeRequest{"GET", "/b/result", asciiOf(env, query), {}}, [call](SchemeResponse response) {
        if (response.status == 200) answerBytes(call, response.body);
        else answer(call, false, std::string(response.body.begin(), response.body.end()));
    });
}

// A file of the page or an extension's URL, which the WebView's thread waits for, as the WebView asks it to.
extern "C" JNIEXPORT jobject JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeRequest(JNIEnv *env, jclass type, jstring method,
    jstring path, jstring query, jobjectArray headers) {
    SchemeRequest request{asciiOf(env, method), asciiOf(env, path), asciiOf(env, query), {}};
    const std::vector<std::string> fields = textsOf(env, headers);
    // The activity measures the answer's stream to the Range the WebView takes to it.
    std::optional<std::string> range;
    for (size_t at = 0; at + 1 < fields.size(); at += 2) {
        request.headers.emplace_back(fields[at], fields[at + 1]);
        std::string name = fields[at];
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (name == "range") range = fields[at + 1];
    }
    std::promise<SchemeResponse> answered;
    core->serve(std::move(request), [&answered](SchemeResponse response) { answered.set_value(std::move(response)); });
    const SchemeResponse response = answered.get_future().get();
    std::vector<std::string> written;
    for (const auto &[name, value] : response.headers) {
        written.push_back(name);
        written.push_back(value);
    }
    // Modified UTF-8 carries ASCII alone as UTF-8 does, and a type is ASCII.
    const bool isAscii = std::all_of(response.mime.begin(), response.mime.end(), [](unsigned char c) { return c < 0x80; });
    jstring mime = env->NewStringUTF(isAscii ? response.mime.c_str() : "application/octet-stream");
    jobjectArray answerHeaders = byteArraysOf(env, written);
    jbyteArray body = env->NewByteArray(static_cast<jsize>(response.body.size()));
    env->SetByteArrayRegion(body, 0, static_cast<jsize>(response.body.size()), reinterpret_cast<const jbyte *>(response.body.data()));
    jbyteArray file = response.file.empty() ? nullptr : bytesOf(env, response.file);
    jbyteArray asked = range ? bytesOf(env, *range) : nullptr;
    jobject made = env->CallStaticObjectMethod(type, responseOf, response.status, mime, answerHeaders, body, file, asked);
    clearException(env);
    if (asked) env->DeleteLocalRef(asked);
    if (file) env->DeleteLocalRef(file);
    env->DeleteLocalRef(body);
    env->DeleteLocalRef(answerHeaders);
    env->DeleteLocalRef(mime);
    return made;
}

// A new page replaced the one that held the module's objects.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeNewPage(JNIEnv *, jclass) { core->reset(0); }

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeOpenUrl(JNIEnv *env, jclass, jbyteArray url) {
    app::openedUrl(textOf(env, url));
}

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeShortcutItem(JNIEnv *env, jclass, jbyteArray type) {
    app::shortcutItemTapped(textOf(env, type));
}

// The files the system opened the app with, each copied into the app's cache, by their paths in UTF-8, with the MIME
// type it gave each, empty for none.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeOpenFiles(JNIEnv *env, jclass, jobjectArray paths,
                                                                                           jobjectArray mimeTypes) {
    app::openedFiles(textsOf(env, paths), textsOf(env, mimeTypes));
}

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeActive(JNIEnv *, jclass, jboolean isActive) {
    app::appActivated(isActive == JNI_TRUE);
}

// The answer of an extension's Java: its result's JSON and its bytes, or why the call failed.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeExtensionAnswered(JNIEnv *env, jclass, jint call,
    jboolean ok, jbyteArray text, jobjectArray bytes) {
    javaAnswered(call, ok == JNI_TRUE, textOf(env, text), bytesListOf(env, bytes));
}

// A message of an extension's Java for its call's page: its JSON and its bytes.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeExtensionMessage(JNIEnv *env, jclass, jint call,
    jbyteArray text, jobjectArray bytes) {
    javaSent(call, textOf(env, text), bytesListOf(env, bytes));
}

// page-navigation's answer, as the activity's LOAD and OUTSIDE number NavigationAnswer's. The WebView opens no window of
// the page's: it loads a link of target="_blank" in the page's place.
extern "C" JNIEXPORT jint JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeNavigation(JNIEnv *env, jclass, jbyteArray url,
    jboolean isMainFrame, jboolean isUserInitiated) {
    return static_cast<jint>(app::decideNavigation(nullptr, textOf(env, url), isMainFrame == JNI_TRUE, isUserInitiated == JNI_TRUE, false));
}

namespace {

// The downloads page-downloads heard of, by their ids, till the activity tells how each ended.
struct Downloading {
    std::shared_ptr<app::DownloadEvents> events;
    std::string url;
};
std::mutex downloadsMutex;
std::unordered_map<jint, Downloading> downloading;

void answerActivity(jint id, app::DownloadAnswer::Kind kind, const std::string &path) {
    JNIEnv *env = attachedEnv();
    jbyteArray bytes = kind == app::DownloadAnswer::Kind::saveTo ? bytesOf(env, path) : nullptr;
    env->CallStaticVoidMethod(activityClass, answerDownload, id, static_cast<jint>(kind), bytes);
    clearException(env);
    if (bytes) env->DeleteLocalRef(bytes);
}

void stopActivity(jint id) {
    JNIEnv *env = attachedEnv();
    env->CallStaticVoidMethod(activityClass, stopDownload, id);
    clearException(env);
}

}  // namespace

// A download the page handed over whole, in the activity's order of DownloadAnswer's kinds.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeDownload(JNIEnv *env, jclass, jint id, jbyteArray url,
    jbyteArray name, jbyteArray mime, jlong size) {
    auto events = std::make_shared<app::DownloadEvents>();
    const std::string address = textOf(env, url);
    {
        std::lock_guard<std::mutex> lock(downloadsMutex);
        downloading[id] = Downloading{events, address};
    }
    // An Android page is of no window, which no webview names.
    app::askDownload(std::make_shared<app::StateOf<crossbind::Download>>(nullptr, address, textOf(env, name), textOf(env, mime), static_cast<int64_t>(size), events,
        [id, events](app::DownloadAnswer answer) {
            const bool isStarted = answer.kind != app::DownloadAnswer::Kind::cancel && app::startDownload(*events, [id] { stopActivity(id); });
            answerActivity(id, isStarted ? answer.kind : app::DownloadAnswer::Kind::cancel, answer.path);
        }));
}

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeDownloadFinished(JNIEnv *env, jclass, jint id,
    jboolean isCancelled, jbyteArray failure, jbyteArray path) {
    Downloading ended;
    {
        std::lock_guard<std::mutex> lock(downloadsMutex);
        const auto found = downloading.find(id);
        if (found == downloading.end()) return;
        ended = std::move(found->second);
        downloading.erase(found);
    }
    app::tellFinish(*ended.events, ended.url,
        crossbind::DownloadEnd{textOf(env, path), isCancelled == JNI_TRUE, failure ? std::optional<std::string>(textOf(env, failure)) : std::nullopt});
}

// Android's WebView names the host without its port, and tells no proxy's ask from a server's.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeHttpAuthentication(JNIEnv *env, jclass, jint id,
    jbyteArray host, jbyteArray realm) {
    app::askHttpAuthentication(app::make<crossbind::HttpAuthentication>(std::make_shared<app::StateOf<crossbind::HttpAuthentication>>(nullptr,
        textOf(env, host), textOf(env, realm), false, [id](std::optional<std::pair<std::string, std::string>> given) {
            JNIEnv *answering = attachedEnv();
            jbyteArray user = given ? bytesOf(answering, given->first) : nullptr;
            jbyteArray password = given ? bytesOf(answering, given->second) : nullptr;
            answering->CallStaticVoidMethod(activityClass, answerHttpAuthentication, id, user, password);
            clearException(answering);
            if (user) answering->DeleteLocalRef(user);
            if (password) answering->DeleteLocalRef(password);
        })));
}
