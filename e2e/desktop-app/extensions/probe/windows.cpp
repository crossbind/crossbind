// What the probe adds on Windows: a close of the window, as its user's, which the window takes before it answers, the
// app's activation, as Windows tells the window of it, and a toast's template from WinRT, through its ABI headers in C++.
#include "probe.h"

#include <windows.h>
#include <roapi.h>
#include <winstring.h>
#include <windows.data.xml.dom.h>
#include <windows.ui.notifications.h>

#include <cwchar>
#include <string>

void tellActive(bool isActive) { SendMessageW(static_cast<HWND>(crossbind::appWindow()), WM_ACTIVATEAPP, isActive ? TRUE : FALSE, 0); }

namespace {

// The template of a toast of two lines, which an extension that shows toasts with buttons starts from: "ok", or the
// HRESULT of what failed.
std::string toastTemplate() {
    using namespace ABI::Windows::UI::Notifications;
    const HRESULT initialized = RoInitialize(RO_INIT_MULTITHREADED);
    const wchar_t *className = RuntimeClass_Windows_UI_Notifications_ToastNotificationManager;
    HSTRING name = nullptr;
    HRESULT result = WindowsCreateString(className, static_cast<UINT32>(std::wcslen(className)), &name);
    IToastNotificationManagerStatics *manager = nullptr;
    if (SUCCEEDED(result)) result = RoGetActivationFactory(name, __uuidof(IToastNotificationManagerStatics), reinterpret_cast<void **>(&manager));
    WindowsDeleteString(name);
    ABI::Windows::Data::Xml::Dom::IXmlDocument *content = nullptr;
    if (SUCCEEDED(result)) result = manager->GetTemplateContent(ToastTemplateType_ToastText02, &content);
    const bool isMade = SUCCEEDED(result) && content != nullptr;
    if (content) content->Release();
    if (manager) manager->Release();
    if (SUCCEEDED(initialized)) RoUninitialize();
    return isMade ? "ok" : "failed: " + std::to_string(result);
}

// A task dialog of the app's, the class of Windows' dialogs, shown.
BOOL CALLBACK findDialog(HWND window, LPARAM found) {
    DWORD process = 0;
    GetWindowThreadProcessId(window, &process);
    wchar_t name[8] = {};
    if (process != GetCurrentProcessId() || !IsWindowVisible(window) || GetClassNameW(window, name, 8) == 0 || std::wcscmp(name, L"#32770") != 0) return TRUE;
    *reinterpret_cast<HWND *>(found) = window;
    return FALSE;
}

}  // namespace

// The dialog's modal loop runs in a task of the UI thread's, which holds the next one, so the close goes from here, as
// Escape closes it.
void closeMessageDialog(const std::string &, std::function<void(bool, const std::string &)> done) {
    HWND dialog = nullptr;
    EnumWindows(findDialog, reinterpret_cast<LPARAM>(&dialog));
    wchar_t title[256] = {};
    if (dialog) {
        GetWindowTextW(dialog, title, 256);
        PostMessageW(dialog, WM_CLOSE, 0, 0);
    }
    std::string text(static_cast<size_t>(WideCharToMultiByte(CP_UTF8, 0, title, -1, nullptr, 0, nullptr, nullptr)), '\0');
    WideCharToMultiByte(CP_UTF8, 0, title, -1, text.data(), static_cast<int>(text.size()), nullptr, nullptr);
    text.resize(text.empty() ? 0 : text.size() - 1);
    done(dialog != nullptr, text);
}

void probePlatform(crossbind::Registry &registry) {
    registry.function("probe.close", [](crossbind::Call call) {
        crossbind::onMainThread([call] {
            SendMessageW(static_cast<HWND>(crossbind::appWindow()), WM_CLOSE, 0, 0);
            call.resolve();
        });
    });
    registry.function("probe.toastTemplate", [](crossbind::Call call) {
        crossbind::inBackground(call, [] { return crossbind::Value(toastTemplate()); });
    });
}
