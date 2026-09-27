#pragma once

#include <cctype>
#include <cstdint>
#include <string>
#include <vector>

// The data every zstd app works on: GitHub-API-shaped user records drawn from a 32-bit LCG, so the
// same bytes come out in C++, in the page and in the Python reference that produced the expected
// numbers. Two thousand records joined with '\n' hash to
// a4789874b0fb84f31600c6ae2d7ab219567bf4de44a6c7d6a7779ad66e3722ca (SHA-256).
namespace corpus {

class Lcg {
public:
    explicit Lcg(uint32_t seed) : state(seed) {}
    uint32_t next() {
        state = state * 1664525u + 1013904223u;
        return state;
    }

private:
    uint32_t state;
};

inline std::vector<std::string> users(int count, uint32_t seed = 2026) {
    static const char* const first[] = {"ada", "alan", "grace", "linus", "margaret", "dennis", "ken", "barbara", "edsger", "donald", "frances", "john"};
    static const char* const cities[] = {"Istanbul", "Berlin", "Tokyo", "Lagos", "Lima", "Oslo", "Austin", "Pune", "Seoul", "Porto"};
    static const char* const languages[] = {"C", "C++", "Rust", "Go", "TypeScript", "Python", "Zig", "Kotlin"};
    Lcg random(seed);
    std::vector<std::string> records;
    records.reserve(static_cast<size_t>(count));
    for (int index = 0; index < count; index += 1) {
        const std::string name = first[random.next() % 12];
        const std::string login = name + std::to_string(random.next() % 10000);
        const std::string city = cities[random.next() % 10];
        const std::string language = languages[random.next() % 8];
        const uint32_t followers = random.next() % 50000;
        const uint32_t repos = random.next() % 300;
        const uint32_t created = 1200000000u + random.next() % 600000000u;
        const bool hireable = random.next() % 3 == 0;
        const std::string id = std::to_string(1000 + index);
        std::string display = name;
        display[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(display[0])));
        records.push_back(
            "{\"login\":\"" + login + "\",\"id\":" + id + ",\"node_id\":\"MDQ6VXNlcj" + id +
            "\",\"avatar_url\":\"https://avatars.example.com/u/" + id + "?v=4\",\"url\":\"https://api.example.com/users/" + login +
            "\",\"html_url\":\"https://example.com/" + login + "\",\"followers_url\":\"https://api.example.com/users/" + login +
            "/followers\",\"repos_url\":\"https://api.example.com/users/" + login +
            "/repos\",\"type\":\"User\",\"site_admin\":false,\"name\":\"" + display + "\",\"company\":null,\"blog\":\"\",\"location\":\"" + city +
            "\",\"email\":null,\"hireable\":" + (hireable ? "true" : "false") + ",\"bio\":\"Writes " + language +
            ".\",\"public_repos\":" + std::to_string(repos) + ",\"followers\":" + std::to_string(followers) +
            ",\"created_at\":" + std::to_string(created) + "}");
    }
    return records;
}

// Records as a newline-terminated document, the shape a JSON-lines export has.
inline std::string lines(const std::vector<std::string>& records) {
    std::string document;
    for (const std::string& record : records) document += record + "\n";
    return document;
}

}  // namespace corpus
