#include "native.h"

#include <thread>

#include <emscripten.h>
#include <emscripten/wasmfs.h>

#include <arpa/inet.h>
#include <assert.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static std::string threadResult = "";

std::vector<std::string> Native::listVirtualFiles() {
  std::vector<std::string> files;

  DIR *dir = opendir("/opfs");
  if (!dir) {
    return files;
  }

  struct dirent *entry;
  while ((entry = readdir(dir)) != nullptr) {
    std::string name = entry->d_name;

    if (name != "." && name != "..") {
      files.push_back(name);
    }
  }

  closedir(dir);
  return files;
}

void Native::runOnThread() {
  std::thread t([]() { threadResult = "hello from thread"; });
  t.join();
}

std::string Native::getThreadResult() { return threadResult; }

Counter::Counter(int start) : value(start) {}

std::shared_ptr<Counter> Counter::create(int start) {
  return std::make_shared<Counter>(start);
}

int Counter::increment(int by) {
  value += by;
  return value;
}

int Counter::current() { return value; }

std::string Counter::describe(std::string prefix) {
  return prefix + ":" + std::to_string(value);
}

std::string Counter::joinTags(std::vector<std::string> tags) {
  std::string out;
  for (size_t i = 0; i < tags.size(); i++) {
    if (i) out += "+";
    out += tags[i];
  }
  return out;
}
