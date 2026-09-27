// A trurl-style URL tool on libcurl's URL API, for WASI. It parses a URL with the flags libcurl uses
// for CURLOPT_URL, then --follow resolves a Location header against it the way curl follows a
// redirect and --append adds a URL-encoded query pair. It prints the URL and its parts and opens no
// connection.
//   url-tool <url> [--follow <location>] [--append <name=value>]...
#include <curl/curl.h>

#include <cstdio>
#include <cstring>
#include <string>

namespace {

constexpr unsigned int TRANSFER = CURLU_GUESS_SCHEME | CURLU_NON_SUPPORT_SCHEME;
constexpr unsigned int REDIRECT = CURLU_URLENCODE | CURLU_ALLOW_SPACE;

int usage() {
    std::fprintf(stderr, "usage: url-tool <url> [--follow <location>] [--append <name=value>]...\n");
    return 2;
}

// Adds "name=value" for a part the URL has, nothing for one it lacks.
void part(std::string& line, CURLU* url, const char* name, CURLUPart which, unsigned int flags) {
    char* value = nullptr;
    if (curl_url_get(url, which, &value, flags) != CURLUE_OK) return;
    line += (line.empty() ? "" : " ") + std::string(name) + "=" + value;
    curl_free(value);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2 || argc % 2 != 0) return usage();
    for (int i = 2; i < argc; i += 2) {
        if (std::strcmp(argv[i], "--follow") != 0 && std::strcmp(argv[i], "--append") != 0) return usage();
    }
    CURLU* url = curl_url();
    if (!url) return 1;
    CURLUcode code = curl_url_set(url, CURLUPART_URL, argv[1], TRANSFER);
    for (int i = 2; code == CURLUE_OK && i < argc; i += 2) {
        code = std::strcmp(argv[i], "--follow") == 0 ? curl_url_set(url, CURLUPART_URL, argv[i + 1], REDIRECT)
                                                     : curl_url_set(url, CURLUPART_QUERY, argv[i + 1], CURLU_APPENDQUERY | CURLU_URLENCODE);
    }
    char* whole = nullptr;
    if (code == CURLUE_OK) code = curl_url_get(url, CURLUPART_URL, &whole, 0);
    if (code != CURLUE_OK) {
        std::fprintf(stderr, "url-tool: %s\n", curl_url_strerror(code));
        curl_url_cleanup(url);
        return 1;
    }
    std::printf("%s\n", whole);
    curl_free(whole);
    std::string parts;
    part(parts, url, "scheme", CURLUPART_SCHEME, 0);
    part(parts, url, "user", CURLUPART_USER, 0);
    part(parts, url, "host", CURLUPART_HOST, 0);
    part(parts, url, "port", CURLUPART_PORT, CURLU_DEFAULT_PORT);
    part(parts, url, "path", CURLUPART_PATH, 0);
    part(parts, url, "query", CURLUPART_QUERY, 0);
    part(parts, url, "fragment", CURLUPART_FRAGMENT, 0);
    std::printf("%s\n", parts.c_str());
    curl_url_cleanup(url);
    return 0;
}
