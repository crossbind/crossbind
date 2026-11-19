#ifndef _CONFEXTEND_I
#define _CONFEXTEND_I

%module CONFEXTEND

%{
#include <cstring>
#include "confextend.h"
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");

// A method %extend adds is a function of its own, which takes the object as `self`.
%extend ConfExtended {
    std::string greet(const std::string &other) { return $self->name() + " greets " + other; }
    std::string greetBoth(const std::string &other, ConfExtended *third) {
        return self->name() + " greets " + other + " and " + third->name();
    }
    // A const char* argument makes the bridge call the function through an adapter.
    int sizeWith(const char *text) { return self->size() + static_cast<int>(std::strlen(text)); }
    // An overload of a method the class has itself.
    int size(int extra) { return self->size() + extra; }
    static std::string kind() { return "extended"; }
}

%include "confextend.h"

// An instance of a template binds under the name %template gives it.
%template(ConfTemplateBoxInt) ConfTemplateBox<int>;
%template(confLargerInt) confLarger<int>;

#endif
