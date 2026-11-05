#pragma once

// Foundation's values as the host takes them on iOS and macOS.
#import <Foundation/Foundation.h>

#include "crossbind/extension.h"

#include <string>

// Text in UTF-8, empty for none.
std::string textOf(NSString *text);
// A property list's value as a JSON value or bytes: a date as its ISO 8601 text, a URL and a UUID as theirs, and a set
// as an array; one deeper than the host reads JSON, beyond the first 10,000 values or of another kind, as null, and a
// member whose key is no text left out.
crossbind::Value valueOfPlist(id object);
// Bytes as lowercase hex, as a push token is told.
std::string hexOf(NSData *bytes);
