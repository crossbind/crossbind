#pragma once

// How the host makes what it hands an extension, whose states and constructors <crossbind/extension.h> keeps to the
// host: StateOf<Call> names a call's state, and make<Call>(state) makes the call.
#include "crossbind/extension.h"

#include <string>
#include <utility>
#include <vector>

namespace crossbind::app {

struct RegistryAccess {
    template <typename T>
    using State = typename T::State;

    template <typename T, typename... Args>
    static T make(Args &&...args) {
        return T(std::forward<Args>(args)...);
    }

    template <typename T>
    static const std::shared_ptr<State<T>> &stateOf(const T &object) {
        return object.state_;
    }

    // The host's registry of its own functions, and that of one extension's entry.
    static Registry host() { return Registry(); }
    static Registry of(std::string extension, Value options, std::vector<std::string> roles, std::vector<std::string> given) {
        return Registry(std::move(extension), std::move(options), std::move(roles), std::move(given));
    }
};

template <typename T>
using StateOf = RegistryAccess::State<T>;

template <typename T, typename... Args>
T make(Args &&...args) {
    return RegistryAccess::make<T>(std::forward<Args>(args)...);
}

template <typename T>
const std::shared_ptr<StateOf<T>> &stateOf(const T &object) {
    return RegistryAccess::stateOf(object);
}

// The extension that holds this role of the host's, or "" for none.
std::string holderOf(const std::string &role);

// The page the app shows, whose requests the webview hands over, from any thread: none, 0 for its id and its window's,
// before the first.
Page shownPage();
// The next page, in the first of the app's open windows, which the app shows from now on, as the webview commits it.
Page newPage();

}  // namespace crossbind::app
