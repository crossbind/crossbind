// The fetch() of Windows: WinHTTP, on a thread of its own for each fetch, without its cookies, its redirects or the
// user's credentials, which follows a redirect within the URL's origin itself.
#include "host_core.h"
#include "windows/com.h"

#include <shlwapi.h>
#include <winhttp.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <thread>

namespace app = crossbind::app;
using namespace crossbind::windows;

namespace {

using Clock = std::chrono::steady_clock;

// Longer than any URL a browser takes.
constexpr DWORD MAX_URL = 1 << 16;

struct Handle {
    HINTERNET handle = nullptr;
    explicit Handle(HINTERNET opened) : handle(opened) {}
    Handle(const Handle &) = delete;
    Handle &operator=(const Handle &) = delete;
    ~Handle() {
        if (handle) WinHttpCloseHandle(handle);
    }
};

// What WinHTTP connects to and asks for of a URL.
struct Target {
    bool isHttps = false;
    std::wstring host;
    INTERNET_PORT port = 0;
    std::wstring path;
};

std::optional<Target> targetOf(const std::wstring &url) {
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof parts;
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &parts) || (parts.nScheme != INTERNET_SCHEME_HTTP && parts.nScheme != INTERNET_SCHEME_HTTPS)) return std::nullopt;
    Target target;
    target.isHttps = parts.nScheme == INTERNET_SCHEME_HTTPS;
    target.host.assign(parts.lpszHostName, parts.dwHostNameLength);
    target.port = parts.nPort;
    target.path.assign(parts.lpszUrlPath, parts.dwUrlPathLength);
    // A fragment stays with the page.
    const std::wstring extra(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    target.path += extra.substr(0, extra.find(L'#'));
    if (target.path.empty() || target.path.front() != L'/') target.path.insert(0, L"/");
    return target;
}

bool isSameOrigin(const Target &from, const Target &to) { return from.isHttps == to.isHttps && from.port == to.port && _wcsicmp(from.host.c_str(), to.host.c_str()) == 0; }

// WinHTTP's own words for its errors, which its DLL holds, and the system's for the others.
std::string reasonOf(DWORD error) {
    if (error == ERROR_WINHTTP_TIMEOUT) return app::tookTooLong();
    wchar_t *text = nullptr;
    const DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_IGNORE_INSERTS | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_FROM_HMODULE;
    FormatMessageW(flags, GetModuleHandleW(L"winhttp.dll"), error, 0, reinterpret_cast<LPWSTR>(&text), 0, nullptr);
    std::string reason = text ? utf8(text) : "WinHTTP failed with error " + std::to_string(error);
    if (text) LocalFree(text);
    while (!reason.empty() && (reason.back() == '\n' || reason.back() == '\r' || reason.back() == ' ')) reason.pop_back();
    return reason;
}

std::wstring headerOf(HINTERNET request, DWORD query) {
    DWORD size = 0;
    WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, WINHTTP_NO_OUTPUT_BUFFER, &size, WINHTTP_NO_HEADER_INDEX);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0) return L"";
    std::wstring value(size / sizeof(wchar_t), L'\0');
    if (!WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, value.data(), &size, WINHTTP_NO_HEADER_INDEX)) return L"";
    value.resize(size / sizeof(wchar_t));
    return value;
}

// The answer's headers, each line after the status line as a name and a value, the name in lower case.
crossbind::Request::Headers headersOf(HINTERNET request) {
    crossbind::Request::Headers headers;
    const std::string raw = utf8(headerOf(request, WINHTTP_QUERY_RAW_HEADERS_CRLF).c_str());
    size_t start = raw.find("\r\n");
    while (start != std::string::npos && start + 2 < raw.size()) {
        const size_t end = raw.find("\r\n", start + 2);
        const std::string line = raw.substr(start + 2, end == std::string::npos ? std::string::npos : end - start - 2);
        const size_t colon = line.find(':');
        if (colon != std::string::npos) {
            std::string name = line.substr(0, colon);
            std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            const size_t value = line.find_first_not_of(' ', colon + 1);
            headers.emplace_back(name, value == std::string::npos ? "" : line.substr(value));
        }
        start = end;
    }
    return headers;
}

void setTimeouts(HINTERNET handle, Clock::time_point deadline) {
    const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
    const int ms = static_cast<int>(std::max<long long>(1, left));
    WinHttpSetTimeouts(handle, ms, ms, ms, ms);
}

void fetchNow(const std::string &method, const std::string &url, const crossbind::Request::Headers &headers, const app::FetchDone &done) {
    const Clock::time_point deadline = Clock::now() + std::chrono::seconds(app::FETCH_SECONDS);
    std::wstring current = wide(url);
    const std::optional<Target> first = targetOf(current);
    if (!first) {
        done("crossbind: fetch() cannot read the URL " + url, {});
        return;
    }
    const Handle session(WinHttpOpen(L"crossbind", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session.handle) {
        done(reasonOf(GetLastError()), {});
        return;
    }
    std::wstring sent;
    for (const auto &[name, value] : headers) sent += wide(name) + L": " + wide(value) + L"\r\n";
    sent += L"Accept-Encoding: identity\r\n";
    Target target = *first;
    for (int redirects = 0;;) {
        if (Clock::now() >= deadline) {
            done(app::tookTooLong(), {});
            return;
        }
        setTimeouts(session.handle, deadline);
        const Handle connection(WinHttpConnect(session.handle, target.host.c_str(), target.port, 0));
        const Handle request(connection.handle ? WinHttpOpenRequest(connection.handle, wide(method).c_str(), target.path.c_str(), nullptr, WINHTTP_NO_REFERER,
                                                     WINHTTP_DEFAULT_ACCEPT_TYPES, target.isHttps ? WINHTTP_FLAG_SECURE : 0)
                                               : nullptr);
        if (!request.handle) {
            done(reasonOf(GetLastError()), {});
            return;
        }
        DWORD features = WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_REDIRECTS | WINHTTP_DISABLE_AUTHENTICATION;
        WinHttpSetOption(request.handle, WINHTTP_OPTION_DISABLE_FEATURE, &features, sizeof features);
        DWORD logon = WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH;
        WinHttpSetOption(request.handle, WINHTTP_OPTION_AUTOLOGON_POLICY, &logon, sizeof logon);
        if (!WinHttpSendRequest(request.handle, sent.c_str(), static_cast<DWORD>(-1), WINHTTP_NO_REQUEST_DATA, 0, 0, 0)
            || !WinHttpReceiveResponse(request.handle, nullptr)) {
            done(reasonOf(GetLastError()), {});
            return;
        }
        DWORD status = 0;
        DWORD size = sizeof status;
        WinHttpQueryHeaders(request.handle, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX);
        const std::wstring location = status >= 300 && status < 400 ? headerOf(request.handle, WINHTTP_QUERY_LOCATION) : L"";
        if (!location.empty()) {
            std::wstring resolved(MAX_URL, L'\0');
            DWORD length = MAX_URL;
            const bool isResolved = SUCCEEDED(UrlCombineW(current.c_str(), location.c_str(), resolved.data(), &length, 0));
            resolved.resize(isResolved ? length : 0);
            const std::optional<Target> next = isResolved ? targetOf(resolved) : std::nullopt;
            if (next && isSameOrigin(*first, *next)) {
                redirects += 1;
                if (redirects > app::MAX_FETCH_REDIRECTS) {
                    done(app::redirectedTooOften(), {});
                    return;
                }
                current = resolved;
                target = *next;
                continue;
            }
        }
        const std::wstring declared = headerOf(request.handle, WINHTTP_QUERY_CONTENT_LENGTH);
        if (!declared.empty() && std::stoull(declared) > app::MAX_FETCH_BYTES) {
            done(app::declaredTooLarge(std::stoull(declared)), {});
            return;
        }
        crossbind::FetchResponse response;
        response.status = static_cast<int>(status);
        response.headers = headersOf(request.handle);
        for (DWORD available = 0;;) {
            setTimeouts(request.handle, deadline);
            if (!WinHttpQueryDataAvailable(request.handle, &available)) {
                done(Clock::now() >= deadline ? app::tookTooLong() : reasonOf(GetLastError()), {});
                return;
            }
            if (available == 0) break;
            if (response.body.size() + available > app::MAX_FETCH_BYTES) {
                done(app::passedTheLimit(), {});
                return;
            }
            const size_t at = response.body.size();
            response.body.resize(at + available);
            DWORD read = 0;
            if (!WinHttpReadData(request.handle, response.body.data() + at, available, &read)) {
                done(reasonOf(GetLastError()), {});
                return;
            }
            response.body.resize(at + read);
            if (Clock::now() >= deadline) {
                done(app::tookTooLong(), {});
                return;
            }
        }
        done(std::nullopt, std::move(response));
        return;
    }
}

}  // namespace

void crossbind::app::fetchOnPlatform(const std::string &method, const std::string &url, const crossbind::Request::Headers &headers, FetchDone done) {
    std::thread([method, url, headers, done = std::move(done)] {
        try {
            fetchNow(method, url, headers, done);
        } catch (const std::exception &error) {
            done(std::string("crossbind: the fetch failed: ") + error.what(), {});
        }
    }).detach();
}
