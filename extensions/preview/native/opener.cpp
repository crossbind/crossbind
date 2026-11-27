// The opener: a session of the account's list, read again by its id, checked in order before a byte of its project
// loads (its protocol, its source's proof made with its key, then the account and the session the proof covers), and
// once its page's own Open, served as an origin of the account's and the project's, whose handler is the proxy of the
// session's source, with the indicator up on its window. A snapshot's session is read again where its host refuses
// the proxy's token, as after its key was made anew, at the preview's Reload and as the app comes to the front. The
// preview's menu clears its project's data after its own question, which the preview's end closes.
#include "preview.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <thread>

namespace preview {
namespace {

using crossbind::Call;
using crossbind::Request;

constexpr std::size_t CHALLENGE_BYTES = 32;
constexpr std::size_t MAX_SESSION_ANSWER = 64 * 1024;
// iOS and macOS hold a first connection to the local network back while their user is asked: tried every second.
constexpr auto LOCAL_NETWORK_RETRY = std::chrono::seconds(1);
constexpr auto LOCAL_NETWORK_WAIT = std::chrono::minutes(2);
const std::string GATE_TEXT = "crossbind-requests";
const std::string GONE = "This snapshot is no longer on your account's list.";
const std::string ANOTHER = "crossbind cloud lists this snapshot as another project now: open it again from Projects.";
const std::string RENEWED = "The snapshot's key was renewed; it opened again.";
const std::string ENDED_AS_OPENED = "crossbind: the preview ended as it opened.";
// The middle dot of the preview menu's line, in UTF-8.
const std::string DOT = " \xC2\xB7 ";
// How long the menu's line says a snapshot's key was renewed.
constexpr auto RENEWED_SHOWN = std::chrono::minutes(1);
const std::string CHECK_FIRST = "crossbind opens the preview it checked last: check it first.";
const std::string CLEAR_DETAIL = "Its sources are untouched.";
// The quotes around the project's name, in UTF-8.
const std::string OPENING = "\xE2\x80\x9C";
const std::string CLOSING = "\xE2\x80\x9D";
const std::string NAMELESS = "crossbind cloud lists this preview with a name crossbind shows on no dialog: give the project a name of letters, digits and ._@/- (general.name in crossbind.config.js), and run crossbind app preview again.";
const Request::Headers TEXT{{"Content-Type", "text/plain; charset=utf-8"}};
const std::vector<std::string> PASSED{"content-type", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"};

std::string olderWords(int protocol, const std::string &update) {
    return "this project's crossbind is older than this app takes (protocol " + std::to_string(protocol) + ", from " + std::to_string(LEAST_PROTOCOL)
           + "): update crossbind in the project" + (update.empty() ? "" : ": " + update);
}

std::string newerWords(int protocol) {
    return "this project's crossbind is newer than this app (protocol " + std::to_string(protocol) + ", up to " + std::to_string(MOST_PROTOCOL)
           + "): update the crossbind app";
}

std::string unreachableWords(const std::string &on, const std::string &failure) {
    const std::string &platform = config().platform;
    const bool isPhone = platform == "ios" || platform == "ipados" || platform == "android";
    return "crossbind cannot reach " + on + ": " + failure + ". Is crossbind app preview running there, and is this " + (isPhone ? "device" : "computer")
           + " on its network?";
}

std::string localNetworkWords(const std::string &on) {
#if defined(__APPLE__) && TARGET_OS_IPHONE
    return "crossbind cannot reach " + on + " yet. Allow crossbind on the local network when iOS asks, or in Settings › Privacy & Security › Local Network, and keep this iPhone on the computer's network.";
#else
    return "crossbind cannot reach " + on + " yet. Allow crossbind on the local network when macOS asks, or in System Settings › Privacy & Security › Local Network, and keep this Mac on the computer's network.";
#endif
}

// What the check found: the session and the account it opens for, where it is answered from, and what the proxy and the
// origin are made of.
struct Checked {
    Session session;
    Account account;
    std::string source;
    std::string on;
    std::string gateToken;
    std::string originName;
};

// What a check of the session's source answered: why it stops, whether no source was reachable at all, and else the
// source that answered.
struct Verified {
    Failure words;
    bool isUnreachable = false;
    std::string source;
};

std::string hostOf(const std::string &source) { return source.substr(source.find("://") + 3); }

std::vector<std::string> sourcesOf(const Session &session) {
    if (session.source == "snapshot") return {config().snapshots + "/" + session.id};
    std::vector<std::string> sources;
    for (const std::string &address : session.addresses) sources.push_back("http://" + address);
    return sources;
}

// The session's check, at each of its sources in turn until one answers it: the protocol, read first, the proof made
// with the session's key over the protocol, the app's challenge and the session sent, and then, once the proof holds,
// the session's fields.
void verifyAt(Session session, Account account, std::string gate, std::vector<std::string> sources, std::size_t index, std::string lastFailure,
    std::function<void(Verified)> done) {
    if (index >= sources.size()) {
        done({unreachableWords(hostOf(sources.front()), lastFailure), true, {}});
        return;
    }
    const std::string source = sources[index];
    std::string challenge;
    try {
        challenge = toBase64url(randomBytes(CHALLENGE_BYTES));
    } catch (const std::exception &error) {
        done({std::string(error.what()), false, {}});
        return;
    }
    const std::string url = source + "/__crossbind/session?challenge=" + challenge + "&protocols=" + std::to_string(LEAST_PROTOCOL) + "-"
                            + std::to_string(MOST_PROTOCOL);
    // A snapshot's host answers nothing without the gate's token, its session among it; a dev server takes none there.
    const Request::Headers headers = session.source == "snapshot" ? Request::Headers{{"X-Crossbind-Preview", gate}} : Request::Headers{};
    const auto next = [=](const std::string &failure) { verifyAt(session, account, gate, sources, index + 1, failure, done); };
    crossbind::fetch("GET", url, headers, [=](Failure failure, crossbind::FetchResponse response) {
        if (failure) return next(*failure);
        Value answer;
        try {
            if (response.status == 200 && response.body.size() <= MAX_SESSION_ANSWER) answer = parseJson(response.body);
        } catch (const std::exception &) {
            // No JSON is no session.
        }
        const std::optional<int> protocol = integerOf(answer["protocol"]);
        if (!protocol) {
            if (index + 1 < sources.size()) return next(hostOf(source) + " is no crossbind preview");
            return done({hostOf(source) + " is no crossbind preview: run crossbind app preview in the project", false, {}});
        }
        const std::string sent = textOf(answer["session"]);
        const std::optional<std::string> proof = fromBase64url(textOf(answer["proof"]));
        const std::string proven = "crossbind-session." + std::to_string(*protocol) + "." + challenge + "." + sent;
        hmacSha256(*fromBase64url(session.key), proven, [=](Failure hashFailure, std::string expected) {
            const bool holds = !hashFailure && proof && isSameSecret(*proof, expected);
            Value fields;
            try {
                const std::optional<std::string> decoded = holds ? fromBase64url(sent) : std::nullopt;
                if (decoded) fields = parseJson(*decoded);
            } catch (const std::exception &) {
                // A session that is no JSON is none.
            }
            const std::string where = session.source == "snapshot" ? "This snapshot" : "crossbind app preview on " + hostOf(source);
            if (*protocol < LEAST_PROTOCOL) return done({olderWords(*protocol, holds ? textOf(fields["update"]) : ""), false, {}});
            if (*protocol > MOST_PROTOCOL) return done({newerWords(*protocol), false, {}});
            if (!holds) {
                return done({"the server at " + hostOf(source) + " could not prove it is the preview crossbind cloud lists: is crossbind app preview running there?", false, {}});
            }
            if (!fields.isObject()) return done({"the server at " + hostOf(source) + " sent a session this app cannot read: run crossbind app preview again", false, {}});
            if (textOf(fields["account"]["id"]) != account.id) return done({otherAccountWords(where, textOf(fields["account"]["name"]), account.name), false, {}});
            if (textOf(fields["session"]) != session.id) {
                return done({"the server at " + hostOf(source) + " runs another preview than the one opened: open it again from Projects", false, {}});
            }
            done({std::nullopt, false, source});
        });
    });
}

void verify(const Session &session, const Account &account, const std::string &gate, std::function<void(Verified)> done) {
    verifyAt(session, account, gate, sourcesOf(session), 0, "", std::move(done));
}

// What a reading of a snapshot's session again found: the gate's token of a key made anew, taken once its proof held;
// whether a higher version was taken with it; or that the preview ended, as the session was gone, the app signed out,
// the session read as another's, or the preview ended meanwhile, so that what waited does nothing.
struct Reading {
    std::optional<std::string> token;
    bool isHigher = false;
    bool isEnded = false;
};

class Proxy;
bool isOpenProxy(const Proxy *proxy);

// The proxy of an open preview's origin: each GET and HEAD a fetch of the session's source, with the request's Accept,
// Accept-Language and Range alone and the gate's token, its answer passed back with its status and the headers PASSED
// names; a failure, and an answer the host gives no web view, as a redirect, which no web view follows for an app's
// origin, answer 502 with the reason.
class Proxy : public std::enable_shared_from_this<Proxy> {
public:
    Proxy(uint64_t number, Session session, Account account, std::string source, std::string gateToken)
        : number_(number), isSnapshot_(session.source == "snapshot"), sessionId_(session.id), projectId_(session.projectId),
          openedVersion_(session.version), account_(std::move(account)), source_(std::move(source)), session_(std::move(session)),
          token_(std::move(gateToken)) {}

    // The preview's number, which its indicator's marks carry.
    uint64_t number() const { return number_; }
    const std::string &sessionId() const { return sessionId_; }
    bool isSnapshot() const { return isSnapshot_; }

    // The snapshot's page reloaded once its session is read again; a Reload while one waits for its reading joins it.
    void reload(uint64_t window) {
        if (isReloading_.exchange(true)) return;
        read([self = shared_from_this(), window](const Reading &reading) {
            self->isReloading_ = false;
            if (!reading.isEnded && isOpenProxy(self.get())) reloadWindow(window);
        });
    }

    void answer(Request request) {
        std::string token;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            token = token_;
        }
        const std::string url = source_ + escapedPath(request.path()) + (request.query().empty() ? "" : "?" + request.query());
        send(std::move(request), url, token, false);
    }

    // The preview menu's line: the account and where the page comes from, a dev server's address or a snapshot's version
    // as it is served, beside the version opened once a higher one came; for a minute after the key was made anew, 3.4's
    // words.
    std::string line() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!isSnapshot_) return account_.name + DOT + "on " + hostOf(source_);
        if (renewals_ > 0 && std::chrono::steady_clock::now() - renewedAt_ < RENEWED_SHOWN) return RENEWED;
        std::string shown = account_.name + DOT + "a snapshot, version " + std::to_string(session_.version);
        if (session_.version > openedVersion_) shown += ", changed since you opened version " + std::to_string(openedVersion_);
        return shown;
    }

    // The session read again, one reading at a time, which what comes meanwhile waits for: 404 ends the preview with its
    // words, 401 signs the app out, and a session that reads as another's ends it; a key made anew or a higher version is
    // taken once its proof holds, as the opener checked the first; no answer changes nothing, and neither does one that
    // comes after its preview ended or another opened.
    void read(std::function<void(const Reading &)> then) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            waiting_.push_back(std::move(then));
            if (isReading_) return;
            isReading_ = true;
        }
        withAccount([self = shared_from_this()](std::optional<Account> account, std::string appToken) {
            if (!account || account->id != self->account_.id) return self->readDone({});
            askCloud("GET", "/v1/sessions/" + self->sessionId_, appToken, "", [self, account](Failure failure, int status, Value answer) {
                if (!isOpenProxy(self.get())) return self->readDone({.isEnded = true});
                if (failure) return self->readDone({});
                if (status == 401) {
                    endPreview(signedOutWords(), self->sessionId_);
                    forgetSignIn([] {});
                    return self->readDone({.isEnded = true});
                }
                if (status == 404) {
                    endPreview(GONE, self->sessionId_);
                    return self->readDone({.isEnded = true});
                }
                const std::optional<Session> renewed = status == 200 ? sessionOf(answer) : std::nullopt;
                if (!renewed) return self->readDone({});
                if (const Failure other = self->otherOf(*renewed)) {
                    endPreview(*other, self->sessionId_);
                    return self->readDone({.isEnded = true});
                }
                Session held;
                {
                    std::lock_guard<std::mutex> lock(self->mutex_);
                    held = self->session_;
                }
                const bool isNewKey = renewed->key != held.key;
                const bool isHigher = renewed->version > held.version;
                if (!isNewKey && !isHigher) return self->readDone({});
                hmacSha256(*fromBase64url(renewed->key), GATE_TEXT, [self, account, renewed, isNewKey, isHigher](Failure hashFailure, std::string gate) {
                    if (hashFailure) return self->readDone({});
                    const std::string token = toBase64url(gate);
                    verify(*renewed, *account, token, [self, renewed, token, isNewKey, isHigher](Verified verified) {
                        if (verified.words) return self->readDone({});
                        if (!isOpenProxy(self.get())) return self->readDone({.isEnded = true});
                        self->take(*renewed, token, isNewKey);
                        self->readDone({isNewKey ? std::optional<std::string>(token) : std::nullopt, isHigher, false});
                    });
                });
            });
        });
    }

private:
    void send(Request request, std::string url, std::string token, bool isRetry) {
        Request::Headers headers{{"X-Crossbind-Preview", token}};
        for (const char *name : {"Accept", "Accept-Language", "Range"}) {
            const std::string value = request.header(name);
            if (!value.empty()) headers.emplace_back(name, value);
        }
        const std::string method = request.method();
        try {
            crossbind::fetch(method, url, headers, [self = shared_from_this(), request, url, token, isRetry](Failure failure, crossbind::FetchResponse response) {
                if (failure) {
                    request.respond(502, TEXT, *failure);
                    return;
                }
                if (response.status == 403 && self->isSnapshot_ && !isRetry) {
                    self->renew(token, [self, request, url, response](std::optional<std::string> renewed) {
                        if (renewed) self->send(request, url, *renewed, true);
                        else pass(request, response);
                    });
                    return;
                }
                pass(request, response);
            });
        } catch (const std::exception &error) {
            request.respond(502, TEXT, error.what());
        }
    }

    // A HEAD's length is the source's, as its answer names it; every other answer's its body's own. What the host
    // refuses to answer a web view with, a status or a header's value, answers 502 in the host's words: a throw here, on
    // the fetch's thread, would end the app.
    static void pass(const Request &request, const crossbind::FetchResponse &response) {
        Request::Headers passed;
        for (const auto &[name, value] : response.headers) {
            const bool isPassed = std::find(PASSED.begin(), PASSED.end(), name) != PASSED.end();
            if (isPassed || (name == "content-length" && request.method() == "HEAD")) passed.emplace_back(name, value);
        }
        try {
            request.respond(response.status, passed, response.body);
        } catch (const std::exception &error) {
            request.respond(502, TEXT, error.what());
        }
    }

    // The snapshot's host refused the token: the token another request's reading took meanwhile, or the session read
    // again for a key made anew.
    void renew(const std::string &used, std::function<void(std::optional<std::string>)> then) {
        std::optional<std::string> current;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (token_ != used) current = token_;
        }
        if (current) return then(current);
        read([then](const Reading &reading) { then(reading.token); });
    }

    // Why a session of this id, as the account's list gives it now, is no longer the preview's: another project, another
    // kind of source, a protocol the app does not take, a name no dialog shows.
    Failure otherOf(const Session &renewed) const {
        if (renewed.id != sessionId_ || renewed.source != "snapshot" || renewed.projectId != projectId_) return ANOTHER;
        if (renewed.protocol > MOST_PROTOCOL) return newerWords(renewed.protocol);
        if (renewed.protocol < LEAST_PROTOCOL) return olderWords(renewed.protocol, "");
        if (!isListedName(renewed.projectName)) return NAMELESS;
        return std::nullopt;
    }

    void take(const Session &renewed, const std::string &token, bool isNewKey) {
        int renewal = 0;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            session_ = renewed;
            token_ = token;
            if (isNewKey) {
                renewedAt_ = std::chrono::steady_clock::now();
                renewal = ++renewals_;
            }
        }
        relineIndicator(number_, line());
        if (!isNewKey) return;
        std::thread([weak = std::weak_ptr<Proxy>(shared_from_this()), renewal] {
            std::this_thread::sleep_for(RENEWED_SHOWN);
            const std::shared_ptr<Proxy> self = weak.lock();
            if (!self || !isOpenProxy(self.get())) return;
            {
                std::lock_guard<std::mutex> lock(self->mutex_);
                if (self->renewals_ != renewal) return;
            }
            relineIndicator(self->number_, self->line());
        }).detach();
    }

    void readDone(const Reading &reading) {
        std::vector<std::function<void(const Reading &)>> waiting;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            isReading_ = false;
            waiting.swap(waiting_);
        }
        for (const auto &then : waiting) then(reading);
    }

    const uint64_t number_;
    const bool isSnapshot_;
    const std::string sessionId_;
    const std::string projectId_;
    const int openedVersion_;
    const Account account_;
    const std::string source_;
    std::mutex mutex_;
    Session session_;
    std::string token_;
    std::chrono::steady_clock::time_point renewedAt_;
    int renewals_ = 0;
    bool isReading_ = false;
    std::vector<std::function<void(const Reading &)>> waiting_;
    std::atomic<bool> isReloading_{false};
};

std::mutex openerMutex;
std::optional<Checked> checked;
// The preview open, at most one: its origin, its proxy, its project as the note has it and the window its indicator went
// up on as it opened; and the number the last one served took.
std::optional<crossbind::Origin> openOrigin;
std::shared_ptr<Proxy> openProxy;
Noted openProject;
uint64_t openWindow = 0;
uint64_t previews = 0;
// Clear this project's data…'s question, while it is up: the preview it was asked for, and what closes it.
uint64_t askedToClear = 0;
std::function<void()> closeClearQuestion;

bool isOpenProxy(const Proxy *proxy) {
    std::lock_guard<std::mutex> lock(openerMutex);
    return openProxy.get() == proxy;
}

Value sheetOf(const Checked &found) {
    Value::Object sheet{{"session", found.session.id}, {"source", found.session.source}, {"project", Value::Object{{"name", found.session.projectName}}},
        {"account", Value::Object{{"name", found.account.name}}}};
    if (found.session.source == "dev") {
        sheet.emplace_back("on", found.on);
    } else {
        const std::optional<int> opened = openedVersion(found.session.id);
        sheet.emplace_back("version", found.session.version);
        sheet.emplace_back("opened", opened ? Value(*opened) : Value());
    }
    return Value(std::move(sheet));
}

// Steps 5 to 8 of the opener at the session's source, which on iOS and macOS, where the system has yet to let the app
// on the local network, are tried again every second for two minutes, the page told why meanwhile.
void checkAt(Call call, Session session, Account account, std::string gate, std::string originName, std::chrono::steady_clock::time_point until,
    std::shared_ptr<std::atomic<bool>> isCancelled) {
    verify(session, account, gate, [=](Verified verified) {
        if (*isCancelled) return;
        if (verified.words && verified.isUnreachable && asksForLocalNetwork() && session.source == "dev" && std::chrono::steady_clock::now() < until) {
            call.send(Value::Object{{"waiting", localNetworkWords(session.addresses.front())}, {"reason", *verified.words}});
            std::thread([=] {
                std::this_thread::sleep_for(LOCAL_NETWORK_RETRY);
                checkAt(call, session, account, gate, originName, until, isCancelled);
            }).detach();
            return;
        }
        if (verified.words) {
            call.reject(*verified.words);
            return;
        }
        const Checked found{session, account, verified.source, hostOf(verified.source), gate, originName};
        {
            std::lock_guard<std::mutex> lock(openerMutex);
            checked = found;
        }
        call.resolve(sheetOf(found));
    });
}

// Steps 1 to 8: the session read again by its id, whose form is checked before it reaches the URL, then its name, its
// protocol and a dev server's addresses, and the check at its source; the call answers the Open sheet's lines, and
// preview.open serves what it checked.
void check(Call call) {
    const std::string id = textOf(call.options()["session"]);
    if (!isSessionId(id)) {
        call.reject("This link opens no preview.");
        return;
    }
    auto isCancelled = std::make_shared<std::atomic<bool>>(false);
    call.onCancel([isCancelled] { *isCancelled = true; });
    withAccount([call, id, isCancelled](std::optional<Account> account, std::string token) {
        if (!account) {
            call.reject(signedOutWords());
            return;
        }
        askCloud("GET", "/v1/sessions/" + id, token, "", [call, id, account, isCancelled](Failure failure, int status, Value answer) {
            if (failure) return call.reject("Projects needs the network to read your account's list.");
            if (status == 401) return forgetSignIn([call] { call.reject(signedOutWords()); });
            if (status == 404) return call.reject(notListedWords(account->name));
            const std::optional<Session> session = status == 200 ? sessionOf(answer) : std::nullopt;
            if (!session || session->id != id) return call.reject(cloudWords(answer, "crossbind cloud sent a session this app cannot read."));
            if (!isListedName(session->projectName)) return call.reject(NAMELESS);
            if (session->protocol > MOST_PROTOCOL) return call.reject(newerWords(session->protocol));
            if (session->protocol < LEAST_PROTOCOL) return call.reject(olderWords(session->protocol, ""));
            for (const std::string &address : session->addresses) {
                if (!isLocalAddress(address)) return call.reject("crossbind opens a preview at a local address alone, and crossbind cloud lists this one at " + address + ".");
            }
            hmacSha256(*fromBase64url(session->key), GATE_TEXT, [=](Failure gateFailure, std::string gate) {
                if (gateFailure) return call.reject(*gateFailure);
                sha256("crossbind-origin." + account->id + "." + session->projectId, [=](Failure nameFailure, std::string digest) {
                    if (nameFailure) return call.reject(*nameFailure);
                    checkAt(call, *session, *account, toBase64url(gate), hexOf(digest).substr(0, ORIGIN_NAME_DIGITS),
                        std::chrono::steady_clock::now() + LOCAL_NETWORK_WAIT, isCancelled);
                });
            });
        });
    });
}

// The origin's requests: under the prefix the clearing's alone, and the proxy's while no clearing of the origin runs.
void answerOrigin(const std::string &name, const std::shared_ptr<Proxy> &proxy, Request request) {
    if (isClearingPath(request.path())) return answerClearing(name, std::move(request));
    if (isClearing(name)) return request.respond(404);
    proxy->answer(std::move(request));
}

void serve(const Call &call, const Checked &found) {
    if (isClearingAny()) {
        call.reject(clearingWords());
        return;
    }
    endPreview();
    uint64_t number = 0;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        number = ++previews;
    }
    auto proxy = std::make_shared<Proxy>(number, found.session, found.account, found.source, found.gateToken);
    const bool isSnapshot = found.session.source == "snapshot";
    const Noted project{found.originName, found.session.projectName, found.account.name, isSnapshot ? std::vector<std::string>{found.session.id} : std::vector<std::string>{}};
    try {
        const crossbind::Origin origin = crossbind::serveOrigin(
            found.originName, "project", [proxy, name = found.originName](Request request) { answerOrigin(name, proxy, std::move(request)); }, found.session.projectName);
        {
            std::lock_guard<std::mutex> lock(openerMutex);
            openOrigin = origin;
            openProxy = proxy;
            openProject = project;
        }
        noteProject(project.origin, project.project, project.account, isSnapshot ? found.session.id : "");
        if (isSnapshot) noteOpened(found.session.id, found.session.version);
        // The page goes to the origin once its requests' holder knows the preview they are of, and the indicator is up
        // on the page's window.
        Shown shown{found.session.projectName, proxy->line(), origin.url()};
        serveConsents({origin.url(), found.originName, found.session.projectName}, [call, url = origin.url(), shown, proxy](Answers answers) mutable {
            shown.answers = std::move(answers);
            markPreview(proxy->number(), call.page().windowId(), shown, [call, url, proxy](uint64_t window) {
                {
                    std::lock_guard<std::mutex> lock(openerMutex);
                    if (openProxy == proxy) {
                        openWindow = window;
                        call.resolve(Value::Object{{"url", url}});
                        return;
                    }
                }
                // Ended before its indicator went up: it comes down again, where no other preview's came up meanwhile.
                unmarkPreview(proxy->number());
                call.reject(ENDED_AS_OPENED);
            });
        });
    } catch (const std::exception &error) {
        call.reject(error.what());
    }
}

// Step 10: the session the page checked last, for the account signed in now, served as its origin, the project's name
// its label; the page then goes to the origin's URL. A check that ended after a sign-out opens nothing.
void open(Call call) {
    const std::string id = textOf(call.options()["session"]);
    std::optional<Checked> found;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        if (checked && checked->session.id == id) found.swap(checked);
    }
    if (!found) {
        call.reject(CHECK_FIRST);
        return;
    }
    withAccount([call, found = *found](std::optional<Account> account, std::string) {
        if (account && account->id == found.account.id) serve(call, found);
        else call.reject(CHECK_FIRST);
    });
}

}  // namespace

bool endPreview(const std::string &words, const std::string &session) {
    std::optional<crossbind::Origin> ending;
    std::function<void()> closeClear;
    uint64_t number = 0;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        if (!openOrigin || (!session.empty() && (!openProxy || openProxy->sessionId() != session))) return false;
        ending.swap(openOrigin);
        number = openProxy ? openProxy->number() : 0;
        openProxy.reset();
        openWindow = 0;
        askedToClear = 0;
        closeClear.swap(closeClearQuestion);
    }
    // Its questions close unanswered, and what the consent's asked for is denied, before the origin ends; its indicator
    // comes down with each window's next page that is no project's.
    if (closeClear) closeClear();
    endConsents();
    ending->end();
    unmarkPreview(number);
    if (!words.empty()) holdEvent("ended", Value::Object{{"message", words}});
    return true;
}

void closePreview() {
    if (endPreview()) holdEvent("ended", Value::Object{});
}

void reloadPreview() {
    std::shared_ptr<Proxy> proxy;
    uint64_t window = 0;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        proxy = openProxy;
        window = openWindow;
    }
    if (!proxy) return;
    if (proxy->isSnapshot()) proxy->reload(window);
    else reloadWindow(window);
}

void reloadPreviewOf(const std::string &name) {
    bool isOpen = false;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        isOpen = openOrigin && openProject.origin == name;
    }
    if (isOpen) reloadPreview();
}

#if !defined(__ANDROID__)
// On the main thread, as each platform's menu calls it.
void askToClear(const std::string &url) {
    uint64_t number = 0;
    uint64_t window = 0;
    std::string project;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        if (!openOrigin || openOrigin->url() != url || !openProxy || askedToClear != 0 || isClearingAny()) return;
        number = openProxy->number();
        askedToClear = number;
        window = openWindow;
        project = openProject.project;
    }
    const std::string message = "Remove what " + OPENING + project + CLOSING + " keeps on this device: its storage and its permissions?";
    std::function<void()> close = showClearQuestion(window, message, CLEAR_DETAIL, [number, url](std::optional<bool> isCleared) {
        {
            std::lock_guard<std::mutex> lock(openerMutex);
            if (askedToClear != number) return;
            askedToClear = 0;
            closeClearQuestion = nullptr;
        }
        if (isCleared.value_or(false)) clearPreview(url);
    });
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        if (askedToClear == number) {
            closeClearQuestion = std::move(close);
            return;
        }
    }
    // The preview ended, or the question was answered, as it came up.
    if (close) close();
}
#endif

// The clearing takes the origin first, so that the proxy serves nothing from then on.
void clearPreview(const std::string &url) {
    uint64_t number = 0;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        if (!openOrigin || openOrigin->url() != url || !openProxy) return;
        if (!beginClearing(notedProject(openProject.origin).value_or(openProject), *openOrigin, openWindow, true)) return;
        number = openProxy->number();
        openOrigin.reset();
        openProxy.reset();
        openWindow = 0;
        askedToClear = 0;
        closeClearQuestion = nullptr;
    }
    endConsents();
    unmarkPreview(number);
}

void readPreviewAgain() {
    std::shared_ptr<Proxy> proxy;
    uint64_t window = 0;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        proxy = openProxy;
        window = openWindow;
    }
    if (!proxy || !proxy->isSnapshot()) return;
    proxy->read([proxy, window](const Reading &reading) {
        if (!reading.isEnded && reading.isHigher && isOpenProxy(proxy.get())) reloadWindow(window);
    });
}

void forgetOpener() {
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        checked.reset();
    }
    endPreview();
}

void addOpenerFunctions(crossbind::Registry &registry) {
    registry.function("preview.check", check);
    registry.function("preview.open", open);
    registry.function("preview.close", [](Call call) {
        endPreview();
        call.resolve();
    });
}

}  // namespace preview
