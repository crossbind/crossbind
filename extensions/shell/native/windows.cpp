// The shell on Windows, which the shell's own functions and Explorer answer.
#include "shell.h"

#include <windows.h>

#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>

#include <algorithm>
#include <atomic>
#include <cstdio>

namespace crossbind::shell {
namespace {

using Failure = std::optional<std::string>;

std::wstring wide(const std::string &text) {
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
    return result;
}

bool exists(const std::string &path) { return GetFileAttributesW(wide(path).c_str()) != INVALID_FILE_ATTRIBUTES; }

// Aborts a deletion that would not go to the Recycle Bin, as IFileOperation makes of an item on a drive without one,
// such as a network share: it would delete the item for good.
class RecycleOnly final : public IFileOperationProgressSink {
public:
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --refs_;
        if (left == 0) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **out) override {
        if (!out) return E_POINTER;
        if (!IsEqualIID(riid, IID_IUnknown) && !IsEqualIID(riid, IID_IFileOperationProgressSink)) {
            *out = nullptr;
            return E_NOINTERFACE;
        }
        *out = static_cast<IFileOperationProgressSink *>(this);
        AddRef();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE PreDeleteItem(DWORD flags, IShellItem *) override { return flags & TSF_DELETE_RECYCLE_IF_POSSIBLE ? S_OK : E_ABORT; }
    HRESULT STDMETHODCALLTYPE StartOperations() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE FinishOperations(HRESULT) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PreRenameItem(DWORD, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostRenameItem(DWORD, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PreMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PreCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return S_OK; }
    // With no UI, an item that stays, as a file another program holds, fails here alone.
    HRESULT STDMETHODCALLTYPE PostDeleteItem(DWORD, IShellItem *, HRESULT result, IShellItem *) override {
        if (FAILED(result)) failure = result;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE PreNewItem(DWORD, IShellItem *, LPCWSTR) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PostNewItem(DWORD, IShellItem *, LPCWSTR, LPCWSTR, DWORD, HRESULT, IShellItem *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE UpdateProgress(UINT, UINT) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE ResetTimer() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE PauseTimer() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE ResumeTimer() override { return S_OK; }

    HRESULT failure = S_OK;

private:
    std::atomic<ULONG> refs_{1};
};

}  // namespace

// The address goes into the command line of its scheme's handler, which the checked address has no space or quote to
// split.
void openUrl(std::string url, Done done) {
    onMainThread([url = std::move(url), done = std::move(done)] {
        const auto opened = reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", wide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        done(opened > 32 ? Failure() : Failure("crossbind: nothing opens " + url));
    });
}

void openFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        if (!exists(path)) {
            done("crossbind: there is no " + path);
            return;
        }
        const auto opened = reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr, L"open", wide(path).c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        done(opened > 32 ? Failure() : Failure("crossbind: nothing opens " + path));
    });
}

void revealFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        // The shell reads a path with backslashes alone.
        std::wstring native = wide(path);
        std::replace(native.begin(), native.end(), L'/', L'\\');
        PIDLIST_ABSOLUTE item = exists(path) ? ILCreateFromPathW(native.c_str()) : nullptr;
        if (!item) {
            done("crossbind: there is no " + path);
            return;
        }
        const HRESULT shown = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
        ILFree(item);
        done(SUCCEEDED(shown) ? Failure() : Failure("crossbind: Explorer cannot show " + path));
    });
}

void trashFile(std::string path, Done done) {
    onMainThread([path = std::move(path), done = std::move(done)] {
        if (!exists(path)) {
            done("crossbind: there is no " + path);
            return;
        }
        // The shell reads a path with backslashes alone.
        std::wstring native = wide(path);
        std::replace(native.begin(), native.end(), L'/', L'\\');
        IFileOperation *operation = nullptr;
        IShellItem *item = nullptr;
        auto *sink = new RecycleOnly();
        DWORD cookie = 0;
        BOOL isAborted = FALSE;
        HRESULT result = CoCreateInstance(CLSID_FileOperation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&operation));
        if (SUCCEEDED(result)) result = operation->SetOperationFlags(FOF_NO_UI | FOFX_RECYCLEONDELETE);
        if (SUCCEEDED(result)) result = SHCreateItemFromParsingName(native.c_str(), nullptr, IID_PPV_ARGS(&item));
        if (SUCCEEDED(result)) result = operation->Advise(sink, &cookie);
        if (SUCCEEDED(result)) result = operation->DeleteItem(item, nullptr);
        if (SUCCEEDED(result)) result = operation->PerformOperations();
        if (SUCCEEDED(result)) result = sink->failure;
        if (operation) operation->GetAnyOperationsAborted(&isAborted);
        if (cookie) operation->Unadvise(cookie);
        if (item) item->Release();
        if (operation) operation->Release();
        sink->Release();
        if (isAborted) {
            done("crossbind: cannot move " + path + " to the Recycle Bin, which its drive has none of");
        } else if (FAILED(result)) {
            char code[sizeof "0x00000000"];
            std::snprintf(code, sizeof code, "0x%08lx", static_cast<unsigned long>(result));
            done("crossbind: cannot move " + path + " to the Recycle Bin: " + code);
        } else {
            done(std::nullopt);
        }
    });
}

}  // namespace crossbind::shell
