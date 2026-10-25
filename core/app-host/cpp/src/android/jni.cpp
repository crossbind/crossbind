// An Android app's native half: the module in Hermes behind JNI. The activity hands in the page's calls, each under an
// id of its own, and the requests for the page's files; the answers go back through CrossbindActivity's static
// callbacks, from whichever thread gives them.
#include <android/log.h>
#include <jni.h>
#include <unistd.h>

#include "app.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <future>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace {

namespace app = crossbind::app;

constexpr const char *TAG = "Crossbind";

JavaVM *vm;
jclass activityClass;
jmethodID onReply;
jmethodID onReplyBytes;
jmethodID showMessage;
// What the message dialog the activity shows answers: crossbind shows one dialog at a time.
std::mutex messageMutex;
std::function<void(int)> messageAnswer;
std::string resources;
// The app's own folders, which the activity names.
std::string dataDir;
std::string cacheDir;
app::Core *core;

JNIEnv *attachedEnv() {
    JNIEnv *env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
        vm->AttachCurrentThread(&env, nullptr);
        // ART aborts the app when a thread it attached ends attached, as a thread of the app's that called
        // messageDialog() would.
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

void showOpenDialog(crossbind::app::OpenOptions, std::function<void(Picked)>) {
    throw std::runtime_error("crossbind: an Android app has no file dialogs yet");
}

void showSaveDialog(crossbind::app::SaveOptions, std::function<void(std::optional<std::string>)>) {
    throw std::runtime_error("crossbind: an Android app has no file dialogs yet");
}

namespace {

void messageAnswered(int button) {
    std::function<void(int)> done;
    {
        std::lock_guard<std::mutex> lock(messageMutex);
        done.swap(messageAnswer);
    }
    if (done) done(button);
}

}  // namespace

// The activity in front shows it, and answers through nativeMessageAnswered.
void showMessageDialog(crossbind::app::MessageOptions options, std::function<void(int)> done) {
    {
        std::lock_guard<std::mutex> lock(messageMutex);
        messageAnswer = std::move(done);
    }
    JNIEnv *env = attachedEnv();
    jclass bytesClass = env->FindClass("[B");
    jobjectArray buttons = env->NewObjectArray(static_cast<jsize>(options.buttons.size()), bytesClass, nullptr);
    for (size_t i = 0; i < options.buttons.size(); i += 1) {
        jbyteArray label = bytesOf(env, options.buttons[i]);
        env->SetObjectArrayElement(buttons, static_cast<jsize>(i), label);
        env->DeleteLocalRef(label);
    }
    jbyteArray message = bytesOf(env, options.message);
    jbyteArray detail = bytesOf(env, options.detail);
    env->CallStaticVoidMethod(activityClass, showMessage, message, detail, buttons);
    const bool hasFailed = env->ExceptionCheck();
    clearException(env);
    env->DeleteLocalRef(detail);
    env->DeleteLocalRef(message);
    env->DeleteLocalRef(buttons);
    env->DeleteLocalRef(bytesClass);
    if (hasFailed) messageAnswered(-1);
}

void openUrl(std::string, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an Android app opens no address outside itself yet");
}

void openFile(std::string, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an Android app opens no file in another app yet");
}

void revealFile(std::string, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an Android app has no file manager to show a file in");
}

void trashFile(std::string, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an Android app has no trash to move a file to");
}

void quitApp() { throw std::runtime_error("crossbind: an Android app does not quit itself: the system ends it"); }

void setMenu(std::vector<MenuItem>, MenuClicked, std::function<void(Failure)>) {
    throw std::runtime_error("crossbind: an Android app has no menu bar");
}

void setMainWindow(void *) {}

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
        showMessage = env->GetStaticMethodID(type, "showMessage", "([B[B[[B)V");
        resources = asciiOf(env, files);
        dataDir = asciiOf(env, data);
        cacheDir = asciiOf(env, cache);
        if (url) setenv("CROSSBIND_APP_URL", asciiOf(env, url).c_str(), 1);
        core = &app::start(app::devUrl());
    }
    const char *devUrl = app::devUrl();
    jobjectArray started = env->NewObjectArray(2, env->FindClass("java/lang/String"), nullptr);
    env->SetObjectArrayElement(started, 0, env->NewStringUTF(core->token().c_str()));
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

// A file of the page: "<status> <mime>\n" and the body.
extern "C" JNIEXPORT jbyteArray JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeRequest(JNIEnv *env, jclass, jbyteArray path,
    jstring query) {
    std::promise<SchemeResponse> answered;
    core->serve(SchemeRequest{"GET", textOf(env, path), asciiOf(env, query), {}},
        [&answered](SchemeResponse response) { answered.set_value(std::move(response)); });
    const SchemeResponse response = answered.get_future().get();
    const std::string head = std::to_string(response.status) + " " + response.mime + "\n";
    jbyteArray out = env->NewByteArray(static_cast<jsize>(head.size() + response.body.size()));
    env->SetByteArrayRegion(out, 0, static_cast<jsize>(head.size()), reinterpret_cast<const jbyte *>(head.data()));
    env->SetByteArrayRegion(out, static_cast<jsize>(head.size()), static_cast<jsize>(response.body.size()),
        reinterpret_cast<const jbyte *>(response.body.data()));
    return out;
}

// A new page replaced the one that held the module's objects.
extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeNewPage(JNIEnv *, jclass) { core->reset(); }

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeOpenUrl(JNIEnv *env, jclass, jbyteArray url) {
    app::openedUrl(textOf(env, url));
}

extern "C" JNIEXPORT void JNICALL Java_dev_crossbind_app_CrossbindActivity_nativeMessageAnswered(JNIEnv *, jclass, jint button) {
    messageAnswered(button);
}
