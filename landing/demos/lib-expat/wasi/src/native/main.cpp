// A command-line XML summary for WASI:
//   xml-stats <file>...
// Each file streams through Expat in 64 KiB reads (XML_GetBuffer, XML_ParseBuffer), so any size
// fits. Well-formed files get their size, element and attribute counts, depth and most common
// elements; the first error ends that file with Expat's message and position, and the exit code 1.
#include <expat.h>

#include <algorithm>
#include <cstdio>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace {

struct Stats {
    std::map<std::string, long long> elements;
    long long attributes = 0;
    int depth = 0;
    int maxDepth = 0;
};

void XMLCALL onStart(void* data, const XML_Char* name, const XML_Char** atts) {
    Stats& stats = *static_cast<Stats*>(data);
    stats.elements[name] += 1;
    for (int i = 0; atts[i]; i += 2) stats.attributes += 1;
    stats.maxDepth = std::max(stats.maxDepth, ++stats.depth);
}

void XMLCALL onEnd(void* data, const XML_Char*) { static_cast<Stats*>(data)->depth -= 1; }

const char* plural(long long count) { return count == 1 ? "" : "s"; }

bool summarize(const char* path) {
    std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path, "rb"), std::fclose);
    if (!file) {
        std::fprintf(stderr, "%s: cannot open\n", path);
        return false;
    }
    std::unique_ptr<XML_ParserStruct, void (*)(XML_Parser)> parser(XML_ParserCreate(nullptr), XML_ParserFree);
    if (!parser) {
        std::fprintf(stderr, "out of memory\n");
        return false;
    }
    Stats stats;
    XML_SetUserData(parser.get(), &stats);
    XML_SetElementHandler(parser.get(), onStart, onEnd);

    long long bytes = 0;
    for (bool last = false; !last;) {
        void* buffer = XML_GetBuffer(parser.get(), 1 << 16);
        if (!buffer) {
            std::fprintf(stderr, "out of memory\n");
            return false;
        }
        const size_t got = std::fread(buffer, 1, 1 << 16, file.get());
        last = got == 0;
        bytes += static_cast<long long>(got);
        if (XML_ParseBuffer(parser.get(), static_cast<int>(got), last) != XML_STATUS_OK) {
            std::fprintf(stderr, "%s: %s at line %lu, column %lu\n", path, XML_ErrorString(XML_GetErrorCode(parser.get())),
                         static_cast<unsigned long>(XML_GetCurrentLineNumber(parser.get())), static_cast<unsigned long>(XML_GetCurrentColumnNumber(parser.get())));
            return false;
        }
    }

    std::vector<std::pair<std::string, long long>> top(stats.elements.begin(), stats.elements.end());
    std::sort(top.begin(), top.end(), [](const auto& a, const auto& b) { return a.second != b.second ? a.second > b.second : a.first < b.first; });
    long long total = 0;
    for (const auto& entry : top) total += entry.second;
    std::printf("%s: %lld bytes of well-formed XML (%s)\n", path, bytes, XML_ExpatVersion());
    std::printf("%lld element%s, %lld attribute%s, nested %d deep\n", total, plural(total), stats.attributes, plural(stats.attributes), stats.maxDepth);
    for (size_t i = 0; i < top.size() && i < 5; i += 1) std::printf("%s %lld\n", top[i].first.c_str(), top[i].second);
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: xml-stats <file>...\n");
        return 2;
    }
    bool ok = true;
    for (int i = 1; i < argc; i += 1) ok = summarize(argv[i]) && ok;
    return ok ? 0 : 1;
}
