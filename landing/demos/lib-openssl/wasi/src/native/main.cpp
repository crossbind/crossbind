// A checksum tool on OpenSSL for WASI: file digests in sha256sum's format, a check of a checksum
// list, and the HMAC a webhook sender signs a payload with.
//   openssl-tool digest <algorithm> <file>...     sha256, sha3-256, blake2b512, sm3, ... as OpenSSL names them
//   openssl-tool check <list>                      "<sha256>  <file>" lines, as sha256sum -c reads them
//   openssl-tool hmac <algorithm> <key file> <file>...
#include <openssl/core_names.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr size_t CHUNK = 64 * 1024;

std::string hex(const unsigned char* data, size_t size) {
    static const char digits[] = "0123456789abcdef";
    std::string out;
    for (size_t i = 0; i < size; i += 1) {
        out += digits[data[i] >> 4];
        out += digits[data[i] & 0x0F];
    }
    return out;
}

// Feeds a file to `update` in 64 KB pieces, so a file of any size fits in memory.
template <typename Update>
bool stream(const std::string& path, Update update) {
    std::FILE* file = std::fopen(path.c_str(), "rb");
    if (!file) {
        std::fprintf(stderr, "openssl-tool: cannot open %s\n", path.c_str());
        return false;
    }
    std::vector<unsigned char> buffer(CHUNK);
    bool ok = true;
    size_t read = 0;
    while (ok && (read = std::fread(buffer.data(), 1, buffer.size(), file)) > 0) ok = update(buffer.data(), read);
    ok = ok && !std::ferror(file);
    std::fclose(file);
    return ok;
}

// The file's digest in hex, or an empty string when the algorithm or the file is unknown.
std::string digest(const std::string& algorithm, const std::string& path) {
    EVP_MD* md = EVP_MD_fetch(nullptr, algorithm.c_str(), nullptr);
    EVP_MD_CTX* context = EVP_MD_CTX_new();
    unsigned char value[EVP_MAX_MD_SIZE];
    unsigned int size = 0;
    bool ok = md && context && EVP_DigestInit_ex2(context, md, nullptr) == 1;
    if (!md) std::fprintf(stderr, "openssl-tool: unknown digest %s\n", algorithm.c_str());
    ok = ok && stream(path, [&](const unsigned char* data, size_t length) { return EVP_DigestUpdate(context, data, length) == 1; });
    ok = ok && EVP_DigestFinal_ex(context, value, &size) == 1;
    EVP_MD_CTX_free(context);
    EVP_MD_free(md);
    return ok ? hex(value, size) : "";
}

std::string hmac(const std::string& algorithm, const std::string& key, const std::string& path) {
    EVP_MAC* mac = EVP_MAC_fetch(nullptr, "HMAC", nullptr);
    EVP_MAC_CTX* context = mac ? EVP_MAC_CTX_new(mac) : nullptr;
    OSSL_PARAM params[] = {OSSL_PARAM_construct_utf8_string(OSSL_MAC_PARAM_DIGEST, const_cast<char*>(algorithm.c_str()), 0), OSSL_PARAM_construct_end()};
    unsigned char value[EVP_MAX_MD_SIZE];
    size_t size = 0;
    bool ok = context && EVP_MAC_init(context, reinterpret_cast<const unsigned char*>(key.data()), key.size(), params) == 1;
    if (!ok) std::fprintf(stderr, "openssl-tool: cannot make an HMAC with %s\n", algorithm.c_str());
    ok = ok && stream(path, [&](const unsigned char* data, size_t length) { return EVP_MAC_update(context, data, length) == 1; });
    ok = ok && EVP_MAC_final(context, value, &size, sizeof value) == 1;
    EVP_MAC_CTX_free(context);
    EVP_MAC_free(mac);
    return ok ? hex(value, size) : "";
}

int digestFiles(const std::string& algorithm, int count, char** paths) {
    int status = 0;
    for (int i = 0; i < count; i += 1) {
        const std::string value = digest(algorithm, paths[i]);
        if (value.empty()) status = 1;
        else std::printf("%s  %s\n", value.c_str(), paths[i]);
    }
    return status;
}

// Every line of the list is a SHA-256 in hex, two spaces (or a space and a star) and a file name.
int check(const std::string& list) {
    std::ifstream file(list);
    if (!file) {
        std::fprintf(stderr, "openssl-tool: cannot open %s\n", list.c_str());
        return 1;
    }
    int failed = 0;
    std::string line;
    while (std::getline(file, line)) {
        if (line.size() < 67 || line[64] != ' ') continue;
        const std::string expected = line.substr(0, 64);
        const std::string name = line.substr(66);
        const bool ok = digest("SHA256", name) == expected;
        std::printf("%s: %s\n", name.c_str(), ok ? "OK" : "FAILED");
        if (!ok) failed += 1;
    }
    if (failed) std::fprintf(stderr, "openssl-tool: WARNING: %d computed checksum%s did NOT match\n", failed, failed == 1 ? "" : "s");
    return failed ? 1 : 0;
}

// The key file's trailing line break is not part of the key, as with most secrets saved by editors.
int hmacFiles(const std::string& algorithm, const std::string& keyPath, int count, char** paths) {
    std::ifstream file(keyPath, std::ios::binary);
    if (!file) {
        std::fprintf(stderr, "openssl-tool: cannot open %s\n", keyPath.c_str());
        return 1;
    }
    std::stringstream text;
    text << file.rdbuf();
    std::string key = text.str();
    while (!key.empty() && (key.back() == '\n' || key.back() == '\r')) key.pop_back();
    int status = 0;
    for (int i = 0; i < count; i += 1) {
        const std::string value = hmac(algorithm, key, paths[i]);
        if (value.empty()) status = 1;
        else std::printf("%s  %s\n", value.c_str(), paths[i]);
    }
    return status;
}

}  // namespace

int main(int argc, char** argv) {
    const std::string command = argc > 1 ? argv[1] : "";
    if (command == "digest" && argc >= 4) return digestFiles(argv[2], argc - 3, argv + 3);
    if (command == "check" && argc == 3) return check(argv[2]);
    if (command == "hmac" && argc >= 5) return hmacFiles(argv[2], argv[3], argc - 4, argv + 4);
    if (command == "version") {
        std::printf("%s\n", OpenSSL_version(OPENSSL_VERSION));
        return 0;
    }
    std::fprintf(stderr,
                 "usage: openssl-tool digest <algorithm> <file>...\n"
                 "       openssl-tool check <list>\n"
                 "       openssl-tool hmac <algorithm> <key file> <file>...\n"
                 "       openssl-tool version\n");
    return 2;
}
