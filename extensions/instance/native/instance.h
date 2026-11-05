#pragma once

// A desktop app that app.singleInstance keeps to one instance for each user: a later launch hands its arguments to the
// instance that runs, before the app's module starts, and leaves.
#include "crossbind/extension.h"

#include <chrono>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace crossbind::instance {

// What a launch is to the app.
enum class Claim {
    // Its instance, which hears of each later launch from then on.
    Instance,
    // A launch the instance that runs took.
    HandedOver,
    // A launch the instance that runs did not take, as when it stopped answering.
    NotTaken,
};

// A development session's instance is apart from the built app's, which has its id. CROSSBIND_APP_DEV marks a debug
// host, as `crossbind app dev` builds.
#ifdef CROSSBIND_APP_DEV
constexpr const char *INSTANCE_NAME = "instance-dev";
#else
constexpr const char *INSTANCE_NAME = "instance";
#endif
// Far more than a launch's arguments: anything longer is no launch.
constexpr size_t MAX_LAUNCH = 1 << 20;
// A later launch tries this long to hand itself over, waiting for one answer at a time, or to become the instance once
// the one that ran has ended.
constexpr auto CLAIM_TIME = std::chrono::seconds(10);
constexpr auto CLAIM_PAUSE = std::chrono::milliseconds(50);

// A launch as one instance hands it to the other.
std::string encodeLaunch(const Launch &launch);
std::optional<Launch> decodeLaunch(std::string_view bytes);
// Each desktop platform's, for the app of this id.
Claim claimInstance(const Launch &launch, const std::string &id);
// The instance takes no later launch from now on: each waits for it to end, and becomes the next instance.
void leaveInstance();

}  // namespace crossbind::instance
