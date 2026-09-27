#pragma once

#include <cstdint>
#include <cstdio>
#include <string>

// A synthetic web-server access log with fixed 64-byte lines, so line N starts at byte (N - 1) * 64:
//   0123456 2026-01-01T08:34:23Z GET    /api/items/49264 200 0628ms
// Fields come from a 32-bit LCG, so this code and the Python reference that produced the expected
// values write the same bytes, and line N is the same whatever the log's length.
namespace accesslog {

constexpr int LINE_BYTES = 64;
constexpr uint32_t START = 1767225600u;  // 2026-01-01T00:00:00Z; four lines per second

// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
inline void civil(int64_t days, int& year, unsigned& month, unsigned& day) {
    days += 719468;
    const int64_t era = (days >= 0 ? days : days - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(days - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    day = doy - (153 * mp + 2) / 5 + 1;
    month = mp < 10 ? mp + 3 : mp - 9;
    year = static_cast<int>(yoe + era * 400 + (month <= 2 ? 1 : 0));
}

class Generator {
public:
    // Appends line `number` (1-based) to `out`; lines must be asked for in order.
    void line(int number, std::string& out) {
        const char* const methods[] = {"GET   ", "POST  ", "PUT   ", "DELETE"};
        const uint32_t pick = next() % 100;
        const char* method = methods[pick < 60 ? 0 : pick < 85 ? 1 : pick < 95 ? 2 : 3];
        const uint32_t item = next() % 100000;
        const uint32_t roll = next() % 100;
        const int status = roll < 88 ? 200 : roll < 94 ? 304 : roll < 98 ? 404 : 500;
        const uint32_t ms = next() % 3000;
        const int64_t time = static_cast<int64_t>(START) + (number - 1) / 4;
        int year = 0;
        unsigned month = 0, day = 0;
        civil(time / 86400, year, month, day);
        const int64_t second = time % 86400;
        char text[LINE_BYTES + 1];
        std::snprintf(text, sizeof text, "%07d %04d-%02u-%02uT%02d:%02d:%02dZ %s /api/items/%05u %03d %04ums\n", number, year, month, day,
                      static_cast<int>(second / 3600), static_cast<int>(second / 60 % 60), static_cast<int>(second % 60), method, item, status, ms);
        out.append(text, LINE_BYTES);
    }

private:
    uint32_t next() {
        state = state * 1664525u + 1013904223u;
        return state >> 8;
    }
    uint32_t state = 2026;
};

}  // namespace accesslog
