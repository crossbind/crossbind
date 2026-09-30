#include "curl_probe.h"

#include <curl/curl.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>

namespace {

constexpr long kTimeoutMs = 300;
constexpr size_t kLongMethod = 40;
constexpr auto kCancelAfter = std::chrono::milliseconds(200);

using Setup = std::function<void(CURL *)>;

struct Response {
  std::string body;
  std::string headers;
  size_t writes = 0;
  size_t largest = 0;
  size_t limit = SIZE_MAX; // bytes the body callback accepts before it short-writes
};

struct Outcome {
  CURLcode rc = CURLE_OK;
  long code = 0;
  std::string err;
};

struct Upload {
  std::string data;
  size_t offset = 0;
};

size_t onBody(char *data, size_t size, size_t count, void *userp) {
  Response *res = static_cast<Response *>(userp);
  size_t len = size * count;
  res->writes++;
  res->largest = std::max(res->largest, len);
  if (res->body.size() + len > res->limit) return 0;
  res->body.append(data, len);
  return len;
}

size_t onHeader(char *data, size_t size, size_t count, void *userp) {
  static_cast<Response *>(userp)->headers.append(data, size * count);
  return size * count;
}

size_t onRead(char *buf, size_t size, size_t count, void *userp) {
  Upload *up = static_cast<Upload *>(userp);
  size_t len = std::min(size * count, up->data.size() - up->offset);
  memcpy(buf, up->data.data() + up->offset, len);
  up->offset += len;
  return len;
}

Outcome perform(CURL *curl, Response &res) {
  char err[CURL_ERROR_SIZE] = "";
  Outcome out;
  curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, err);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, onBody);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &res);
  out.rc = curl_easy_perform(curl);
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &out.code);
  curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, nullptr);
  out.err = err;
  return out;
}

Outcome transfer(const std::string &url, Response &res, const Setup &setup = nullptr) {
  CURL *curl = curl_easy_init();
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  if (setup) setup(curl);
  Outcome out = perform(curl, res);
  curl_easy_cleanup(curl);
  return out;
}

std::string status(const Outcome &out) {
  return "rc=" + std::to_string(out.rc) + " code=" + std::to_string(out.code);
}

std::string withError(const Outcome &out) { return status(out) + " err=" + out.err; }

std::string bodyLine(const std::string &url, const Setup &setup = nullptr) {
  Response res;
  std::string line = status(transfer(url, res, setup));
  return res.body.empty() ? line : line + " " + res.body;
}

std::string errorLine(const std::string &url, const Setup &setup = nullptr) {
  Response res;
  return withError(transfer(url, res, setup));
}

std::string headerSummary(std::string headers) {
  std::transform(headers.begin(), headers.end(), headers.begin(),
                 [](unsigned char c) { return std::tolower(c); });
  bool statusLine = headers.rfind("http/1.1 200 ", 0) == 0;
  bool reply = headers.find("\r\nx-reply: yes\r\n") != std::string::npos;
  bool end = headers.size() >= 4 && headers.compare(headers.size() - 4, 4, "\r\n\r\n") == 0;
  return std::string(statusLine ? "status" : "-") + "," + (reply ? "reply" : "-") + "," +
         (end ? "end" : "-");
}

std::string hostPart(const std::string &base) { return base.substr(base.find("://") + 3); }

std::string getWithHeaders(const std::string &base) {
  Response res;
  curl_slist *list = curl_slist_append(nullptr, "X-Probe: one");
  list = curl_slist_append(list, "X-Empty;");
  list = curl_slist_append(list, "X-Removed:");
  Outcome out = transfer(base + "/echo", res, [&](CURL *curl) {
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, list);
    curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, onHeader);
    curl_easy_setopt(curl, CURLOPT_HEADERDATA, &res);
  });
  curl_slist_free_all(list);
  return status(out) + " " + res.body + " headers=" + headerSummary(res.headers);
}

std::string headRequest(const std::string &base) {
  Response res;
  Outcome out = transfer(base + "/echo", res,
                         [](CURL *curl) { curl_easy_setopt(curl, CURLOPT_NOBODY, 1L); });
  return status(out) + " bytes=" + std::to_string(res.body.size());
}

// curl hands the headers over before it fails on the status.
std::string failOnError(const std::string &base) {
  Response res;
  Outcome out = transfer(base + "/missing", res, [&](CURL *curl) {
    curl_easy_setopt(curl, CURLOPT_FAILONERROR, 1L);
    curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, onHeader);
    curl_easy_setopt(curl, CURLOPT_HEADERDATA, &res);
  });
  return withError(out) + " writes=" + std::to_string(res.writes) +
         " status=" + res.headers.substr(0, res.headers.find("\r\n"));
}

std::string maxFileSize(const std::string &base) {
  Response res;
  Outcome out = transfer(base + "/big", res,
                         [](CURL *curl) { curl_easy_setopt(curl, CURLOPT_MAXFILESIZE, 10L); });
  return withError(out) + " bytes=" + std::to_string(res.body.size());
}

std::string bigBody(const std::string &base) {
  Response res;
  Outcome out = transfer(base + "/big", res);
  return status(out) + " bytes=" + std::to_string(res.body.size()) +
         " writes=" + std::to_string(res.writes) + " largest=" + std::to_string(res.largest);
}

std::string shortWrite(const std::string &base) {
  Response res;
  res.limit = 0;
  return withError(transfer(base + "/big", res));
}

std::string mimePost(const std::string &base) {
  Response res;
  curl_mime *mime = nullptr;
  Outcome out = transfer(base + "/echo", res, [&](CURL *curl) {
    mime = curl_mime_init(curl);
    curl_mimepart *part = curl_mime_addpart(mime);
    curl_mime_name(part, "field");
    curl_mime_data(part, "value", CURL_ZERO_TERMINATED);
    curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);
  });
  curl_mime_free(mime);
  return withError(out);
}

// The second transfer on the handle must report its own code and error message.
std::string reusedHandle(const std::string &base, const std::string &deadUrl) {
  CURL *curl = curl_easy_init();
  Response first;
  Response second;
  curl_easy_setopt(curl, CURLOPT_URL, deadUrl.c_str());
  Outcome a = perform(curl, first);
  curl_easy_setopt(curl, CURLOPT_URL, (base + "/missing").c_str());
  curl_easy_setopt(curl, CURLOPT_FAILONERROR, 1L);
  Outcome b = perform(curl, second);
  curl_easy_cleanup(curl);
  return "first=" + std::to_string(a.rc) + " second=" + std::to_string(b.rc) +
         " code=" + std::to_string(b.code) + " err=" + b.err;
}

struct Progress {
  int calls = 0;
  curl_off_t dlnow = 0;
  curl_off_t dltotal = 0;
};

int onProgress(void *userp, curl_off_t dltotal, curl_off_t dlnow, curl_off_t, curl_off_t) {
  Progress *p = static_cast<Progress *>(userp);
  p->calls++;
  p->dlnow = dlnow;
  p->dltotal = dltotal;
  return 0;
}

int onAbort(void *, curl_off_t, curl_off_t, curl_off_t, curl_off_t) { return 1; }

int onDeadline(void *userp, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
  auto start = *static_cast<std::chrono::steady_clock::time_point *>(userp);
  return std::chrono::steady_clock::now() - start >= kCancelAfter ? 1 : 0;
}

void watch(CURL *curl, curl_xferinfo_callback cb, void *userp) {
  curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
  curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, cb);
  curl_easy_setopt(curl, CURLOPT_XFERINFODATA, userp);
}

std::string progressValues(const std::string &base) {
  Response res;
  Progress p;
  Outcome out = transfer(base + "/big", res, [&](CURL *curl) { watch(curl, onProgress, &p); });
  return status(out) + " calls=" + (p.calls ? "some" : "none") + " last=" + std::to_string(p.dlnow) +
         "/" + std::to_string(p.dltotal);
}

// The callback cancels while the transfer waits for a slow response. A worker's synchronous
// request cannot be interrupted, so there the body arrives before the callback can cancel.
std::string cancelSlow(const std::string &base) {
  Response res;
  auto start = std::chrono::steady_clock::now();
  Outcome out = transfer(base + "/slow", res, [&](CURL *curl) { watch(curl, onDeadline, &start); });
  return withError(out) + " bytes=" + std::to_string(res.body.size());
}

// curl's own engine cannot run in the wasm build: its multi handle needs a socketpair.
std::string multiHandle() {
  CURLM *multi = curl_multi_init();
  curl_multi_cleanup(multi);
  return multi ? "handle" : "null";
}

void requestCases(std::string &out, const std::string &base) {
  static const char fields[] = {'a', '\0', 'b'};
  Upload upload{"put-body"};
  auto add = [&out](const char *name, const std::string &line) {
    out += std::string(name) + ": " + line + "\n";
  };
  add("get", getWithHeaders(base));
  add("post", bodyLine(base + "/echo", [](CURL *curl) {
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, fields);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(sizeof(fields)));
      }));
  add("put", bodyLine(base + "/echo", [&](CURL *curl) {
        curl_easy_setopt(curl, CURLOPT_UPLOAD, 1L);
        curl_easy_setopt(curl, CURLOPT_READFUNCTION, onRead);
        curl_easy_setopt(curl, CURLOPT_READDATA, &upload);
      }));
  add("method", bodyLine(base + "/echo", [](CURL *curl) {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "MKCALENDAR");
      }));
  add("longmethod", errorLine(base + "/echo", [](CURL *curl) {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, std::string(kLongMethod, 'X').c_str());
      }));
  add("range", bodyLine(base + "/echo", [](CURL *curl) {
        curl_easy_setopt(curl, CURLOPT_RANGE, "0-3");
      }));
  add("userpwd", bodyLine(base + "/echo", [](CURL *curl) {
        curl_easy_setopt(curl, CURLOPT_USERPWD, "user:pass");
      }));
  add("urlcreds", bodyLine("http://u%40x:p%3Ay@" + hostPart(base) + "/echo"));
  add("noscheme", bodyLine(hostPart(base) + "/echo"));
  add("utf8query", bodyLine(base + "/path?q=\xc3\xbc"));
  add("head", headRequest(base));
}

void responseCases(std::string &out, const std::string &base, const std::string &deadUrl) {
  auto add = [&out](const char *name, const std::string &line) {
    out += std::string(name) + ": " + line + "\n";
  };
  add("failonerror", failOnError(base));
  add("missing", bodyLine(base + "/missing"));
  add("dead", errorLine(deadUrl));
  add("big", bigBody(base));
  add("maxfilesize", maxFileSize(base));
  add("shortwrite", shortWrite(base));
  add("mime", mimePost(base));
  add("reuse", reusedHandle(base, deadUrl));
  add("timeout", bodyLine(base + "/slow", [](CURL *curl) {
        curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, kTimeoutMs);
      }));
  add("file", errorLine("file:///tmp/curl-probe.txt"));
  add("badurl", errorLine("http://exa mple.com/"));
  add("multi", multiHandle());
}

void progressCases(std::string &out, const std::string &base) {
  auto add = [&out](const char *name, const std::string &line) {
    out += std::string(name) + ": " + line + "\n";
  };
  add("progress", progressValues(base));
  add("abort", errorLine(base + "/echo", [](CURL *curl) { watch(curl, onAbort, nullptr); }));
  add("cancel", cancelSlow(base));
}

std::string report(const std::string &base, const std::string &deadUrl) {
  std::string out;
  requestCases(out, base);
  responseCases(out, base, deadUrl);
  progressCases(out, base);
  return out;
}

} // namespace

std::string CurlProbe::run(std::string base, std::string deadUrl) { return report(base, deadUrl); }

std::string CurlProbe::run_JSPI(std::string base, std::string deadUrl) {
  return report(base, deadUrl);
}
