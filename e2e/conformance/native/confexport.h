#ifndef _CROSSBIND_CONFORMANCE_CONFEXPORT_H
#define _CROSSBIND_CONFORMANCE_CONFEXPORT_H

// An export macro defined away from the header that uses it, like zconf.h's ZEXPORT or
// cpl_port.h's CPL_DLL: SWIG never follows this include, so crossbind's macro prelude has to
// forward CONF_API for conftypes.h to parse.
#define CONF_API __attribute__((visibility("default")))

#endif
