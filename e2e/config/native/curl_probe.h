#ifndef _CURL_PROBE_H
#define _CURL_PROBE_H

#include <string>

// curl_easy_perform cases against the server in e2e/config/curl-probe-server.mjs, one report
// line per case. run waits synchronously, which only a worker allows; run_JSPI suspends instead.
class CurlProbe {
public:
  static std::string run(std::string base, std::string deadUrl);
  static std::string run_JSPI(std::string base, std::string deadUrl);
};

#endif
