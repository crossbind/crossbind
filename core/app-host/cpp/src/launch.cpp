// A desktop app's launch, as the system starts it, which the app's extensions and its page hear of.
#include "app.h"

#include <filesystem>
#include <system_error>

#ifdef _WIN32
#include "windows/com.h"

#include <shellapi.h>
#else
#include <cstdlib>
#endif

namespace crossbind::app {

#ifdef _WIN32
Launch launchOf(int, char **) {
    Launch launch;
    int count = 0;
    if (LPWSTR *args = CommandLineToArgvW(GetCommandLineW(), &count)) {
        for (int i = 1; i < count; i += 1) launch.args.push_back(crossbind::windows::utf8(args[i]));
        LocalFree(args);
    }
    std::error_code error;
    const std::u8string cwd = std::filesystem::current_path(error).u8string();
    launch.cwd.assign(cwd.begin(), cwd.end());
    return launch;
}
#else
Launch launchOf(int argc, char **argv) {
    Launch launch;
    for (int i = 1; i < argc; i += 1) launch.args.emplace_back(argv[i]);
    std::error_code error;
    const std::u8string cwd = std::filesystem::current_path(error).u8string();
    launch.cwd.assign(cwd.begin(), cwd.end());
#ifdef __linux__
    for (const char *name : {"XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID"}) {
        const char *token = std::getenv(name);
        if (token && *token) {
            launch.token = token;
            break;
        }
    }
#endif
    return launch;
}
#endif

}  // namespace crossbind::app
