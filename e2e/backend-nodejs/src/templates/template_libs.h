#ifndef _TEMPLATE_LIBS_H
#define _TEMPLATE_LIBS_H

#include <string>

#include <crossbind-lib-samplebasic/samplebasic.h>
#include <crossbind-lib-samplebasic-cmake/samplebasiccmake.h>

// The lib-source and lib-cmake templates, called as an app built against them calls them.
class TemplateLibs {
public:
  static std::string source() { return SampleBasic::sample(); }
  static std::string cmake() { return SampleBasicCmake::sample(); }
};

#endif
