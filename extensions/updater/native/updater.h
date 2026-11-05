#pragma once

// What each desktop platform does for the updater.
#include <cstdint>
#include <filesystem>
#include <string>

namespace crossbind::updater {

// Fetches an address into a file, on the thread that calls it, which is not the main one, and throws why it could not,
// as when the answer runs past maxBytes.
void download(const std::string &url, const std::filesystem::path &file, std::uintmax_t maxBytes);
// Throws why not when an update, the app it unpacked to or its setup program, is not signed by the app's own signer: on
// macOS by its code signature, on Windows by its Authenticode signature, which Windows trusts. A leaked key of
// app.updater's then installs nothing else. An app without such a signature, as a Linux app always is, takes any update
// the key signed; a Windows app whose own signature Windows does not trust takes none.
void checkSigner(const std::filesystem::path &update);
#ifdef __APPLE__
// The app's bundle, which an update takes the place of.
std::filesystem::path bundlePath();
#endif
#ifdef _WIN32
// Starts an update's setup program, which installs it where the app is once the app has quit, and opens it anew.
void runSetup(const std::filesystem::path &setup);
#endif

}  // namespace crossbind::updater
