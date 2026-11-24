// Windows' own for the preview extension: the Credential Manager keeps the app's token, CNG makes HMAC-SHA256, SHA-256
// and random bytes, and the default browser shows the page that approves a sign-in.
#include "preview.h"

#include <windows.h>

#include <bcrypt.h>
#include <wincred.h>

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

}  // namespace preview
