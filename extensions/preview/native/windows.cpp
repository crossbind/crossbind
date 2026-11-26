// Windows' own for the preview extension: the Credential Manager keeps the app's token, CNG makes HMAC-SHA256, SHA-256
// and random bytes, the default browser shows the page that approves a sign-in, a project's question is a task dialog of
// its window, and what shows that a preview is one is the window's title and the preview's items at the top of its
// system menu, which Alt+Space and a right click on the title bar open.
#include "preview.h"

#include <windows.h>

#include <bcrypt.h>
#include <commctrl.h>
#include <wincred.h>

#include "WebView2.h"

#include <cstdio>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace preview {
namespace {

constexpr ULONG DIGEST_BYTES = 32;

std::wstring wide(const std::string &text) {
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring out(size, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size);
    return out;
}

// The generic credential of the app's token for a cloud, by the app's service and the cloud's address.
std::wstring targetOf(const std::string &cloud) { return wide(config().service + "/" + cloud); }

std::string wordsOf(DWORD error) { return "the Credential Manager answered " + std::to_string(error); }

std::optional<std::string> digestOf(bool isHmac, const std::string &key, const std::string &text) {
    BCRYPT_ALG_HANDLE provider = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::string digest(DIGEST_BYTES, '\0');
    auto *keyBytes = reinterpret_cast<PUCHAR>(const_cast<char *>(key.data()));
    NTSTATUS status = BCryptOpenAlgorithmProvider(&provider, BCRYPT_SHA256_ALGORITHM, nullptr, isHmac ? BCRYPT_ALG_HANDLE_HMAC_FLAG : 0);
    if (status >= 0) status = BCryptCreateHash(provider, &hash, nullptr, 0, isHmac ? keyBytes : nullptr, isHmac ? static_cast<ULONG>(key.size()) : 0, 0);
    if (status >= 0) status = BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char *>(text.data())), static_cast<ULONG>(text.size()), 0);
    if (status >= 0) status = BCryptFinishHash(hash, reinterpret_cast<PUCHAR>(digest.data()), DIGEST_BYTES, 0);
    if (hash) BCryptDestroyHash(hash);
    if (provider) BCryptCloseAlgorithmProvider(provider, 0);
    if (status < 0) return std::nullopt;
    return digest;
}

void answerDigest(const std::optional<std::string> &digest, const Digest &done) {
    if (digest) done(std::nullopt, *digest);
    else done(std::string("crossbind: Windows made no SHA-256"), {});
}

// The question's own buttons, numbered past the common ones, IDOK to IDCONTINUE.
constexpr int DONT_ALLOW_BUTTON = 100;
constexpr int ALLOW_BUTTON = 101;

// The question's task dialog once it shows, and whether it was closed unanswered.
struct Asked {
    std::mutex mutex;
    HWND dialog = nullptr;
    bool isClosed = false;
};

HRESULT CALLBACK onQuestion(HWND dialog, UINT notification, WPARAM, LPARAM, LONG_PTR data) {
    auto *asked = reinterpret_cast<Asked *>(data);
    std::lock_guard<std::mutex> lock(asked->mutex);
    if (notification == TDN_CREATED) {
        asked->dialog = dialog;
        if (asked->isClosed) PostMessageW(dialog, TDM_CLICK_BUTTON, DONT_ALLOW_BUTTON, 0);
    } else if (notification == TDN_DESTROYED) {
        asked->dialog = nullptr;
    }
    return S_OK;
}

// The preview's items at the top of a window's system menu, by the commands WM_SYSCOMMAND carries, whose four low bits
// are the system's; and the subclass of the window that takes them.
constexpr UINT RELOAD_ITEM = 0x1F10;
constexpr UINT NAME_ITEM = 0x1F20;
constexpr UINT LINE_ITEM = 0x1F30;
constexpr UINT CLOSE_ITEM = 0x1F40;
constexpr UINT SEPARATOR_ITEM = 0x1F50;
constexpr UINT PERMISSIONS_ITEM = 0x1F60;
constexpr UINT PROJECT_ITEM = 0x1F70;
constexpr UINT NOTHING_ITEM = 0x1F80;
// Permissions' item of each kind.
const std::pair<const char *, UINT> KIND_ITEMS[] = {{"camera", 0x1F90}, {"microphone", 0x1FA0}, {"location", 0x1FB0}};
constexpr UINT_PTR SUBCLASS = 0x5F5;

// The title a window the indicator is up on had, which it gets back once it comes down, and the origin of the preview
// its Permissions changes; on the main thread.
std::map<uint64_t, std::wstring> marked;
std::string menuOrigin;

// A menu item's text as text: an & of its own draws as itself, and a tab, which would start the item's shortcut, as a
// space.
std::wstring menuText(const std::string &text) {
    std::wstring out;
    for (const wchar_t each : wide(text)) {
        if (each == L'&') out += L"&&";
        else out += each == L'\t' ? L' ' : each;
    }
    return out;
}

LRESULT CALLBACK onSystemCommand(HWND window, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR) {
    if (message == WM_SYSCOMMAND) {
        const UINT command = static_cast<UINT>(wParam & 0xFFF0);
        if (command == RELOAD_ITEM) {
            reloadPreview();
            return 0;
        }
        if (command == CLOSE_ITEM) {
            closePreview();
            return 0;
        }
        // A kind's check mark turned the other way: the answer kept, and the page reloaded so that it holds for it.
        for (const auto &[kind, item] : KIND_ITEMS) {
            if (command != item) continue;
            const bool isOn = (GetMenuState(GetSystemMenu(window, FALSE), item, MF_BYCOMMAND) & MF_CHECKED) == 0;
            if (changeConsent(menuOrigin, kind, isOn)) reloadPreview();
            return 0;
        }
    }
    return DefSubclassProc(window, message, wParam, lParam);
}

void insertItem(HMENU menu, UINT at, UINT command, const std::wstring &text, UINT state, HMENU submenu = nullptr) {
    std::wstring shown = text;
    MENUITEMINFOW item{};
    item.cbSize = sizeof item;
    item.fMask = MIIM_ID | MIIM_FTYPE | MIIM_STATE | MIIM_STRING | (submenu ? MIIM_SUBMENU : 0);
    item.fType = MFT_STRING;
    item.fState = state;
    item.wID = command;
    item.hSubMenu = submenu;
    item.dwTypeData = shown.data();
    InsertMenuItemW(menu, at, TRUE, &item);
}

// Deleting Permissions destroys its submenu with it.
void dropItems(HMENU menu) {
    for (const UINT command : {RELOAD_ITEM, NAME_ITEM, LINE_ITEM, PERMISSIONS_ITEM, CLOSE_ITEM, SEPARATOR_ITEM}) DeleteMenu(menu, command, MF_BYCOMMAND);
}

// Permissions: the project's name, then a check mark for each kind its user answered, on where Allow is kept; or that
// nothing was asked yet.
HMENU permissionsOf(const Shown &shown) {
    HMENU menu = CreatePopupMenu();
    insertItem(menu, 0, PROJECT_ITEM, menuText(shown.project), MFS_DISABLED);
    if (shown.answers.empty()) insertItem(menu, 1, NOTHING_ITEM, L"Nothing asked yet.", MFS_DISABLED);
    UINT at = 1;
    for (const auto &[kind, isAllowed] : shown.answers) {
        for (const auto &[named, item] : KIND_ITEMS) {
            if (kind == named) insertItem(menu, at++, item, wide(controlWordOf(kind)), MFS_ENABLED | (isAllowed ? MFS_CHECKED : MFS_UNCHECKED));
        }
    }
    return menu;
}

// Reload; the project's name over its line, which do nothing, as a menu draws one line an item; Permissions; Close
// preview.
void setItems(HWND window, const Shown &shown) {
    HMENU menu = GetSystemMenu(window, FALSE);
    if (!menu) return;
    dropItems(menu);
    insertItem(menu, 0, RELOAD_ITEM, L"Reload", MFS_ENABLED);
    insertItem(menu, 1, NAME_ITEM, menuText(shown.project), MFS_DISABLED);
    insertItem(menu, 2, LINE_ITEM, menuText(shown.line), MFS_DISABLED);
    insertItem(menu, 3, PERMISSIONS_ITEM, L"Permissions", MFS_ENABLED, permissionsOf(shown));
    insertItem(menu, 4, CLOSE_ITEM, L"Close preview", MFS_ENABLED);
    MENUITEMINFOW separator{};
    separator.cbSize = sizeof separator;
    separator.fMask = MIIM_ID | MIIM_FTYPE;
    separator.fType = MFT_SEPARATOR;
    separator.wID = SEPARATOR_ITEM;
    InsertMenuItemW(menu, 5, TRUE, &separator);
}

}  // namespace

void hmacSha256(const std::string &key, const std::string &text, Digest done) { answerDigest(digestOf(true, key, text), done); }

void sha256(const std::string &text, Digest done) { answerDigest(digestOf(false, {}, text), done); }

std::string randomBytes(std::size_t count) {
    std::string bytes(count, '\0');
    const NTSTATUS status = BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(bytes.data()), static_cast<ULONG>(count), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (status < 0) throw std::runtime_error("crossbind: Windows gave no random bytes: " + std::to_string(status));
    return bytes;
}

void readSecret(const std::string &cloud, std::function<void(Failure failure, std::optional<std::string> secret)> done) {
    std::thread([cloud, done] {
        PCREDENTIALW found = nullptr;
        if (!CredReadW(targetOf(cloud).c_str(), CRED_TYPE_GENERIC, 0, &found)) {
            const DWORD error = GetLastError();
            if (error == ERROR_NOT_FOUND) done(std::nullopt, std::nullopt);
            else done(wordsOf(error), std::nullopt);
            return;
        }
        std::string secret(reinterpret_cast<const char *>(found->CredentialBlob), found->CredentialBlobSize);
        CredFree(found);
        done(std::nullopt, secret);
    }).detach();
}

void writeSecret(const std::string &cloud, const std::string &secret, Done done) {
    std::thread([cloud, secret, done] {
        std::wstring target = targetOf(cloud);
        std::wstring user = L"crossbind";
        std::string blob = secret;
        CREDENTIALW credential{};
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.data();
        credential.UserName = user.data();
        credential.CredentialBlobSize = static_cast<DWORD>(blob.size());
        credential.CredentialBlob = reinterpret_cast<LPBYTE>(blob.data());
        // This user's on this machine alone, never a roaming profile's.
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        done(CredWriteW(&credential, 0) ? Failure() : Failure(wordsOf(GetLastError())));
    }).detach();
}

void deleteSecret(const std::string &cloud, Done done) {
    std::thread([cloud, done] {
        const bool isDeleted = CredDeleteW(targetOf(cloud).c_str(), CRED_TYPE_GENERIC, 0);
        const DWORD error = isDeleted ? ERROR_SUCCESS : GetLastError();
        done(isDeleted || error == ERROR_NOT_FOUND ? Failure() : Failure(wordsOf(error)));
    }).detach();
}

void openSignInPage(const std::string &url, Done done) {
    crossbind::invoke("shell.openExternal", Value::Object{{"url", url}}, [done](Failure failure, Value) { done(failure); });
}

std::string platformName() { return "windows"; }

// The system's version, which RtlGetVersion tells whatever the app's manifest names.
std::string systemVersion() {
    using GetVersion = LONG(WINAPI *)(PRTL_OSVERSIONINFOW);
    const auto get = reinterpret_cast<GetVersion>(reinterpret_cast<void *>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion")));
    RTL_OSVERSIONINFOW info{};
    info.dwOSVersionInfoSize = sizeof info;
    if (!get || get(&info) != 0) return "10.0";
    return std::to_string(info.dwMajorVersion) + "." + std::to_string(info.dwMinorVersion) + "." + std::to_string(info.dwBuildNumber);
}

bool asksForLocalNetwork() { return false; }

// A task dialog of the window, modal to it alone and titled with the app's name: Don't Allow its default button, which
// Return and its first focus take; with no cancel of its own, Escape, Alt+F4 and its close button leave it up. Its modal
// loop runs in a task of the main thread, which holds the answers of the window's pages until it closes, as a message
// dialog's does; it closes by a message of its own, which passes that.
std::function<void()> showConsent(uint64_t window, const std::string &message, const std::string &detail,
    std::function<void(std::optional<bool> isAllowed)> done) {
    auto asked = std::make_shared<Asked>();
    crossbind::onMainThread([window, message, detail, done, asked] {
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        HWND parent = static_cast<HWND>(open ? open->native() : crossbind::appWindow());
        if (!parent) {
            done(std::nullopt);
            return;
        }
        const std::wstring title = wide(crossbind::appName());
        const std::wstring instruction = wide(message);
        const std::wstring content = wide(detail);
        const TASKDIALOG_BUTTON buttons[] = {{ALLOW_BUTTON, L"Allow"}, {DONT_ALLOW_BUTTON, L"Don't Allow"}};
        TASKDIALOGCONFIG config{};
        config.cbSize = sizeof config;
        config.hwndParent = parent;
        config.dwFlags = TDF_POSITION_RELATIVE_TO_WINDOW;
        config.pszWindowTitle = title.c_str();
        config.pszMainIcon = TD_INFORMATION_ICON;
        config.pszMainInstruction = instruction.c_str();
        config.pszContent = content.c_str();
        config.cButtons = 2;
        config.pButtons = buttons;
        config.nDefaultButton = DONT_ALLOW_BUTTON;
        config.pfCallback = onQuestion;
        config.lpCallbackData = reinterpret_cast<LONG_PTR>(asked.get());
        int clicked = 0;
        const HRESULT shown = TaskDialogIndirect(&config, &clicked, nullptr, nullptr);
        {
            std::lock_guard<std::mutex> lock(asked->mutex);
            if (asked->isClosed) return;
        }
        if (SUCCEEDED(shown)) {
            done(clicked == ALLOW_BUTTON);
            return;
        }
        std::fprintf(stderr, "crossbind: preview's question could not show: 0x%08lx\n", static_cast<unsigned long>(shown));
        done(std::nullopt);
    });
    return [asked] {
        std::lock_guard<std::mutex> lock(asked->mutex);
        asked->isClosed = true;
        if (asked->dialog) PostMessageW(asked->dialog, TDM_CLICK_BUTTON, DONT_ALLOW_BUTTON, 0);
    };
}

void showIndicator(uint64_t window, const Shown &shown, std::function<void()> done) {
    crossbind::onMainThread([window, shown, done] {
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        HWND native = open ? static_cast<HWND>(open->native()) : nullptr;
        if (native) {
            if (!marked.count(window)) {
                const int length = GetWindowTextLengthW(native);
                std::wstring title(static_cast<std::size_t>(length) + 1, L'\0');
                title.resize(static_cast<std::size_t>(GetWindowTextW(native, title.data(), length + 1)));
                marked[window] = title;
                SetWindowSubclass(native, onSystemCommand, SUBCLASS, 0);
            }
            SetWindowTextW(native, wide(shown.project + " \xE2\x80\x93 crossbind preview").c_str());
            menuOrigin = shown.origin;
            setItems(native, shown);
        }
        done();
    });
}

void hideIndicator(uint64_t window) {
    crossbind::onMainThread([window] {
        const auto found = marked.find(window);
        if (found == marked.end()) return;
        if (const std::optional<crossbind::Window> open = crossbind::windowOf(window)) {
            HWND native = static_cast<HWND>(open->native());
            SetWindowTextW(native, found->second.c_str());
            if (HMENU menu = GetSystemMenu(native, FALSE)) dropItems(menu);
            RemoveWindowSubclass(native, onSystemCommand, SUBCLASS);
        }
        marked.erase(found);
    });
}

void endIndicator(uint64_t window, std::function<void(bool isShowingProject)> done) {
    crossbind::onMainThread([window, done] {
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        done(open && open->page().role() == "project");
    });
}

void reloadWindow(uint64_t window) {
    crossbind::onMainThread([window] {
        const std::optional<crossbind::Window> open = crossbind::windowOf(window);
        ICoreWebView2 *core = nullptr;
        if (!open || FAILED(static_cast<ICoreWebView2Controller *>(open->webView())->get_CoreWebView2(&core)) || !core) return;
        core->Reload();
        core->Release();
    });
}

}  // namespace preview
