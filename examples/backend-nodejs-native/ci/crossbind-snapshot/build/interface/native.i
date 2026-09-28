#ifndef _NATIVE_I
#define _NATIVE_I

%module NATIVE

%{
#include "native.h"
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");

%include "native.h"

#endif
