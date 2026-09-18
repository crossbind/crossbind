#ifndef _CROSSBIND_CONFORMANCE_CONFSTRINGS_H
#define _CROSSBIND_CONFORMANCE_CONFSTRINGS_H

#include <cctype>
#include <cstdlib>
#include <cstring>
#include <string>

// const char* is a string both ways (a handle still passes, NULL is null); char* and
// unsigned char* stay memory; std::string crosses by value; std::u16string carries bytes as
// code units 0-255.

inline const char *confStrVersion() { return "1.2.3"; }
inline const char *confStrEcho(const char *text) {
    static std::string kept;
    kept = text ? text : "(null)";
    return kept.c_str();
}
inline const char *confStrNull() { return nullptr; }
inline int confStrLength(const char *text) { return text ? static_cast<int>(std::strlen(text)) : -1; }
inline int confStrLengthConst(const char *const text) { return confStrLength(text); }
// A typedef of char is still a C string (expat's XML_LChar, glib's gchar).
typedef char ConfChar;
inline const ConfChar *confStrTypedef() { return "typedef"; }
inline int confStrTypedefLength(const ConfChar *text) { return confStrLength(text); }
inline int confStrLengthArray(const char text[]) { return confStrLength(text); }
inline char *confStrDup(const char *text) {
    if (!text) return nullptr;
    char *copy = static_cast<char *>(std::malloc(std::strlen(text) + 1));
    return std::strcpy(copy, text);
}
inline void confStrFree(char *text) { std::free(text); }
inline void confStrFill(char *buffer, int size) {
    for (int i = 0; i + 1 < size; ++i) buffer[i] = static_cast<char>('a' + i % 26);
    if (size > 0) buffer[size - 1] = 0;
}
inline int confStrFirstByte(const unsigned char *bytes) { return bytes ? bytes[0] : -1; }
inline std::string confStrUpper(const std::string &text) {
    std::string out = text;
    for (char &c : out) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return out;
}
inline std::u16string confStrBytes(int count) {
    std::u16string out;
    for (int i = 0; i < count; ++i) out.push_back(static_cast<char16_t>(250 + i));
    return out;
}
inline int confStrByteSum(const std::u16string &bytes) {
    int total = 0;
    for (char16_t unit : bytes) total += unit;
    return total;
}

class ConfStrBox {
public:
    explicit ConfStrBox(const char *name) : value(name ? name : "") {}
    const char *name() const { return value.c_str(); }
    void rename(const char *name) { value = name ? name : ""; }
    static const char *kind() { return "box"; }

private:
    std::string value;
};

#endif
