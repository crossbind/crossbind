#include "platform.h"
#include "windows/com.h"

#include <softpub.h>
#include <wincrypt.h>
#include <winhttp.h>
#include <wintrust.h>

#include <cstdio>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <vector>

using namespace crossbind::windows;

namespace {

constexpr DWORD READ_CHUNK = 64 * 1024;
// Antivirus software reads a program it has just seen written, which holds it from running for a moment.
constexpr int SETUP_TRIES = 4;
constexpr DWORD SETUP_RETRY_MS = 500;

// WinHTTP's handles, closed as they go out of scope.
using Internet = std::unique_ptr<void, decltype(&WinHttpCloseHandle)>;

Internet internet(HINTERNET opened) { return Internet(opened, &WinHttpCloseHandle); }

std::runtime_error failed(const std::string &url) {
    return std::runtime_error("crossbind: cannot download " + url + ": WinHTTP error " + std::to_string(GetLastError()));
}

std::string hex(LONG status) {
    char text[sizeof "0x00000000"];
    std::snprintf(text, sizeof text, "0x%08lx", static_cast<unsigned long>(status));
    return text;
}

// A file's Authenticode signature: whether Windows trusts it, whether the file has none at all, which WinVerifyTrust
// tells apart from one it cannot read by the thread's last error, and the common name of the certificate that made it
// once Windows trusts it. Windows checks no revocation for it, as a revocation server out of reach would refuse every
// update.
struct Signature {
    LONG trust;
    bool isUnsigned;
    std::wstring signer;
};

Signature signature(const std::wstring &file) {
    WINTRUST_FILE_INFO info{};
    info.cbStruct = sizeof info;
    info.pcwszFilePath = file.c_str();
    WINTRUST_DATA data{};
    data.cbStruct = sizeof data;
    data.dwUIChoice = WTD_UI_NONE;
    data.fdwRevocationChecks = WTD_REVOKE_NONE;
    data.dwUnionChoice = WTD_CHOICE_FILE;
    data.pFile = &info;
    data.dwStateAction = WTD_STATEACTION_VERIFY;
    data.dwProvFlags = WTD_REVOCATION_CHECK_NONE;
    GUID action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    const HWND noWindow = static_cast<HWND>(INVALID_HANDLE_VALUE);
    Signature result{WinVerifyTrust(noWindow, &action, &data), false, {}};
    if (result.trust == TRUST_E_NOSIGNATURE) {
        const auto reason = static_cast<LONG>(GetLastError());
        result.isUnsigned = reason == TRUST_E_NOSIGNATURE || reason == TRUST_E_SUBJECT_FORM_UNKNOWN || reason == TRUST_E_PROVIDER_UNKNOWN;
    }
    if (result.trust == ERROR_SUCCESS) {
        CRYPT_PROVIDER_DATA *provider = WTHelperProvDataFromStateData(data.hWVTStateData);
        CRYPT_PROVIDER_SGNR *signer = provider ? WTHelperGetProvSignerFromChain(provider, 0, FALSE, 0) : nullptr;
        CRYPT_PROVIDER_CERT *leaf = signer ? WTHelperGetProvCertFromChain(signer, 0) : nullptr;
        if (leaf) {
            void *commonName = const_cast<char *>(szOID_COMMON_NAME);
            const DWORD length = CertGetNameStringW(leaf->pCert, CERT_NAME_ATTR_TYPE, 0, commonName, nullptr, 0);
            result.signer.resize(length);
            CertGetNameStringW(leaf->pCert, CERT_NAME_ATTR_TYPE, 0, commonName, result.signer.data(), length);
            result.signer.resize(length - 1);
        }
    }
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    WinVerifyTrust(noWindow, &action, &data);
    return result;
}

}  // namespace

// A signed app's update has a setup program whose signature Windows trusts, by the app's own signer: the same common
// name, which a renewed certificate keeps. A signed app whose own signature Windows does not trust installs none.
void checkSigner(const std::filesystem::path &update) {
    const Signature own = signature(executablePath());
    if (own.isUnsigned) return;
    if (own.trust != ERROR_SUCCESS) {
        throw std::runtime_error("crossbind: cannot install the update: Windows does not trust this app's own signature (" + hex(own.trust) +
                                 "), whose signer an update must carry; sign the app with a certificate Windows trusts");
    }
    const Signature theirs = signature(update.wstring());
    if (theirs.trust != ERROR_SUCCESS || theirs.signer != own.signer) {
        const std::string but = theirs.trust != ERROR_SUCCESS ? ", and Windows trusts no signature of it (" + hex(theirs.trust) + ")"
                                                              : ", but by " + utf8(theirs.signer.c_str());
        throw std::runtime_error("crossbind: cannot install the update: " + utf8(update.filename().c_str()) + " is not signed by " + utf8(own.signer.c_str()) +
                                 ", who signs this app" + but);
    }
}

// WinHTTP keeps no cache, so every check asks the server anew, and it goes through the system's proxy.
void download(const std::string &url, const std::filesystem::path &file, std::uintmax_t maxBytes) {
    const std::wstring address = wide(url);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof parts;
    parts.dwHostNameLength = parts.dwUrlPathLength = parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(address.c_str(), 0, 0, &parts)) throw std::runtime_error("crossbind: " + url + " is no address");
    const std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
    const std::wstring path = std::wstring(parts.lpszUrlPath, parts.dwUrlPathLength) + std::wstring(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    const Internet session = internet(WinHttpOpen(L"crossbind", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) throw failed(url);
    const Internet connection = internet(WinHttpConnect(session.get(), host.c_str(), parts.nPort, 0));
    if (!connection) throw failed(url);
    const Internet request = internet(WinHttpOpenRequest(connection.get(), L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                         parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0));
    DWORD status = 0;
    DWORD size = sizeof status;
    if (!request || !WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request.get(), nullptr) ||
        !WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size,
                             WINHTTP_NO_HEADER_INDEX)) {
        throw failed(url);
    }
    if (status != HTTP_STATUS_OK) throw std::runtime_error("crossbind: " + url + " answered " + std::to_string(status));
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    std::vector<char> chunk(READ_CHUNK);
    std::uintmax_t total = 0;
    for (DWORD read = 0;;) {
        if (!WinHttpReadData(request.get(), chunk.data(), READ_CHUNK, &read)) throw failed(url);
        if (read == 0) break;
        total += read;
        if (total > maxBytes) throw std::runtime_error("crossbind: " + url + " answered more than " + std::to_string(maxBytes) + " bytes");
        out.write(chunk.data(), read);
    }
    if (!out.flush()) throw std::runtime_error("crossbind: cannot keep the download of " + url);
}

// installer.nsi's /UPDATE waits for the app to quit, installs the update in the app's folder, which /D= names unquoted
// and last, and opens it anew. A folder this user cannot write to fails here, as the setup program shows nothing.
void runSetup(const std::filesystem::path &setup) {
    const std::filesystem::path folder = std::filesystem::path(wide(resourceDir())).parent_path();
    wchar_t probe[MAX_PATH];
    if (!GetTempFileNameW(folder.c_str(), L"cbu", 0, probe)) {
        throw std::runtime_error("crossbind: cannot install the update: this user cannot change " + utf8(folder.c_str()));
    }
    DeleteFileW(probe);
    std::wstring command = L"\"" + setup.wstring() + L"\" /S /UPDATE /D=" + folder.wstring();
    STARTUPINFOW startup{};
    startup.cb = sizeof startup;
    PROCESS_INFORMATION process{};
    for (int tries = 1; !CreateProcessW(setup.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup, &process); tries += 1) {
        const DWORD error = GetLastError();
        if (error != ERROR_SHARING_VIOLATION || tries == SETUP_TRIES) {
            throw std::runtime_error("crossbind: cannot install the update: Windows cannot run its setup program, error " + std::to_string(error));
        }
        Sleep(SETUP_RETRY_MS);
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
}
