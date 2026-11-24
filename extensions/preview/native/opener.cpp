// The opener: a session of the account's list, read again by its id, checked in order before a byte of its project
// loads (its protocol, its source's proof made with its key, then the account and the session the proof covers), and
// once its page's own Open, served as an origin of the account's and the project's, whose handler is the proxy of the
// session's source. A snapshot's host that refuses the proxy's token after the key was made anew is asked again, once.
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
constexpr std::size_t ORIGIN_NAME_DIGITS = 32;
constexpr std::size_t MAX_SESSION_ANSWER = 64 * 1024;
// iOS and macOS hold a first connection to the local network back while their user is asked: tried every second.
constexpr auto LOCAL_NETWORK_RETRY = std::chrono::seconds(1);
constexpr auto LOCAL_NETWORK_WAIT = std::chrono::minutes(2);
const std::string GATE_TEXT = "crossbind-requests";
const std::string GONE = "This snapshot is no longer on your account's list.";
const std::string CHECK_FIRST = "crossbind opens the preview it checked last: check it first.";
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

// The proxy of an open preview's origin: each GET and HEAD a fetch of the session's source, with the request's Accept,
// Accept-Language and Range alone and the gate's token, its answer passed back with its status and the headers PASSED
// names; a redirect, which no web view follows for an app's origin, a status no web view takes and a failure answer
// 502 with the reason.
class Proxy : public std::enable_shared_from_this<Proxy> {
public:
    Proxy(Session session, Account account, std::string source, std::string gateToken)
        : isSnapshot_(session.source == "snapshot"), sessionId_(session.id), account_(std::move(account)), source_(std::move(source)),
          session_(std::move(session)), token_(std::move(gateToken)) {}

    const std::string &sessionId() const { return sessionId_; }

    void answer(Request request) {
        std::string token;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            token = token_;
        }
        const std::string url = source_ + escapedPath(request.path()) + (request.query().empty() ? "" : "?" + request.query());
        send(std::move(request), url, token, false);
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
                if (response.status < 200 || response.status > 599 || (response.status >= 300 && response.status < 400)) {
                    request.respond(502, TEXT, "the source answered " + std::to_string(response.status));
                    return;
                }
                if (response.status == 403 && self->isSnapshot_ && !isRetry) {
                    self->rekey(token, [self, request, url, response](std::optional<std::string> renewed) {
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

    // A HEAD's length is the source's, as its answer names it; every other answer's its body's own.
    static void pass(const Request &request, const crossbind::FetchResponse &response) {
        Request::Headers passed;
        for (const auto &[name, value] : response.headers) {
            const bool isPassed = std::find(PASSED.begin(), PASSED.end(), name) != PASSED.end();
            if (isPassed || (name == "content-length" && request.method() == "HEAD")) passed.emplace_back(name, value);
        }
        request.respond(response.status, passed, response.body);
    }

    // The snapshot's host refused the token: the session is read again, and a key made anew is checked as the first was,
    // its token then taken for every request; a session gone ends the preview. Requests refused meanwhile wait for the
    // one reading.
    void rekey(const std::string &used, std::function<void(std::optional<std::string>)> then) {
        std::optional<std::string> current;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (token_ != used) {
                current = token_;
            } else {
                waiting_.push_back(std::move(then));
                if (isRekeying_) return;
                isRekeying_ = true;
            }
        }
        if (current) return then(current);
        withAccount([self = shared_from_this()](std::optional<Account> account, std::string appToken) {
            if (!account || account->id != self->account_.id) return self->rekeyed(std::nullopt);
            askCloud("GET", "/v1/sessions/" + self->sessionId_, appToken, "", [self, account](Failure failure, int status, Value answer) {
                if (!failure && status == 404) {
                    self->rekeyed(std::nullopt);
                    endPreview(GONE, self->sessionId_);
                    return;
                }
                const std::optional<Session> renewed = failure || status != 200 ? std::nullopt : sessionOf(answer);
                std::string key;
                {
                    std::lock_guard<std::mutex> lock(self->mutex_);
                    key = self->session_.key;
                }
                if (!renewed || renewed->id != self->sessionId_ || renewed->source != "snapshot" || renewed->key == key) return self->rekeyed(std::nullopt);
                hmacSha256(*fromBase64url(renewed->key), GATE_TEXT, [self, account, renewed](Failure hashFailure, std::string gate) {
                    if (hashFailure) return self->rekeyed(std::nullopt);
                    const std::string token = toBase64url(gate);
                    verify(*renewed, *account, token, [self, renewed, token](Verified verified) {
                        if (verified.words) return self->rekeyed(std::nullopt);
                        {
                            std::lock_guard<std::mutex> lock(self->mutex_);
                            self->session_ = *renewed;
                            self->token_ = token;
                        }
                        self->rekeyed(token);
                    });
                });
            });
        });
    }

    void rekeyed(std::optional<std::string> token) {
        std::vector<std::function<void(std::optional<std::string>)>> waiting;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            isRekeying_ = false;
            waiting.swap(waiting_);
        }
        for (const auto &then : waiting) then(token);
    }

    const bool isSnapshot_;
    const std::string sessionId_;
    const Account account_;
    const std::string source_;
    std::mutex mutex_;
    Session session_;
    std::string token_;
    bool isRekeying_ = false;
    std::vector<std::function<void(std::optional<std::string>)>> waiting_;
};

std::mutex openerMutex;
std::optional<Checked> checked;
// The preview open, at most one: its origin and its proxy.
std::optional<crossbind::Origin> openOrigin;
std::shared_ptr<Proxy> openProxy;

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

void serve(const Call &call, const Checked &found) {
    endPreview();
    auto proxy = std::make_shared<Proxy>(found.session, found.account, found.source, found.gateToken);
    try {
        const crossbind::Origin origin = crossbind::serveOrigin(
            found.originName, "project", [proxy](Request request) { proxy->answer(std::move(request)); }, found.session.projectName);
        {
            std::lock_guard<std::mutex> lock(openerMutex);
            openOrigin = origin;
            openProxy = proxy;
        }
        if (found.session.source == "snapshot") noteOpened(found.session.id, found.session.version);
        call.resolve(Value::Object{{"url", origin.url()}});
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

void endPreview(const std::string &words, const std::string &session) {
    std::optional<crossbind::Origin> ending;
    {
        std::lock_guard<std::mutex> lock(openerMutex);
        if (!openOrigin || (!session.empty() && (!openProxy || openProxy->sessionId() != session))) return;
        ending.swap(openOrigin);
        openProxy.reset();
    }
    ending->end();
    if (!words.empty()) holdEvent("ended", Value::Object{{"message", words}});
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
