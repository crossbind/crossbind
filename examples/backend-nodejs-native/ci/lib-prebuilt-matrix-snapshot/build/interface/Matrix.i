#ifndef _MATRIX_I
#define _MATRIX_I

%module MATRIX

%{
#include "Matrix.h"
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");

%include "Matrix.h"

#endif
