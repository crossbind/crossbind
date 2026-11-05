#include "page_requests.h"
#include "platform.h"
#include "windows/com.h"

#include <atomic>

using namespace crossbind::windows;
using crossbind::Download;
using crossbind::DownloadEnd;
namespace app = crossbind::app;

// page-downloads answers each download the page starts before any of it arrives, as WebView2 waits for the deferral.
// What ask() saves goes where WebView2 puts it, with its own downloads shown; what saveTo() saves shows nothing of
// WebView2's.
namespace {

// A download as it runs: what its owner hears, and where saveTo() saves it, with the file it arrives in beside that
// till it is whole.
struct Running {
    std::shared_ptr<app::DownloadEvents> events;
    std::string url;
    std::wstring target;
    std::wstring arrival;
};

std::string reasonOf(COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON reason) {
    switch (reason) {
    case COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_NO_SPACE: return "the disk is full";
    case COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_ACCESS_DENIED: return "the file could not be written there";
    case COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NETWORK_FAILED: return "the network failed";
    default: return "the download failed";
    }
}

// The file a download arrives in beside where it goes, which no other download of the process names.
std::wstring arrivalBeside(const std::wstring &target) {
    static std::atomic<unsigned> next{0};
    return target + L"." + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64()) + L"-" + std::to_wstring(++next) +
           L".download";
}

void finished(ICoreWebView2DownloadOperation *operation, const Running &running) {
    COREWEBVIEW2_DOWNLOAD_STATE state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
    operation->get_State(&state);
    if (state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS) return;
    // One WebView2's own downloads show goes on where its user resumes it there, as after a pause.
    BOOL canResume = FALSE;
    if (state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED && running.target.empty() && SUCCEEDED(operation->get_CanResume(&canResume)) && canResume) return;
    if (state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED) {
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE;
        operation->get_InterruptReason(&reason);
        if (!running.arrival.empty()) DeleteFileW(running.arrival.c_str());
        app::tellFinish(*running.events, running.url,
            reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED ? DownloadEnd{"", true} : DownloadEnd{"", false, reasonOf(reason)});
    } else if (running.target.empty()) {
        LPWSTR path = nullptr;
        operation->get_ResultFilePath(&path);
        app::tellFinish(*running.events, running.url, DownloadEnd{take(path)});
    } else if (!MoveFileExW(running.arrival.c_str(), running.target.c_str(), MOVEFILE_REPLACE_EXISTING)) {
        DeleteFileW(running.arrival.c_str());
        app::tellFinish(*running.events, running.url, DownloadEnd{"", false, std::string("the file could not take the place of the one there")});
    } else {
        app::tellFinish(*running.events, running.url, DownloadEnd{utf8(running.target.c_str())});
    }
}

void follow(ICoreWebView2DownloadOperation *operation, std::shared_ptr<Running> running) {
    EventRegistrationToken token;
    auto *received = new Handler<ICoreWebView2BytesReceivedChangedEventHandler, ICoreWebView2DownloadOperation *, IUnknown *>(
        IID_ICoreWebView2BytesReceivedChangedEventHandler, [running](ICoreWebView2DownloadOperation *sender, IUnknown *) -> HRESULT {
            INT64 bytes = 0;
            INT64 total = -1;
            sender->get_BytesReceived(&bytes);
            sender->get_TotalBytesToReceive(&total);
            app::tellProgress(*running->events, running->url, bytes, total);
            return S_OK;
        });
    operation->add_BytesReceivedChanged(received, &token);
    received->Release();
    auto *changed = new Handler<ICoreWebView2StateChangedEventHandler, ICoreWebView2DownloadOperation *, IUnknown *>(
        IID_ICoreWebView2StateChangedEventHandler, [running](ICoreWebView2DownloadOperation *sender, IUnknown *) -> HRESULT {
            finished(sender, *running);
            return S_OK;
        });
    operation->add_StateChanged(changed, &token);
    changed->Release();
}

void answer(ICoreWebView2DownloadStartingEventArgs *args, ICoreWebView2DownloadOperation *operation, const std::shared_ptr<Running> &running,
    const app::DownloadAnswer &answer) {
    operation->AddRef();
    // The operation goes once the stop does, on the UI thread.
    std::shared_ptr<ICoreWebView2DownloadOperation> held(operation, [](ICoreWebView2DownloadOperation *going) {
        onMainThread([going] { going->Release(); });
    });
    const bool isStarted = answer.kind != app::DownloadAnswer::Kind::cancel &&
                           app::startDownload(*running->events, [held] { onMainThread([held] { held->Cancel(); }); });
    if (!isStarted) {
        args->put_Cancel(TRUE);
        app::tellFinish(*running->events, running->url, DownloadEnd{"", true});
        return;
    }
    if (answer.kind == app::DownloadAnswer::Kind::saveTo) {
        running->target = wide(answer.path);
        running->arrival = arrivalBeside(running->target);
        args->put_ResultFilePath(running->arrival.c_str());
        args->put_Handled(TRUE);
    }
    follow(operation, running);
}

// The name WebView2 would save a download by, at the end of the path it suggests.
std::string nameOf(const std::string &path) { return path.substr(path.find_last_of("\\/") + 1); }

HRESULT onDownloadStarting(ICoreWebView2 *, ICoreWebView2DownloadStartingEventArgs *args) {
    ICoreWebView2DownloadOperation *operation = nullptr;
    if (FAILED(args->get_DownloadOperation(&operation))) return S_OK;
    ICoreWebView2Deferral *deferral = nullptr;
    if (FAILED(args->GetDeferral(&deferral))) {
        operation->Release();
        return S_OK;
    }
    auto running = std::make_shared<Running>();
    running->events = std::make_shared<app::DownloadEvents>();
    LPWSTR uri = nullptr;
    operation->get_Uri(&uri);
    running->url = take(uri);
    LPWSTR mime = nullptr;
    operation->get_MimeType(&mime);
    INT64 size = -1;
    operation->get_TotalBytesToReceive(&size);
    LPWSTR suggested = nullptr;
    args->get_ResultFilePath(&suggested);
    args->AddRef();
    const auto download = std::make_shared<app::StateOf<Download>>(running->url, nameOf(take(suggested)), take(mime), size, running->events,
        [args, deferral, operation, running](app::DownloadAnswer given) {
            onMainThread([args, deferral, operation, running, given] {
                answer(args, operation, running, given);
                deferral->Complete();
                deferral->Release();
                operation->Release();
                args->Release();
            });
        });
    // Its owner may ask the app's user, which no WebView2 event's handler may wait for.
    onMainThread([download] { app::askDownload(download); });
    return S_OK;
}

}  // namespace

void takeDownloads(void *webView) {
    ICoreWebView2_4 *core4 = nullptr;
    if (FAILED(coreWebView(webView)->QueryInterface(IID_ICoreWebView2_4, reinterpret_cast<void **>(&core4)))) return;
    auto *starting = new Handler<ICoreWebView2DownloadStartingEventHandler, ICoreWebView2 *, ICoreWebView2DownloadStartingEventArgs *>(
        IID_ICoreWebView2DownloadStartingEventHandler, onDownloadStarting);
    EventRegistrationToken token;
    core4->add_DownloadStarting(starting, &token);
    starting->Release();
    core4->Release();
}
