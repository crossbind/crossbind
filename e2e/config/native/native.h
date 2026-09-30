#ifndef _NATIVE_H
#define _NATIVE_H

#include <dirent.h>
#include <memory>
#include <string>
#include <vector>

class Native {
public:
  static void runOnThread();
  static std::string getThreadResult();

  static std::vector<std::string> listVirtualFiles();
};

// Instance-method coverage: statics never go through embind's `this`
// conversion, so only a class like this exercises the worker proxy's
// identity handling (and vector-parameter coercion) end to end.
class Counter {
public:
  Counter(int start);
  static std::shared_ptr<Counter> create(int start);

  int increment(int by);
  int current();
  std::string describe(std::string prefix);
  std::string joinTags(std::vector<std::string> tags);

private:
  int value;
};

#endif
