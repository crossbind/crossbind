// A desktop app opening anew once it has quit, for app.relaunch() and an update.
#include "host_core.h"

#ifdef __APPLE__
#include <TargetConditionals.h>
#endif

#if defined(_WIN32)
#include "windows/com.h"

// The app starts at once: one that app.singleInstance keeps to one instance waits for this one to end, and becomes the
// next.
Failure openAnew() {
    const std::wstring executable = crossbind::windows::executablePath();
    std::wstring command = L"\"" + executable + L"\"";
    STARTUPINFOW startup{};
    startup.cb = sizeof startup;
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup, &process)) {
        return "the app cannot open anew: Windows error " + std::to_string(GetLastError());
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return std::nullopt;
}
#elif defined(__ANDROID__) || TARGET_OS_IPHONE
Failure openAnew() { return "a phone's app does not open itself anew"; }
#else
#include <spawn.h>
#include <unistd.h>
#ifndef __APPLE__
#include <dirent.h>
#endif

#include <cstdlib>
#include <cstring>
#include <fstream>
#include <system_error>
#include <vector>

extern char **environ;

namespace {

#ifndef __APPLE__
// The command that started a Linux app, as its launcher gave it, read as it starts: an update or a package that replaces
// the files later leaves /proc/self/exe naming the deleted executable. GTK takes the window's app id, which names the
// desktop entry whose icon it shows, from the command's name. A command found on PATH stays a name the shell finds there.
const std::string LAUNCHED_AS = [] {
    std::ifstream cmdline("/proc/self/cmdline", std::ios::binary);
    std::string command;
    std::getline(cmdline, command, '\0');
    std::error_code error;
    if (command.find('/') != std::string::npos) command = std::filesystem::absolute(command, error).string();
    return command.empty() || error ? std::filesystem::read_symlink("/proc/self/exe", error).string() : command;
}();
#endif

}  // namespace

// A shell waits for this process to end, then opens the app: a macOS app's bundle, which open opens anew, or the command
// that started a Linux app. Of this process's descriptors they get the standard streams alone: a socket the module left
// open would keep its port from the new app.
Failure openAnew() {
#ifdef __APPLE__
    const std::vector<std::string> open = {"/usr/bin/open", "-n", crossbind::app::pathOf(resourceDir()).parent_path().parent_path().string()};
#else
    if (LAUNCHED_AS.empty()) return "the app cannot open anew: it cannot tell the command that started it";
    const std::vector<std::string> open = {LAUNCHED_AS};
#endif
    std::vector<std::string> command = {"/bin/sh", "-c", "while kill -0 \"$1\" 2>/dev/null; do sleep 0.1; done; shift; exec \"$@\"", "sh",
                                        std::to_string(getpid())};
    command.insert(command.end(), open.begin(), open.end());
    std::vector<char *> argv;
    for (auto &arg : command) argv.push_back(arg.data());
    argv.push_back(nullptr);
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
#ifdef __APPLE__
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_CLOEXEC_DEFAULT);
    for (int stream = 0; stream <= 2; ++stream) posix_spawn_file_actions_addinherit_np(&actions, stream);
#else
    std::vector<int> descriptors;
    if (DIR *folder = opendir("/proc/self/fd")) {
        while (const dirent *entry = readdir(folder)) {
            const int descriptor = std::atoi(entry->d_name);
            if (descriptor > 2 && descriptor != dirfd(folder)) descriptors.push_back(descriptor);
        }
        closedir(folder);
    }
    for (const int descriptor : descriptors) posix_spawn_file_actions_addclose(&actions, descriptor);
#endif
    pid_t child = 0;
    const int failed = posix_spawn(&child, argv[0], &actions, &attributes, argv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    if (failed) return "the app cannot open anew: " + std::string(std::strerror(failed));
    return std::nullopt;
}
#endif
