// The URLs an extension serves the page under /ext/<its name>/, which its route answers, and those of an origin an
// extension serves, which its handler answers (<crossbind/extension.h>): the whole body each gives, or a file the host
// reads, in the part a Range header asks for.
#include "crossbind/extension.h"
#include "host_core.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <fstream>
#include <system_error>
#include <thread>

namespace crossbind {

namespace app {

bool breaksHeaders(const std::string &text) { return text.find_first_of(std::string("\r\n\0", 3)) != std::string::npos; }

bool isToken(const std::string &name) {
    constexpr std::string_view MARKS = "!#$%&'*+-.^_`|~";
    return !name.empty() && std::all_of(name.begin(), name.end(), [&](unsigned char c) { return std::isalnum(c) || MARKS.find(static_cast<char>(c)) != std::string_view::npos; });
}

}  // namespace app

namespace {

using app::breaksHeaders;
using app::isToken;

// A video's player asks for the next part where one ends.
constexpr std::uint64_t MAX_RANGE_BYTES = 4 * 1024 * 1024;

std::vector<uint8_t> bytesOf(const std::string &text) { return std::vector<uint8_t>(text.begin(), text.end()); }

std::string lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

SchemeResponse textResponse(int status, const std::string &text) { return SchemeResponse{status, "text/plain; charset=utf-8", bytesOf(text)}; }

// Whether the path, joined to a folder, could lead out of it: a part "..", an empty part, which std::filesystem joins as
// a root, and on Windows a backslash or a colon, another separator, a drive's and a file's other streams.
bool leavesItsFolder(const std::string &path) {
#ifdef _WIN32
    if (path.find_first_of("\\:") != std::string::npos) return true;
#endif
    size_t start = 1;
    for (size_t at = 1; at <= path.size(); at += 1) {
        if (at < path.size() && path[at] != '/') continue;
        const size_t length = at - start;
        if ((length == 0 && at < path.size()) || (length == 2 && path.compare(start, 2, "..") == 0)) return true;
        start = at + 1;
    }
    return false;
}

// Whether the path has a part "..", which on Windows a backslash parts as well.
bool hasParentPart(const std::string &path) {
#ifdef _WIN32
    constexpr const char *SEPARATORS = "/\\";
#else
    constexpr const char *SEPARATORS = "/";
#endif
    for (size_t start = 0;;) {
        const size_t end = path.find_first_of(SEPARATORS, start);
        const size_t length = (end == std::string::npos ? path.size() : end) - start;
        if (length == 2 && path.compare(start, 2, "..") == 0) return true;
        if (end == std::string::npos) return false;
        start = end + 1;
    }
}

// What a Range header asks of a file of size bytes: the whole file for none, for several ranges and for one the host
// cannot read; a part, from start to end, both in it; or nothing the file holds.
struct ByteRange {
    enum class Kind { whole, part, unsatisfiable } kind = Kind::whole;
    std::uint64_t start = 0;
    std::uint64_t end = 0;
};

std::optional<std::uint64_t> numberOf(const std::string &digits) {
    if (digits.empty() || digits.size() > 19 || !std::all_of(digits.begin(), digits.end(), [](unsigned char c) { return std::isdigit(c); })) {
        return std::nullopt;
    }
    return std::stoull(digits);
}

ByteRange rangeOf(const std::string &header, std::uint64_t size) {
    constexpr std::string_view UNIT = "bytes=";
    if (header.compare(0, UNIT.size(), UNIT) != 0 || header.find(',') != std::string::npos) return {};
    const std::string spec = header.substr(UNIT.size());
    const size_t dash = spec.find('-');
    if (dash == std::string::npos) return {};
    const std::optional<std::uint64_t> first = numberOf(spec.substr(0, dash));
    const std::optional<std::uint64_t> last = numberOf(spec.substr(dash + 1));
    if (!first) {
        // The last n bytes.
        if (!last || dash != 0) return {};
        if (*last == 0 || size == 0) return {ByteRange::Kind::unsatisfiable};
        return {ByteRange::Kind::part, size - std::min(*last, size), size - 1};
    }
    if (dash + 1 < spec.size() && !last) return {};
    if (last && *last < *first) return {};
    if (*first >= size) return {ByteRange::Kind::unsatisfiable};
    return {ByteRange::Kind::part, *first, last ? std::min(*last, size - 1) : size - 1};
}

}  // namespace

struct Request::State {
    explicit State(Page page) : page(page) {}

    // Who answers it, as messages name them: the extension of a route, or a served origin.
    std::string owner;
    std::string method;
    std::string path;
    std::string query;
    // Their names in lower case.
    Headers headers;
    SchemeRespond respond;
    Page page;
    std::atomic<bool> isAnswered{false};

    bool answers() { return !isAnswered.exchange(true); }
    std::string header(std::string_view name) const {
        const std::string wanted = lower(std::string(name));
        for (const auto &[key, value] : headers) {
            if (key == wanted) return value;
        }
        return "";
    }
    // What a response throws here would end the app, so it is told instead.
    ~State() {
        if (!answers()) return;
        try {
            respond(textResponse(500, "crossbind: " + owner + " gave no answer to " + path));
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the answer to %s of %s failed: %s\n", path.c_str(), owner.c_str(), error.what());
        }
    }
};

namespace {

SchemeResponse fileResponse(const app::StateOf<Request> &request, const std::string &path) {
    const std::filesystem::path file = app::pathOf(path);
    std::error_code error;
    // A device, such as Windows' CON, or a pipe would hold the read up.
    const bool isFile = std::filesystem::is_regular_file(file, error);
    const std::uint64_t size = isFile ? std::filesystem::file_size(file, error) : 0;
    if (!isFile || error) return textResponse(404, "crossbind: " + request.owner + " has no file for " + request.path);
    const ByteRange range = rangeOf(request.header("range"), size);
    if (range.kind == ByteRange::Kind::unsatisfiable) {
        SchemeResponse refused = textResponse(416, "crossbind: the file of " + request.path + " holds no such range");
        refused.headers.emplace_back("Content-Range", "bytes */" + std::to_string(size));
        return refused;
    }
    SchemeResponse response{200, app::mimeTypeOf(file), {}};
    response.headers.emplace_back("Accept-Ranges", "bytes");
    const bool isHead = request.method == "HEAD";
    if (range.kind == ByteRange::Kind::whole) {
        if (isHead) {
            response.headers.emplace_back("Content-Length", std::to_string(size));
        } else {
            response.file = path;
            response.fileLength = size;
        }
        return response;
    }
    const std::uint64_t end = std::min(range.end, range.start + MAX_RANGE_BYTES - 1);
    response.status = 206;
    response.headers.emplace_back("Content-Range", "bytes " + std::to_string(range.start) + "-" + std::to_string(end) + "/" + std::to_string(size));
    if (isHead) {
        response.headers.emplace_back("Content-Length", std::to_string(end - range.start + 1));
        return response;
    }
    std::ifstream stream(file, std::ios::binary);
    response.body.resize(static_cast<size_t>(end - range.start + 1));
    stream.seekg(static_cast<std::streamoff>(range.start));
    stream.read(reinterpret_cast<char *>(response.body.data()), static_cast<std::streamsize>(response.body.size()));
    if (!stream) return textResponse(500, "crossbind: " + request.owner + " could not read the file of " + request.path);
    return response;
}

}  // namespace

const std::string &Request::method() const { return state_->method; }

const std::string &Request::path() const { return state_->path; }

const std::string &Request::query() const { return state_->query; }

std::string Request::header(std::string_view name) const { return state_->header(name); }

Page Request::page() const { return state_->page; }

void Request::respond(int status, const Headers &headers, std::string body) const {
    if (status < 200 || status > 599 || (status >= 300 && status < 400)) {
        throw std::invalid_argument("crossbind: a route answers with a status of 2xx, 4xx or 5xx, which a webview takes, not " + std::to_string(status));
    }
    for (const auto &[name, value] : headers) {
        if (!isToken(name) || breaksHeaders(value)) throw std::invalid_argument("crossbind: a route's header " + name + " is no header's name and value");
    }
    if (!state_->answers()) return;
    SchemeResponse response{status, "application/octet-stream", {}};
    for (const auto &[name, value] : headers) {
        if (lower(name) == "content-type") {
            response.mime = value;
        } else {
            response.headers.emplace_back(name, value);
        }
    }
    if (state_->method == "HEAD") {
        response.headers.emplace_back("Content-Length", std::to_string(body.size()));
    } else {
        response.body = bytesOf(body);
    }
    state_->respond(std::move(response));
}

void Request::respondFile(const std::string &path) const {
    if (!state_->answers()) return;
    try {
        std::thread([state = state_, path] {
            try {
                state->respond(fileResponse(*state, path));
            } catch (const std::exception &error) {
                state->respond(textResponse(500, error.what()));
            }
        }).detach();
    } catch (const std::system_error &error) {
        state_->respond(textResponse(500, std::string("crossbind: the host could not read the file: ") + error.what()));
    }
}

namespace app {

namespace {

// 405, saying why, for another method than GET and HEAD.
std::optional<SchemeResponse> methodRefusal(const std::string &method, const std::string &why) {
    if (method == "GET" || method == "HEAD") return std::nullopt;
    SchemeResponse refused = textResponse(405, why);
    refused.headers.emplace_back("Allow", "GET, HEAD");
    return refused;
}

// What the host answers itself of a request for a route: 400 for a path that could leave a folder, else methodRefusal().
std::optional<SchemeResponse> refusalOf(const std::string &path, const std::string &method, const std::string &why) {
    if (leavesItsFolder(path)) return textResponse(400, "crossbind: the path of a route's URL has no part \"..\", no empty part and, on Windows, no \\ or :");
    return methodRefusal(method, why);
}

// And of a served origin's, whose handler gets every path its source names but one with a part "..": a dev server's
// colons, backslashes and empty parts among them.
std::optional<SchemeResponse> originRefusalOf(const std::string &path, const std::string &method, const std::string &why) {
    if (hasParentPart(path)) return textResponse(400, "crossbind: the path of a served origin's URL has no part \"..\"");
    return methodRefusal(method, why);
}

// Hands a request to its owner's route or handler, which answers it on the thread the webview asks on.
void answerRequest(const std::string &owner, std::string path, const std::function<void(Request)> &fn, SchemeRequest request, SchemeRespond respond) {
    auto state = std::make_shared<StateOf<Request>>(app::pageOf(request.webView));
    state->owner = owner;
    state->method = std::move(request.method);
    state->path = std::move(path);
    state->query = std::move(request.query);
    for (auto &[name, value] : request.headers) state->headers.emplace_back(lower(name), std::move(value));
    state->respond = std::move(respond);
    try {
        fn(make<Request>(state));
    } catch (const std::exception &error) {
        if (state->answers()) state->respond(textResponse(500, error.what()));
    } catch (...) {
        if (state->answers()) state->respond(textResponse(500, "crossbind: " + owner + " failed on " + state->path));
    }
}

}  // namespace

void serveRoute(SchemeRequest request, SchemeRespond respond) {
    // "/ext/", the extension's name and the path of its own that follows it.
    constexpr size_t NAME_AT = 5;
    const size_t slash = request.path.find('/', NAME_AT);
    const std::string extension = request.path.substr(NAME_AT, slash == std::string::npos ? std::string::npos : slash - NAME_AT);
    std::string path = slash == std::string::npos ? "/" : request.path.substr(slash);
    if (auto refused = refusalOf(path, request.method, "crossbind: a route answers GET and HEAD alone; a call of the app's functions takes what the page sends")) {
        respond(std::move(*refused));
        return;
    }
    const std::function<void(Request)> *route = routeOf(extension);
    if (!route) {
        respond(textResponse(404, "crossbind: no extension of the app serves /ext/" + extension + "/"));
        return;
    }
    answerRequest("the extension " + extension, std::move(path), *route, std::move(request), std::move(respond));
}

void answerOriginRequest(const std::string &name, std::function<void(Request)> handler, SchemeRequest request, SchemeRespond respond) {
    if (auto refused = originRefusalOf(request.path, request.method, "crossbind: the origin " + name + " answers GET and HEAD alone")) {
        respond(std::move(*refused));
        return;
    }
    std::string path = request.path;
    answerRequest("the origin " + name, std::move(path), handler, std::move(request), std::move(respond));
}

}  // namespace app

}  // namespace crossbind
