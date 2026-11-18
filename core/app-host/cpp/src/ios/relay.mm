// A debug app on an iPhone or iPad loads its page from the device's own localhost: WebKit compiles a page from there and
// makes it a secure context, and does neither for one from the Mac's address on the network. The app listens on
// localhost at the page's port and carries every connection, byte for byte, to the dev server on the Mac, as adb reverse
// does for an Android device, so Vite's WebSocket passes as the page's requests do.
#ifdef CROSSBIND_APP_DEV

#import <UIKit/UIKit.h>

#include "ios/relay.h"

#include "app.h"

#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

namespace app = crossbind::app;

// How long a try to reach the dev server waits for its answer, and how long the page waits between tries.
constexpr int CONNECT_TIMEOUT_MS = 3000;
constexpr auto RETRY_DELAY = std::chrono::seconds(1);
constexpr size_t CHUNK_SIZE = 64 * 1024;
constexpr int MAX_PORT = 65535;

app::Core *core;
const char *devUrl;
// The dev server as CROSSBIND_APP_DEV_SERVER names it, and its host and port apart.
std::string named;
std::string host;
std::string port;
// The port of the page's localhost, and the device as the developer reads it, as "the iPhone".
uint16_t localPort;
std::string device;
// Whether the last try reached the dev server, so that a run of failures says why once.
std::atomic<bool> isAnswering{true};
// On the main thread: the listeners while the app is in the foreground, whether the dev server has answered yet, and
// the page's loads that wait until it has.
std::vector<dispatch_source_t> listeners;
bool hasAnswered = true;
std::vector<std::function<void()>> loads;
// Signalled as each listener closes.
dispatch_semaphore_t listenerClosed;

bool isPort(const std::string &text) {
    return !text.empty() && text.size() <= 5 && text.find_first_not_of("0123456789") == std::string::npos && std::stoi(text) > 0 &&
           std::stoi(text) <= MAX_PORT;
}

// "192.168.1.6:5173", or "[2001:db8::5]:5173" for an IPv6 address, as a URL names a host and its port.
bool readDevServer(const std::string &given) {
    const bool isBracketed = given.starts_with('[');
    const size_t colon = isBracketed ? given.find("]:") : given.rfind(':');
    if (colon == std::string::npos) return false;
    host = isBracketed ? given.substr(1, colon - 1) : given.substr(0, colon);
    port = given.substr(colon + (isBracketed ? 2 : 1));
    return !host.empty() && isPort(port);
}

void noSigpipe(int socket) {
    const int on = 1;
    setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
}

// Says once, until the dev server answers again, why the app does not reach it: until the device's user answers iOS's
// question whether the app may use the local network, it reaches nothing there either.
void unanswered(const std::string &why) {
    if (!isAnswering.exchange(false)) return;
    const std::string ipv6 = host.find(':') == std::string::npos
                                 ? ""
                                 : " An IPv6 address needs a route to it from " + device + " as well: --host can give this Mac's IPv4 address instead.";
    const std::string said = "the dev server at " + named + " does not answer the app (" + why + "). iOS lets the app reach it once " + device +
                             " allows the app on the local network: tap Allow as " + device +
                             " asks, or turn the app on in Settings › Privacy & Security › Local Network; else put " + device +
                             " on this Mac's network, or on its cable." + ipv6 + " The page loads once the dev server answers.";
    std::fprintf(stderr, "crossbind: %s\n", said.c_str());
}

// A blocking socket connected to the address within CONNECT_TIMEOUT_MS, or -1 with the error.
int connectWithin(const addrinfo &address, int &error) {
    const int server = socket(address.ai_family, SOCK_STREAM, IPPROTO_TCP);
    if (server < 0) {
        error = errno;
        return -1;
    }
    const int flags = fcntl(server, F_GETFL);
    fcntl(server, F_SETFL, flags | O_NONBLOCK);
    error = connect(server, address.ai_addr, address.ai_addrlen) == 0 ? 0 : errno;
    if (error == EINPROGRESS) {
        pollfd connecting{server, POLLOUT, 0};
        const int ready = poll(&connecting, 1, CONNECT_TIMEOUT_MS);
        socklen_t size = sizeof error;
        if (ready == 1) getsockopt(server, SOL_SOCKET, SO_ERROR, &error, &size);
        else error = ready == 0 ? ETIMEDOUT : errno;
    }
    if (error != 0) {
        close(server);
        return -1;
    }
    fcntl(server, F_SETFL, flags);
    noSigpipe(server);
    return server;
}

// A socket connected to the dev server, or -1.
int reachDevServer() {
    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo *found = nullptr;
    if (const int lookup = getaddrinfo(host.c_str(), port.c_str(), &hints, &found); lookup != 0) {
        unanswered(gai_strerror(lookup));
        return -1;
    }
    int server = -1;
    int error = 0;
    for (const addrinfo *address = found; address && server < 0; address = address->ai_next) server = connectWithin(*address, error);
    freeaddrinfo(found);
    if (server < 0) {
        unanswered(std::strerror(error));
        return -1;
    }
    isAnswering = true;
    return server;
}

// A connection of the page and the app's own to the dev server, both closed once both directions have ended.
struct Connection {
    const int page;
    const int server;
    Connection(int page, int server) : page(page), server(server) {}
    Connection(const Connection &) = delete;
    Connection &operator=(const Connection &) = delete;
    ~Connection() {
        close(page);
        close(server);
    }
};

bool sendAll(int to, const char *data, size_t size) {
    while (size > 0) {
        const ssize_t sent = send(to, data, size, 0);
        if (sent < 0 && errno == EINTR) continue;
        if (sent <= 0) return false;
        data += sent;
        size -= static_cast<size_t>(sent);
    }
    return true;
}

// Carries what `from` sends to `to` until `from` ends its side, which then ends `to`'s; a failure, as of a socket iOS
// reclaimed while the app was suspended, ends both directions.
void carry(const std::shared_ptr<Connection> &connection, int from, int to) {
    std::vector<char> chunk(CHUNK_SIZE);
    for (;;) {
        const ssize_t received = recv(from, chunk.data(), chunk.size(), 0);
        if (received < 0 && errno == EINTR) continue;
        if (received == 0) {
            shutdown(to, SHUT_WR);
            return;
        }
        if (received < 0 || !sendAll(to, chunk.data(), static_cast<size_t>(received))) break;
    }
    shutdown(connection->page, SHUT_RDWR);
    shutdown(connection->server, SHUT_RDWR);
}

// One connection of the page, carried both ways, a thread each. One the dev server does not answer ends at once, and the
// page's own retry, as Vite's, comes back.
void relay(int page) {
    const int server = reachDevServer();
    if (server < 0) {
        close(page);
        return;
    }
    const auto connection = std::make_shared<Connection>(page, server);
    std::thread([connection] { carry(connection, connection->server, connection->page); }).detach();
    carry(connection, page, server);
}

// A socket listening on the device's own address of this family at the page's port, or -1 with errno set.
int listenOn(int family) {
    const int listener = socket(family, SOCK_STREAM, IPPROTO_TCP);
    if (listener < 0) return -1;
    const int on = 1;
    // A listener opened anew in the foreground takes its port back from the connections that ended meanwhile.
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
    sockaddr_in v4{};
    v4.sin_len = sizeof v4;
    v4.sin_family = AF_INET;
    v4.sin_port = htons(localPort);
    v4.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    sockaddr_in6 v6{};
    v6.sin6_len = sizeof v6;
    v6.sin6_family = AF_INET6;
    v6.sin6_port = htons(localPort);
    v6.sin6_addr = in6addr_loopback;
    const auto *address = family == AF_INET ? reinterpret_cast<const sockaddr *>(&v4) : reinterpret_cast<const sockaddr *>(&v6);
    if (bind(listener, address, address->sa_len) == 0 && listen(listener, SOMAXCONN) == 0 &&
        fcntl(listener, F_SETFL, fcntl(listener, F_GETFL) | O_NONBLOCK) == 0) {
        return listener;
    }
    const int error = errno;
    close(listener);
    errno = error;
    return -1;
}

// Takes the page's connections on this listener as they come.
dispatch_source_t acceptOn(int listener) {
    dispatch_source_t source =
        dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, static_cast<uintptr_t>(listener), 0, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
    dispatch_source_set_event_handler(source, ^{
      for (;;) {
          const int page = accept(listener, nullptr, nullptr);
          if (page < 0 && (errno == EINTR || errno == ECONNABORTED)) continue;
          if (page < 0) return;
          // A socket Darwin accepts on a listener that does not block does not block either; the threads that carry it do.
          fcntl(page, F_SETFL, fcntl(page, F_GETFL) & ~O_NONBLOCK);
          noSigpipe(page);
          std::thread(relay, page).detach();
      }
    });
    dispatch_source_set_cancel_handler(source, ^{
      close(listener);
      dispatch_semaphore_signal(listenerClosed);
    });
    dispatch_resume(source);
    return source;
}

// Closes the listeners before it returns, as a listener a source closes later could still hold the port when the app
// listens anew.
void stopListening() {
    for (dispatch_source_t listener : listeners) dispatch_source_cancel(listener);
    for (size_t open = listeners.size(); open > 0; --open) dispatch_semaphore_wait(listenerClosed, DISPATCH_TIME_FOREVER);
    listeners.clear();
}

// Listens on both addresses localhost has, as WebKit may take either; ends the app, saying why, where it cannot.
void startListening() {
    for (const int family : {AF_INET, AF_INET6}) {
        const int listener = listenOn(family);
        if (listener < 0) {
            const int error = errno;
            stopListening();
            const std::string at = "localhost:" + std::to_string(localPort);
            app::fail(*core, devUrl,
                      error == EADDRINUSE ? "another app on " + device + " listens on " + at +
                                                ", where the page loads from: quit that app, or give the dev server another port with --port."
                                          : "the app cannot listen on " + at + " of " + device + ", where the page loads from: " + std::strerror(error) + ".");
        }
        listeners.push_back(acceptOn(listener));
    }
}

}  // namespace

void relayDevServer(app::Core &appCore, const char *url) {
    const char *given = std::getenv("CROSSBIND_APP_DEV_SERVER");
    if (!given || !url) return;
    core = &appCore;
    devUrl = url;
    named = given;
    device = std::string("the ") + UIDevice.currentDevice.model.UTF8String;
    if (!readDevServer(named)) {
        app::fail(appCore, url, "CROSSBIND_APP_DEV_SERVER \"" + named + "\" is no address and port of the dev server, as 192.168.1.6:5173 or [2001:db8::5]:5173 is.");
    }
    const std::string origin = app::originOf(url);
    const size_t colon = origin.rfind(':');
    const std::string pagePort = colon == std::string::npos ? "" : origin.substr(colon + 1);
    if (!isPort(pagePort)) app::fail(appCore, url, std::string("CROSSBIND_APP_URL ") + url + " names no port, which the app relays to the dev server.");
    localPort = static_cast<uint16_t>(std::stoi(pagePort));
    listenerClosed = dispatch_semaphore_create(0);
    startListening();
    // iOS may take a listener away from an app it suspends, so the app closes its listeners in the background and opens
    // them anew as it comes back. A connection iOS reclaimed ends, and the page's own retry, as Vite's, comes back.
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:UIApplicationDidEnterBackgroundNotification object:nil queue:nil usingBlock:^(NSNotification *) {
        stopListening();
    }];
    [center addObserverForName:UIApplicationWillEnterForegroundNotification object:nil queue:nil usingBlock:^(NSNotification *) {
        if (listeners.empty()) startListening();
    }];
    // The page waits for the dev server's first answer, which comes once the device's user allows the app on the local
    // network.
    hasAnswered = false;
    std::thread([] {
        int server;
        while ((server = reachDevServer()) < 0) std::this_thread::sleep_for(RETRY_DELAY);
        close(server);
        dispatch_async(dispatch_get_main_queue(), ^{
          hasAnswered = true;
          for (const auto &load : loads) load();
          loads.clear();
        });
    }).detach();
}

void whenDevServerAnswers(std::function<void()> load) {
    if (hasAnswered) {
        load();
        return;
    }
    loads.push_back(std::move(load));
}

#endif
