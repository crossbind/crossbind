#include "dialog.h"

#include <windows.h>

#include <commctrl.h>
#include <shobjidl.h>

#include <cstdio>

namespace crossbind::dialog {
namespace {

// The window a dialog is modal to: the calling page's, or the app's oldest.
HWND parentOf(uint64_t window) {
    const std::optional<Window> open = windowOf(window);
    return static_cast<HWND>(open ? open->native() : appWindow());
}

// A message dialog's own buttons are numbered past the common ones, IDOK to IDCONTINUE.
constexpr int FIRST_BUTTON = 100;

std::wstring wide(const std::string &text) {
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
    return result;
}

std::string utf8(const wchar_t *text) {
    if (!text || !*text) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    std::string result(static_cast<size_t>(size - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, result.data(), size, nullptr, nullptr);
    return result;
}

// A dialog's file types, as COMDLG_FILTERSPECs pointing into the strings beside them.
struct FileTypes {
    std::vector<std::wstring> names;
    std::vector<std::wstring> patterns;
    std::vector<COMDLG_FILTERSPEC> specs;
};

FileTypes fileTypesOf(const std::vector<FileFilter> &filters) {
    FileTypes types;
    for (const auto &filter : filters) {
        std::wstring pattern;
        for (const auto &extension : filter.extensions) pattern += (pattern.empty() ? L"*." : L";*.") + wide(extension);
        types.names.push_back(wide(filter.name));
        types.patterns.push_back(pattern);
    }
    for (size_t i = 0; i < filters.size(); i += 1) types.specs.push_back({types.names[i].c_str(), types.patterns[i].c_str()});
    return types;
}

void setUp(IFileDialog *dialog, const std::string &title, const std::string &folder, const FileTypes &types) {
    if (!title.empty()) dialog->SetTitle(wide(title).c_str());
    IShellItem *start = nullptr;
    if (!folder.empty() && SUCCEEDED(SHCreateItemFromParsingName(wide(folder).c_str(), nullptr, IID_PPV_ARGS(&start)))) {
        dialog->SetFolder(start);
        start->Release();
    }
    if (!types.specs.empty()) dialog->SetFileTypes(static_cast<UINT>(types.specs.size()), types.specs.data());
}

std::string pathOf(IShellItem *item) {
    PWSTR path = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) return {};
    std::string out = utf8(path);
    CoTaskMemFree(path);
    return out;
}

// The caller of a dialog that could not show hears no more than of one cancelled, so the reason goes to the output.
void report(const char *dialog, HRESULT result) {
    if (FAILED(result) && result != HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
        std::fprintf(stderr, "crossbind: the %s dialog failed: 0x%08lx\n", dialog, static_cast<unsigned long>(result));
    }
}

}  // namespace

// Modal to the app's window, as the system's file dialogs are.
void showOpenDialog(uint64_t window, OpenOptions options, std::function<void(Picked)> done) {
    onMainThread([window, options = std::move(options), done = std::move(done)] {
        IFileOpenDialog *dialog = nullptr;
        if (const HRESULT made = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)); FAILED(made)) {
            report("open", made);
            done(std::nullopt);
            return;
        }
        FILEOPENDIALOGOPTIONS flags = 0;
        dialog->GetOptions(&flags);
        dialog->SetOptions(flags | FOS_FORCEFILESYSTEM | (options.directory ? FOS_PICKFOLDERS : 0) | (options.multiple ? FOS_ALLOWMULTISELECT : 0));
        const FileTypes types = fileTypesOf(options.filters);
        setUp(dialog, options.title, options.defaultPath, types);
        Picked picked;
        IShellItemArray *items = nullptr;
        const HRESULT shown = dialog->Show(parentOf(window));
        report("open", shown);
        if (SUCCEEDED(shown) && SUCCEEDED(dialog->GetResults(&items))) {
            picked.emplace();
            DWORD count = 0;
            items->GetCount(&count);
            for (DWORD i = 0; i < count; i += 1) {
                IShellItem *item = nullptr;
                if (FAILED(items->GetItemAt(i, &item))) continue;
                picked->push_back(pathOf(item));
                item->Release();
            }
            items->Release();
        }
        dialog->Release();
        done(std::move(picked));
    });
}

void showSaveDialog(uint64_t window, SaveOptions options, std::function<void(std::optional<std::string>)> done) {
    onMainThread([window, options = std::move(options), done = std::move(done)] {
        IFileSaveDialog *dialog = nullptr;
        if (const HRESULT made = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)); FAILED(made)) {
            report("save", made);
            done(std::nullopt);
            return;
        }
        FILEOPENDIALOGOPTIONS flags = 0;
        dialog->GetOptions(&flags);
        dialog->SetOptions(flags | FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT);
        const FileTypes types = fileTypesOf(options.filters);
        setUp(dialog, options.title, options.defaultPath, types);
        if (!options.defaultName.empty()) dialog->SetFileName(wide(options.defaultName).c_str());
        // A name typed without an extension takes the first file type's.
        if (!options.filters.empty() && !options.filters[0].extensions.empty()) {
            dialog->SetDefaultExtension(wide(options.filters[0].extensions[0]).c_str());
        }
        std::optional<std::string> file;
        IShellItem *item = nullptr;
        const HRESULT shown = dialog->Show(parentOf(window));
        report("save", shown);
        if (SUCCEEDED(shown) && SUCCEEDED(dialog->GetResult(&item))) {
            file = pathOf(item);
            item->Release();
        }
        dialog->Release();
        done(std::move(file));
    });
}

// Modal to the app's window, as a message box is.
void showMessageDialog(uint64_t window, MessageOptions options, std::function<void(int)> done) {
    onMainThread([window, options = std::move(options), done = std::move(done)] {
        const std::wstring title = wide(appName());
        const std::wstring message = wide(options.message);
        const std::wstring detail = wide(options.detail);
        std::vector<std::wstring> labels;
        for (const auto &label : options.buttons) {
            // A label's ampersands stay as they are, as no access key takes them.
            std::wstring text;
            for (const wchar_t c : wide(label)) text += c == L'&' ? L"&&" : std::wstring(1, c);
            labels.push_back(text);
        }
        std::vector<TASKDIALOG_BUTTON> buttons;
        for (size_t i = 0; i < labels.size(); i += 1) buttons.push_back({FIRST_BUTTON + static_cast<int>(i), labels[i].c_str()});
        TASKDIALOGCONFIG config{};
        config.cbSize = sizeof config;
        config.hwndParent = parentOf(window);
        // Escape and closing the dialog answer IDCANCEL.
        config.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW;
        config.dwCommonButtons = buttons.empty() ? TDCBF_OK_BUTTON : 0;
        config.pszWindowTitle = title.c_str();
        config.pszMainIcon = options.kind == MessageKind::error     ? TD_ERROR_ICON
                             : options.kind == MessageKind::warning ? TD_WARNING_ICON
                                                                         : TD_INFORMATION_ICON;
        config.pszMainInstruction = message.c_str();
        if (!detail.empty()) config.pszContent = detail.c_str();
        config.cButtons = static_cast<UINT>(buttons.size());
        config.pButtons = buttons.data();
        config.nDefaultButton = buttons.empty() ? IDOK : FIRST_BUTTON;
        int clicked = IDCANCEL;
        const HRESULT shown = TaskDialogIndirect(&config, &clicked, nullptr, nullptr);
        report("message", shown);
        done(FAILED(shown) || clicked == IDCANCEL ? NO_BUTTON : clicked == IDOK ? 0 : clicked - FIRST_BUTTON);
    });
}

}  // namespace crossbind::dialog
