// How a Windows app keeps one instance: the instance holds a named mutex and a message-only window, which a later launch,
// finding the mutex, sends its launch to.
#include "instance.h"

#include <windows.h>

#include <atomic>
#include <cstdio>
#include <future>
#include <system_error>
#include <thread>

namespace crossbind::instance {
namespace {

// Marks a launch among the WM_COPYDATA messages the window may get.
constexpr ULONG_PTR LAUNCH = 0x63626c6e;

std::atomic<bool> isLeaving{false};

void warn(const std::string &what) { std::fprintf(stderr, "crossbind: %s\n", what.c_str()); }

std::wstring wide(const std::string &text) {
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
    return result;
}

LRESULT CALLBACK instanceProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message != WM_COPYDATA) return DefWindowProcW(window, message, wParam, lParam);
    const auto *data = reinterpret_cast<const COPYDATASTRUCT *>(lParam);
    // An instance on its way out takes no launch, which waits for it to end and becomes the next instance.
    if (!data || data->dwData != LAUNCH || isLeaving) return FALSE;
    // No exception crosses the window procedure.
    try {
        std::optional<Launch> launch = decodeLaunch({static_cast<const char *>(data->lpData), data->cbData});
        if (!launch) return FALSE;
        // The launch that sent it leaves at once, as on macOS and Linux, whatever the app then does with it on the main
        // thread. The data is copied, as the sender may free it from now on.
        ReplyMessage(TRUE);
        crossbind::launchedAgain(std::move(*launch));
        return TRUE;
    } catch (const std::exception &error) {
        std::fprintf(stderr, "crossbind: the app did not take a launch: %s\n", error.what());
    } catch (...) {
        std::fprintf(stderr, "crossbind: the app did not take a launch\n");
    }
    return FALSE;
}

// Makes the window later launches find, and answers them on a thread of its own, as the main thread may be busy starting
// the app or ending it; false when it cannot.
bool answerLaunches(const std::wstring &name) {
    std::promise<bool> made;
    std::future<bool> isMade = made.get_future();
    try {
        std::thread([name, made = std::move(made)]() mutable {
            WNDCLASSEXW type{};
            type.cbSize = sizeof type;
            type.lpfnWndProc = instanceProcedure;
            type.hInstance = GetModuleHandleW(nullptr);
            type.lpszClassName = name.c_str();
            const bool isMadeHere = RegisterClassExW(&type) &&
                                    CreateWindowExW(0, name.c_str(), L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, type.hInstance, nullptr);
            made.set_value(isMadeHere);
            MSG message;
            while (isMadeHere && GetMessageW(&message, nullptr, 0, 0) > 0) DispatchMessageW(&message);
        }).detach();
    } catch (const std::system_error &) {
        return false;
    }
    return isMade.get();
}

// Sends the launch to the instance's window, and waits for its answer until the deadline, so no launch reaches it twice:
// true once the instance took it, false when it did not, as on its way out.
bool handOver(const std::wstring &name, const std::string &bytes, std::chrono::steady_clock::time_point deadline) {
    const HWND window = FindWindowExW(HWND_MESSAGE, nullptr, name.c_str(), nullptr);
    const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
    if (!window || left <= 0) return false;
    DWORD instance = 0;
    GetWindowThreadProcessId(window, &instance);
    // The user just started this launch, which lets it give the instance the front.
    AllowSetForegroundWindow(instance);
    COPYDATASTRUCT data{LAUNCH, static_cast<DWORD>(bytes.size()), const_cast<char *>(bytes.data())};
    DWORD_PTR isTaken = FALSE;
    return SendMessageTimeoutW(window, WM_COPYDATA, 0, reinterpret_cast<LPARAM>(&data), SMTO_NORMAL, static_cast<UINT>(left),
                               &isTaken) &&
           isTaken == TRUE;
}

}  // namespace

Claim claimInstance(const Launch &launch, const std::string &id) {
    // Each signed-in user's session has its own; the name also sets a development session apart.
    const std::wstring name = wide(id + "." + INSTANCE_NAME);
    const std::wstring mutexName = L"Local\\" + name;
    const std::string bytes = encodeLaunch(launch);
    const auto deadline = std::chrono::steady_clock::now() + CLAIM_TIME;
    for (;;) {
        const HANDLE mutex = CreateMutexW(nullptr, FALSE, mutexName.c_str());
        const DWORD error = GetLastError();
        if (!mutex) {
            warn("the app cannot make its mutex, error " + std::to_string(error) + ", so it runs as one more instance");
            return Claim::Instance;
        }
        // The instance keeps the mutex while it runs.
        if (error != ERROR_ALREADY_EXISTS) {
            if (!answerLaunches(name)) {
                CloseHandle(mutex);
                warn("the app cannot hear of its later launches, so they run as instances of their own");
            }
            return Claim::Instance;
        }
        if (bytes.size() > MAX_LAUNCH) {
            warn("this launch's arguments are too long to hand to the app that runs");
            return Claim::NotTaken;
        }
        const bool isTaken = handOver(name, bytes, deadline);
        // The mutex lasts while any handle to it is open, this launch's as well.
        CloseHandle(mutex);
        if (isTaken) return Claim::HandedOver;
        if (std::chrono::steady_clock::now() >= deadline) {
            warn("the app runs already, but did not take this launch");
            return Claim::NotTaken;
        }
        Sleep(static_cast<DWORD>(CLAIM_PAUSE.count()));
    }
}

void leaveInstance() { isLeaving = true; }

}  // namespace crossbind::instance
