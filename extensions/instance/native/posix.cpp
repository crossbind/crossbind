// How a macOS or Linux app keeps one instance: the instance holds a lock and listens on a socket beside it, and a later
// launch that finds the lock held hands the instance its launch there.
#include "instance.h"

#include "crossbind/app.h"

#include <fcntl.h>
#include <poll.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <system_error>
#include <thread>

namespace crossbind::instance {
namespace {

namespace chrono = std::chrono;
using Deadline = chrono::steady_clock::time_point;

// What the instance answers once it has a launch.
constexpr char TAKEN = 1;
// The instance reads one launch for this long at most, so no stalled launch holds up the next.
constexpr auto READ_TIME = chrono::seconds(1);
// An accept that failed for want of descriptors or memory is tried again after this long.
constexpr auto ACCEPT_PAUSE = chrono::milliseconds(100);
#ifdef __APPLE__
constexpr int SEND_FLAGS = 0;
#else
constexpr int SEND_FLAGS = MSG_NOSIGNAL;
#endif

const std::string LOCK_NAME = std::string(INSTANCE_NAME) + ".lock";
const std::string SOCKET_NAME = std::string(INSTANCE_NAME) + ".sock";

// The folder of the lock and the socket, and the lock, which the instance keeps while it runs.
std::string folderPath;
int folder = -1;
int lock = -1;
std::atomic<bool> isListening{false};
std::atomic<bool> isLeaving{false};

void warn(const std::string &what) { std::fprintf(stderr, "crossbind: %s\n", what.c_str()); }

std::string failure() { return std::strerror(errno); }

int millisecondsUntil(Deadline deadline) {
    const auto left = chrono::duration_cast<chrono::milliseconds>(deadline - chrono::steady_clock::now()).count();
    return left > 0 ? static_cast<int>(left) : 0;
}

#ifdef __linux__
// A runtime folder of the user's alone, or -1: one another user made, where the variable names a shared folder, could
// hold this app's lock.
int openOwn(const std::string &place) {
    mkdir(place.c_str(), 0700);
    const int opened = open(place.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    struct stat info {};
    if (opened >= 0 && fstat(opened, &info) == 0 && info.st_uid == geteuid() && (info.st_mode & 077) == 0) return opened;
    if (opened >= 0) close(opened);
    return -1;
}
#endif

// The folder of the lock and the socket. Linux keeps them in the user's runtime folder, on this machine even where the
// home is shared over NFS, which a launch without XDG_RUNTIME_DIR, as from sudo or cron, finds as well; macOS, and Linux
// without one, in the app's cache folder.
int openFolder([[maybe_unused]] const std::string &id) {
#ifdef __linux__
    const char *runtime = std::getenv("XDG_RUNTIME_DIR");
    const std::string runtimeFolder = runtime && runtime[0] == '/' ? runtime : "/run/user/" + std::to_string(geteuid());
    folderPath = runtimeFolder + "/" + id;
    if (const int opened = openOwn(folderPath); opened >= 0) return opened;
#endif
    folderPath = crossbind::app::paths().cache;
    return open(folderPath.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
}

// Another user's process takes no launch from the socket and gives it none.
bool isSameUser(int socket) {
#ifdef __APPLE__
    uid_t user = 0;
    gid_t group = 0;
    return getpeereid(socket, &user, &group) == 0 && user == geteuid();
#else
    ucred peer{};
    socklen_t size = sizeof peer;
    return getsockopt(socket, SOL_SOCKET, SO_PEERCRED, &peer, &size) == 0 && peer.uid == geteuid();
#endif
}

// No write to a peer that went away ends the app with SIGPIPE.
void keepFromSigpipe([[maybe_unused]] int socket) {
#ifdef __APPLE__
    const int on = 1;
    setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
#endif
}

int newSocket() {
    const int made = socket(AF_UNIX, SOCK_STREAM, 0);
    if (made < 0) return -1;
    fcntl(made, F_SETFD, FD_CLOEXEC);
    keepFromSigpipe(made);
    return made;
}

// Binds or connects to the socket by its path where sun_path, about 100 bytes, holds it, else by its name from within
// its folder, which the process, with one thread yet, may make its working folder meanwhile.
template <typename Call>
bool atSocket(Call call) {
    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    const std::string path = folderPath + "/" + SOCKET_NAME;
    const auto size = static_cast<socklen_t>(sizeof address);
    if (path.size() < sizeof address.sun_path) {
        std::memcpy(address.sun_path, path.c_str(), path.size() + 1);
        return call(reinterpret_cast<const sockaddr *>(&address), size);
    }
#ifdef O_PATH
    const int here = open(".", O_PATH | O_DIRECTORY | O_CLOEXEC);
#else
    const int here = open(".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
#endif
    if (here < 0) return false;
    std::memcpy(address.sun_path, SOCKET_NAME.c_str(), SOCKET_NAME.size() + 1);
    bool done = false;
    if (fchdir(folder) == 0) {
        done = call(reinterpret_cast<const sockaddr *>(&address), size);
        if (fchdir(here) != 0) warn("the app cannot go back to the folder it was launched in: " + failure());
    }
    close(here);
    return done;
}

// What a peer sends until it closes its end, within READ_TIME.
std::optional<std::string> readFrom(int peer) {
    const Deadline deadline = chrono::steady_clock::now() + READ_TIME;
    std::string bytes;
    char chunk[4096];
    for (;;) {
        const int left = millisecondsUntil(deadline);
        pollfd ready{peer, POLLIN, 0};
        const int polled = left > 0 ? poll(&ready, 1, left) : 0;
        if (polled < 0 && errno == EINTR) continue;
        if (polled <= 0) return std::nullopt;
        const ssize_t got = read(peer, chunk, sizeof chunk);
        if (got == 0) return bytes;
        if (got < 0 && errno == EINTR) continue;
        if (got < 0) return std::nullopt;
        bytes.append(chunk, static_cast<size_t>(got));
        if (bytes.size() > MAX_LAUNCH) return std::nullopt;
    }
}

void take(int peer) {
    if (!isSameUser(peer)) return;
    const std::optional<std::string> bytes = readFrom(peer);
    std::optional<Launch> launch = bytes ? decodeLaunch(*bytes) : std::nullopt;
    // An instance on its way out takes no launch, which waits for it to end and becomes the next instance. Nor does it
    // take one whose process gave up on it and left, which the answer finds gone.
    if (!launch || isLeaving || send(peer, &TAKEN, 1, SEND_FLAGS) != 1) return;
    crossbind::launchedAgain(std::move(*launch));
}

// Lets later launches run as instances of their own.
void letGo(const std::string &why) {
    warn(why + ", so later launches run as instances of their own");
    isListening = false;
    close(lock);
}

void serve(int listener) {
    for (;;) {
#ifdef __linux__
        const int peer = accept4(listener, nullptr, nullptr, SOCK_CLOEXEC);
#else
        const int peer = accept(listener, nullptr, nullptr);
#endif
        if (peer < 0 && (errno == EINTR || errno == ECONNABORTED)) continue;
        if (peer < 0 && (errno == EMFILE || errno == ENFILE || errno == ENOBUFS || errno == ENOMEM || errno == EPROTO)) {
            std::this_thread::sleep_for(ACCEPT_PAUSE);
            continue;
        }
        if (peer < 0) {
            letGo("the app stopped hearing of its later launches: " + failure());
            close(listener);
            return;
        }
#ifndef __linux__
        fcntl(peer, F_SETFD, FD_CLOEXEC);
#endif
        keepFromSigpipe(peer);
        try {
            take(peer);
        } catch (const std::exception &error) {
            std::fprintf(stderr, "crossbind: the app did not take a launch: %s\n", error.what());
        } catch (...) {
            std::fprintf(stderr, "crossbind: the app did not take a launch\n");
        }
        close(peer);
    }
}

// Hears of later launches on a thread of its own, or lets them run as instances of their own.
void listenForLaunches() {
    // The lock is held, so a socket there is one an ended instance left.
    unlinkat(folder, SOCKET_NAME.c_str(), 0);
    const int listener = newSocket();
    const auto bound = [listener](const sockaddr *address, socklen_t size) { return bind(listener, address, size) == 0; };
    std::string why;
    if (listener < 0 || !atSocket(bound) || listen(listener, SOMAXCONN) != 0) {
        why = failure();
    } else {
        isListening = true;
        try {
            std::thread(serve, listener).detach();
            return;
        } catch (const std::system_error &error) {
            why = error.what();
        }
    }
    if (listener >= 0) close(listener);
    unlinkat(folder, SOCKET_NAME.c_str(), 0);
    letGo("the app cannot hear of its later launches: " + why);
}

// Hands the launch to the instance that runs, and waits for its answer on this one connection until the deadline, so
// no launch reaches it twice: true once it took the launch, false when it did not, as on its way out.
bool handOver(const std::string &bytes, Deadline deadline) {
    const int left = millisecondsUntil(deadline);
    const int instance = left > 0 ? newSocket() : -1;
    if (instance < 0) return false;
    // A launch larger than the socket's buffer would wait for an instance that has stopped reading.
    const timeval sendTime{left / 1000, (left % 1000) * 1000};
    setsockopt(instance, SOL_SOCKET, SO_SNDTIMEO, &sendTime, sizeof sendTime);
    const auto connected = [instance](const sockaddr *address, socklen_t size) { return connect(instance, address, size) == 0; };
    bool isTaken = false;
    if (atSocket(connected) && isSameUser(instance)) {
        size_t at = 0;
        while (at < bytes.size()) {
            const ssize_t put = send(instance, bytes.data() + at, bytes.size() - at, SEND_FLAGS);
            if (put < 0 && errno == EINTR) continue;
            if (put <= 0) break;
            at += static_cast<size_t>(put);
        }
        if (at == bytes.size() && shutdown(instance, SHUT_WR) == 0) {
            pollfd ready{instance, POLLIN, 0};
            int polled = 0;
            do {
                polled = poll(&ready, 1, millisecondsUntil(deadline));
            } while (polled < 0 && errno == EINTR);
            char answer = 0;
            isTaken = polled > 0 && read(instance, &answer, 1) == 1 && answer == TAKEN;
        }
    }
    close(instance);
    return isTaken;
}

}  // namespace

Claim claimInstance(const Launch &launch, const std::string &id) {
    try {
        folder = openFolder(id);
    } catch (const std::exception &error) {
        std::fprintf(stderr, "%s, so the app runs as one more instance\n", error.what());
        return Claim::Instance;
    }
    // The shell that opens the app anew inherits no descriptor, or the app it opens would find its own lock held.
    lock = folder < 0 ? -1 : openat(folder, LOCK_NAME.c_str(), O_RDWR | O_CREAT | O_CLOEXEC, 0600);
    if (lock < 0) {
        warn("the app cannot lock " + folderPath + ": " + failure() + ", so it runs as one more instance");
        return Claim::Instance;
    }
    const std::string bytes = encodeLaunch(launch);
    const Deadline deadline = chrono::steady_clock::now() + CLAIM_TIME;
    for (;;) {
        // The instance keeps the lock while it runs, and the system lets go of it however the instance ends.
        if (flock(lock, LOCK_EX | LOCK_NB) == 0) {
            listenForLaunches();
            return Claim::Instance;
        }
        if (errno != EWOULDBLOCK) {
            warn("the app cannot lock " + folderPath + ": " + failure() + ", so it runs as one more instance");
            close(lock);
            return Claim::Instance;
        }
        if (bytes.size() > MAX_LAUNCH) {
            warn("this launch's arguments are too long to hand to the app that runs");
            return Claim::NotTaken;
        }
        if (handOver(bytes, deadline)) return Claim::HandedOver;
        if (millisecondsUntil(deadline) == 0) {
            warn("the app runs already, but did not take this launch");
            return Claim::NotTaken;
        }
        std::this_thread::sleep_for(CLAIM_PAUSE);
    }
}

void leaveInstance() {
    isLeaving = true;
    // A later launch then finds no socket, and waits for the lock.
    if (isListening) unlinkat(folder, SOCKET_NAME.c_str(), 0);
}

}  // namespace crossbind::instance
