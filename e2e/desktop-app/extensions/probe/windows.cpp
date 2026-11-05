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

}  // namespace

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
