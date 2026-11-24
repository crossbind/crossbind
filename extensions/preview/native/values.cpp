// The extension's pure parts: JSON read into the host's values, base64url in its one form, the forms a session's id, key,
// address and name take before any of them reaches a URL, a fetch or an origin, the links the app opens, and the
// account's words.
#include "preview.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string_view>

namespace preview {
namespace {

// An answer of a source on the network is read no deeper than this.
constexpr int MAX_DEPTH = 32;
constexpr int MAX_EXPONENT = 400;
constexpr std::string_view ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
constexpr std::size_t SESSION_ID_BYTES = 16;
constexpr std::size_t KEY_BYTES = 32;
constexpr std::size_t MAX_NAME_CHARACTERS = 64;
constexpr int MAX_PORT = 65535;
constexpr int MAX_LABEL = 63;
constexpr std::size_t MAX_HOST = 253;
constexpr std::size_t MAX_IPV6 = 39;

bool isDigit(char c) { return c >= '0' && c <= '9'; }
bool isHexDigit(char c) { return isDigit(c) || (c >= 'a' && c <= 'f'); }

class Reader {
public:
    explicit Reader(const std::string &text) : text_(text) {}

    Value document() {
        Value value = next();
        space();
        if (at_ != text_.size()) fail();
        return value;
    }

private:
    [[noreturn]] static void fail() { throw std::runtime_error("crossbind: the answer is no JSON"); }

    void space() {
        while (at_ < text_.size() && (text_[at_] == ' ' || text_[at_] == '\t' || text_[at_] == '\n' || text_[at_] == '\r')) at_ += 1;
    }

    bool takes(char c) {
        space();
        if (at_ >= text_.size() || text_[at_] != c) return false;
        at_ += 1;
        return true;
    }

    bool word(std::string_view expected) {
        if (text_.compare(at_, expected.size(), expected) != 0) return false;
        at_ += expected.size();
        return true;
    }

    Value next() {
        space();
        if (at_ >= text_.size()) fail();
        const char c = text_[at_];
        if (c == '{' || c == '[') {
            if (++depth_ > MAX_DEPTH) fail();
            Value value = c == '{' ? object() : array();
            depth_ -= 1;
            return value;
        }
        if (c == '"') return Value(string());
        if (word("true")) return Value(true);
        if (word("false")) return Value(false);
        if (word("null")) return Value();
        return Value(number());
    }

    Value object() {
        at_ += 1;
        Value::Object members;
        if (takes('}')) return Value(std::move(members));
        do {
            space();
            if (at_ >= text_.size() || text_[at_] != '"') fail();
            std::string key = string();
            if (!takes(':')) fail();
            members.emplace_back(std::move(key), next());
        } while (takes(','));
        if (!takes('}')) fail();
        return Value(std::move(members));
    }

    Value array() {
        at_ += 1;
        Value::Array items;
        if (takes(']')) return Value(std::move(items));
        do {
            items.push_back(next());
        } while (takes(','));
        if (!takes(']')) fail();
        return Value(std::move(items));
    }

    unsigned hex4() {
        if (at_ + 4 > text_.size()) fail();
        unsigned code = 0;
        for (int i = 0; i < 4; i += 1) {
            const char c = text_[at_++];
            code <<= 4;
            if (isDigit(c)) {
                code |= static_cast<unsigned>(c - '0');
            } else if (c >= 'a' && c <= 'f') {
                code |= static_cast<unsigned>(c - 'a' + 10);
            } else if (c >= 'A' && c <= 'F') {
                code |= static_cast<unsigned>(c - 'A' + 10);
            } else {
                fail();
            }
        }
        return code;
    }

    unsigned codePoint() {
        unsigned code = hex4();
        if (code >= 0xDC00 && code <= 0xDFFF) fail();
        if (code < 0xD800 || code > 0xDBFF) return code;
        if (!word("\\u")) fail();
        const unsigned low = hex4();
        if (low < 0xDC00 || low > 0xDFFF) fail();
        return 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
    }

    static void append(std::string &out, unsigned code) {
        if (code < 0x80) {
            out += static_cast<char>(code);
        } else if (code < 0x800) {
            out += static_cast<char>(0xC0 | (code >> 6));
            out += static_cast<char>(0x80 | (code & 0x3F));
        } else if (code < 0x10000) {
            out += static_cast<char>(0xE0 | (code >> 12));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (code >> 18));
            out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
    }

    std::string string() {
        at_ += 1;
        std::string out;
        for (;;) {
            if (at_ >= text_.size()) fail();
            const auto c = static_cast<unsigned char>(text_[at_++]);
            if (c == '"') return out;
            if (c < 0x20) fail();
            if (c != '\\') {
                out += static_cast<char>(c);
                continue;
            }
            if (at_ >= text_.size()) fail();
            const char escape = text_[at_++];
            switch (escape) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': append(out, codePoint()); break;
                default: fail();
            }
        }
    }

    bool digitAt() const { return at_ < text_.size() && isDigit(text_[at_]); }

    // JSON's number, read without the C library, whose reading follows the process's locale.
    double number() {
        const bool isNegative = text_[at_] == '-';
        if (isNegative) at_ += 1;
        if (!digitAt()) fail();
        double value = 0;
        if (text_[at_] == '0') {
            at_ += 1;
        } else {
            while (digitAt()) value = value * 10 + (text_[at_++] - '0');
        }
        if (at_ < text_.size() && text_[at_] == '.') {
            at_ += 1;
            if (!digitAt()) fail();
            for (double scale = 0.1; digitAt(); scale /= 10) value += (text_[at_++] - '0') * scale;
        }
        if (at_ < text_.size() && (text_[at_] == 'e' || text_[at_] == 'E')) {
            at_ += 1;
            const bool isSmaller = at_ < text_.size() && text_[at_] == '-';
            if (at_ < text_.size() && (text_[at_] == '-' || text_[at_] == '+')) at_ += 1;
            if (!digitAt()) fail();
            int exponent = 0;
            while (digitAt()) exponent = std::min(exponent * 10 + (text_[at_++] - '0'), MAX_EXPONENT);
            value *= std::pow(10.0, isSmaller ? -exponent : exponent);
        }
        return isNegative ? -value : value;
    }

    const std::string &text_;
    std::size_t at_ = 0;
    int depth_ = 0;
};

bool isPort(std::string_view port) {
    if (port.empty() || port.size() > 5 || port[0] == '0') return false;
    int value = 0;
    for (const char c : port) {
        if (!isDigit(c)) return false;
        value = value * 10 + (c - '0');
    }
    return value <= MAX_PORT;
}

// Four numbers as a URL writes them, each without a leading zero.
std::optional<std::vector<int>> ipv4Of(std::string_view host) {
    std::vector<int> parts;
    std::size_t from = 0;
    for (;;) {
        const std::size_t dot = host.find('.', from);
        const std::string_view part = host.substr(from, dot == std::string_view::npos ? std::string_view::npos : dot - from);
        if (part.empty() || part.size() > 3 || (part.size() > 1 && part[0] == '0')) return std::nullopt;
        int value = 0;
        for (const char c : part) {
            if (!isDigit(c)) return std::nullopt;
            value = value * 10 + (c - '0');
        }
        if (value > 255) return std::nullopt;
        parts.push_back(value);
        if (dot == std::string_view::npos) break;
        from = dot + 1;
    }
    if (parts.size() != 4) return std::nullopt;
    return parts;
}

bool isPrivateIpv4(const std::vector<int> &parts) {
    const int a = parts[0];
    const int b = parts[1];
    return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 100 && b >= 64 && b <= 127) || (a == 169 && b == 254);
}

// fc00::/7, in lower case with its first group whole, as a URL writes it.
bool isUniqueLocalIpv6(std::string_view address) {
    if (address.size() < 6 || address.size() > MAX_IPV6 || address[0] != 'f' || (address[1] != 'c' && address[1] != 'd')) return false;
    if (!isHexDigit(address[2]) || !isHexDigit(address[3]) || address[4] != ':') return false;
    int groups = 1;
    int digits = 0;
    bool isCompressed = false;
    for (std::size_t i = 0; i < address.size(); i += 1) {
        const char c = address[i];
        if (c == ':') {
            if (i + 1 < address.size() && address[i + 1] == ':') {
                if (isCompressed) return false;
                isCompressed = true;
            }
            groups += 1;
            digits = 0;
        } else if (!isHexDigit(c) || ++digits > 4) {
            return false;
        }
    }
    return groups <= 8;
}

// A name that ends in .local, in lower case, as a URL writes it.
bool isLocalName(std::string_view host) {
    constexpr std::string_view LOCAL = ".local";
    if (host.size() <= LOCAL.size() || host.size() > MAX_HOST || host.substr(host.size() - LOCAL.size()) != LOCAL) return false;
    int length = 0;
    char previous = '.';
    for (const char c : host) {
        if (c == '.') {
            if (length == 0 || previous == '-') return false;
            length = 0;
        } else if ((c >= 'a' && c <= 'z') || isDigit(c) || (c == '-' && length > 0)) {
            if (++length > MAX_LABEL) return false;
        } else {
            return false;
        }
        previous = c;
    }
    return length > 0 && previous != '-';
}

// A character a dialog's title may show: none of the controls, and none of Unicode's invisible marks of direction or
// format, by which a name could pass for another.
bool isShownCharacter(unsigned code) {
    if (code < 0x80) {
        return (code >= 'a' && code <= 'z') || (code >= 'A' && code <= 'Z') || (code >= '0' && code <= '9') || code == ' ' || code == '.'
               || code == '_' || code == '@' || code == '/' || code == '-';
    }
    if (code < 0xA0 || code == 0xAD || code == 0x61C || code == 0x180E) return false;
    if ((code >= 0x200B && code <= 0x200F) || (code >= 0x2028 && code <= 0x202E) || (code >= 0x2060 && code <= 0x206F)) return false;
    if (code == 0xFEFF || (code >= 0xFFF9 && code <= 0xFFFB) || (code >= 0xFDD0 && code <= 0xFDEF) || (code & 0xFFFE) == 0xFFFE) return false;
    return code < 0xE0000 || code > 0xE007F;
}

bool equalsFolded(std::string_view text, std::string_view lower) {
    if (text.size() != lower.size()) return false;
    for (std::size_t i = 0; i < text.size(); i += 1) {
        const char c = text[i] >= 'A' && text[i] <= 'Z' ? static_cast<char>(text[i] - 'A' + 'a') : text[i];
        if (c != lower[i]) return false;
    }
    return true;
}

}  // namespace

Value parseJson(const std::string &text) { return Reader(text).document(); }

std::string textOf(const Value &value) { return value.isString() ? value.asString() : std::string(); }

std::optional<int> integerOf(const Value &value) {
    if (!value.isNumber()) return std::nullopt;
    const double number = value.asNumber();
    if (number != std::floor(number) || std::abs(number) > 1e9) return std::nullopt;
    return static_cast<int>(number);
}

std::string toBase64url(const std::string &bytes) {
    std::string out;
    std::size_t i = 0;
    const auto at = [&bytes](std::size_t index) { return static_cast<std::uint32_t>(static_cast<unsigned char>(bytes[index])); };
    for (; i + 3 <= bytes.size(); i += 3) {
        const std::uint32_t n = (at(i) << 16) | (at(i + 1) << 8) | at(i + 2);
        out += {ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], ALPHABET[n & 63]};
    }
    if (bytes.size() - i == 1) {
        const std::uint32_t n = at(i) << 16;
        out += {ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63]};
    } else if (bytes.size() - i == 2) {
        const std::uint32_t n = (at(i) << 16) | (at(i + 1) << 8);
        out += {ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63]};
    }
    return out;
}

std::optional<std::string> fromBase64url(const std::string &text) {
    if (text.size() % 4 == 1) return std::nullopt;
    std::string out;
    std::uint32_t bits = 0;
    int count = 0;
    for (const char c : text) {
        const std::size_t value = ALPHABET.find(c);
        if (value == std::string_view::npos) return std::nullopt;
        bits = (bits << 6) | static_cast<std::uint32_t>(value);
        count += 6;
        if (count >= 8) {
            count -= 8;
            out += static_cast<char>((bits >> count) & 0xFF);
        }
    }
    // The one form that gives these bytes: the bits left over are zero.
    if (toBase64url(out) != text) return std::nullopt;
    return out;
}

bool isSessionId(const std::string &text) {
    const std::optional<std::string> bytes = text.size() == 22 ? fromBase64url(text) : std::nullopt;
    return bytes && bytes->size() == SESSION_ID_BYTES;
}

bool isKey(const std::string &text) {
    const std::optional<std::string> bytes = text.size() == 43 ? fromBase64url(text) : std::nullopt;
    return bytes && bytes->size() == KEY_BYTES;
}

// crossbind app preview's rule of where the app opens a dev server, a host and its port as a URL writes them: a private
// IPv4 address, an IPv6 one in fc00::/7, or a name that ends in .local.
bool isLocalAddress(const std::string &address) {
    const std::size_t colon = address.rfind(':');
    if (colon == std::string::npos || colon == 0 || !isPort(std::string_view(address).substr(colon + 1))) return false;
    const std::string_view host = std::string_view(address).substr(0, colon);
    if (host.front() == '[') return host.size() > 2 && host.back() == ']' && isUniqueLocalIpv6(host.substr(1, host.size() - 2));
    const std::optional<std::vector<int>> ipv4 = ipv4Of(host);
    if (ipv4) return isPrivateIpv4(*ipv4);
    return isLocalName(host);
}

// A project's name as crossbind cloud lists it, 1 to 64 letters, digits, spaces and ._@/-, read as UTF-8 and checked
// again here, since it titles the project's dialogs.
bool isListedName(const std::string &name) {
    static constexpr unsigned LEAST[] = {0, 0, 0x80, 0x800, 0x10000};
    std::size_t characters = 0;
    for (std::size_t i = 0; i < name.size();) {
        const auto lead = static_cast<unsigned char>(name[i]);
        const int length = lead < 0x80 ? 1 : (lead >> 5) == 0x6 ? 2 : (lead >> 4) == 0xE ? 3 : (lead >> 3) == 0x1E ? 4 : 0;
        if (length == 0 || i + length > name.size()) return false;
        unsigned code = length == 1 ? lead : lead & (0x7F >> length);
        for (int k = 1; k < length; k += 1) {
            const auto next = static_cast<unsigned char>(name[i + k]);
            if ((next & 0xC0) != 0x80) return false;
            code = (code << 6) | (next & 0x3F);
        }
        if (code < LEAST[length] || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF) || !isShownCharacter(code)) return false;
        characters += 1;
        i += length;
    }
    return characters >= 1 && characters <= MAX_NAME_CHARACTERS;
}

// Whether two secrets are one, in a time that tells nothing of where they differ.
bool isSameSecret(const std::string &given, const std::string &expected) {
    if (given.size() != expected.size()) return false;
    unsigned char differs = 0;
    for (std::size_t i = 0; i < given.size(); i += 1) differs |= static_cast<unsigned char>(given[i] ^ expected[i]);
    return differs == 0;
}

std::string hexOf(const std::string &bytes) {
    static constexpr char DIGITS[] = "0123456789abcdef";
    std::string out;
    for (const char c : bytes) {
        const auto byte = static_cast<unsigned char>(c);
        out += DIGITS[byte >> 4];
        out += DIGITS[byte & 15];
    }
    return out;
}

// A decoded path escaped again, as a URL's path holds it.
std::string escapedPath(const std::string &path) {
    static constexpr std::string_view KEPT = "-._~!$&'()*+,;=:@/";
    std::string out;
    for (const char c : path) {
        const auto byte = static_cast<unsigned char>(c);
        if ((byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') || isDigit(c) || KEPT.find(c) != std::string_view::npos) {
            out += c;
            continue;
        }
        char escaped[4];
        std::snprintf(escaped, sizeof escaped, "%%%02X", byte);
        out += escaped;
    }
    return out;
}

std::optional<std::string> linkedSession(const std::string &url) {
    const std::size_t query = url.find_first_of("?#");
    const std::string_view base = std::string_view(url).substr(0, query);
    constexpr std::string_view SITE = "https://crossbind.dev";
    const bool isScheme = equalsFolded(base, "dev.crossbind.app://open") || equalsFolded(base, "dev.crossbind.app://open/");
    const bool isSite = base.size() > SITE.size() && equalsFolded(base.substr(0, SITE.size()), SITE)
                        && (base.substr(SITE.size()) == "/open" || base.substr(SITE.size()) == "/open/");
    if (!isScheme && !isSite) return std::nullopt;
    if (query == std::string::npos || url[query] != '?') return std::string();
    const std::size_t fragment = url.find('#', query);
    const std::string_view parts = std::string_view(url).substr(query + 1, fragment == std::string::npos ? std::string::npos : fragment - query - 1);
    for (std::size_t from = 0; from <= parts.size();) {
        const std::size_t amp = parts.find('&', from);
        const std::string_view part = parts.substr(from, amp == std::string_view::npos ? std::string_view::npos : amp - from);
        if (part.substr(0, 2) == "s=") {
            const std::string session(part.substr(2));
            return isSessionId(session) ? session : std::string();
        }
        if (amp == std::string_view::npos) break;
        from = amp + 1;
    }
    return std::string();
}

std::string signedOutWords() {
    return "Sign in to open your projects. crossbind app preview lists each project it runs on the account it is signed in with.";
}

std::string emptyListWords(const std::string &account) {
    return "No preview runs as " + account + ". Run crossbind app preview in your project, signed in as " + account + " (crossbind login), and it shows here.";
}

std::string notListedWords(const std::string &account) {
    return "This preview is not on " + account + "'s list. It ended, or it runs as another account: sign in to the same account here and in crossbind app preview.";
}

std::string otherAccountWords(const std::string &where, const std::string &other, const std::string &account) {
    return where + " runs as " + other + ", and this app is signed in as " + account + ": sign in to the same account on both.";
}

}  // namespace preview
