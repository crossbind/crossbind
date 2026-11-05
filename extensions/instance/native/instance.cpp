// A desktop app kept to one instance: the launch as one instance hands it to another, and the entry, which takes the
// app's launches and leaves as the app quits.
#include "instance.h"

#include <cstdio>
#include <stdexcept>
#include <vector>

namespace crossbind::instance {

namespace {
// Names the format, which another version of the app may not share.
constexpr std::string_view LAUNCH_TAG = "crossbind launch 1\n";
}  // namespace

// The tag, the size of the rest, and the token, the folder and the arguments joined by NULs, which no argument holds.
std::string encodeLaunch(const Launch &launch) {
    std::string parts = launch.token + '\0' + launch.cwd;
    for (const auto &arg : launch.args) (parts += '\0') += arg;
    return std::string(LAUNCH_TAG) + std::to_string(parts.size()) + '\n' + parts;
}

std::optional<Launch> decodeLaunch(std::string_view bytes) {
    if (bytes.size() > MAX_LAUNCH || !bytes.starts_with(LAUNCH_TAG)) return std::nullopt;
    bytes.remove_prefix(LAUNCH_TAG.size());
    const size_t size = bytes.find('\n');
    // A launch whose process was killed while it wrote is shorter than it says.
    if (size == std::string_view::npos || bytes.substr(0, size) != std::to_string(bytes.size() - size - 1)) return std::nullopt;
    bytes.remove_prefix(size + 1);
    std::vector<std::string> parts;
    for (size_t start = 0;;) {
        const size_t end = bytes.find('\0', start);
        parts.emplace_back(bytes.substr(start, end == std::string_view::npos ? end : end - start));
        if (end == std::string_view::npos) break;
        start = end + 1;
    }
    if (parts.size() < 2) return std::nullopt;
    return Launch{{parts.begin() + 2, parts.end()}, std::move(parts[1]), std::move(parts[0])};
}

}  // namespace crossbind::instance

// The build gives the app's id, which names its instance.
void crossbind_extension_instance(crossbind::Registry &registry) {
    using namespace crossbind::instance;
    const std::string id = registry.options()["id"].asString();
    registry.onLaunch([id](const crossbind::Launch &launch) {
        const Claim claim = claimInstance(launch, id);
        if (claim == Claim::NotTaken) throw std::runtime_error("the app runs already, but did not answer this launch: close it, then open the app again");
#ifdef CROSSBIND_APP_DEV
        if (claim == Claim::HandedOver) std::fprintf(stderr, "crossbind: another development session of the app runs, which took this launch\n");
#endif
        return claim == Claim::Instance;
    });
    registry.onQuit(leaveInstance);
}
