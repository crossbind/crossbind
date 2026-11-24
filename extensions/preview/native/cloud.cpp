// What the extension asks crossbind cloud, the app's token in every call that needs one, which no page sees: the device
// sign-in with the number its user types, the account's list, signing out, the account's deletion, a compile and a
// snapshot's removal.
#include "preview.h"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <future>
#include <memory>
#include <mutex>
#include <thread>

namespace preview {
namespace {

using crossbind::Call;

constexpr std::size_t MAX_BODY_BYTES = 1024 * 1024;
constexpr int MATCH_FROM = 10;
constexpr int MATCH_TO = 99;
constexpr int SLOW_DOWN_SECONDS = 5;
constexpr int LEAST_POLL_SECONDS = 1;
constexpr std::size_t MOST_ADDRESSES = 4;
const std::string WRONG_NUMBER = "That was not the number the page showed. Start again.";
const std::string DENIED = "The sign-in was denied on the page.";
const std::string EXPIRED = "The code ran out after 10 minutes. Start again.";
const std::string NO_LIST = "Projects needs the network to read your account's list.";

std::string unreachableCloud(const std::string &failure) { return "crossbind cannot reach crossbind cloud: " + failure; }

// A device sign-in under way: the number its user types, once the page has approved the code.
struct SignIn {
    std::mutex mutex;
    std::condition_variable changed;
    bool isEnded = false;
    bool asksNumber = false;
    std::optional<int> number;
    std::string page;
};

std::mutex signInMutex;
std::shared_ptr<SignIn> running;

void endSignIn(const std::shared_ptr<SignIn> &attempt) {
    {
        std::lock_guard<std::mutex> lock(attempt->mutex);
        attempt->isEnded = true;
    }
    attempt->changed.notify_all();
    std::lock_guard<std::mutex> lock(signInMutex);
    if (running == attempt) running.reset();
}

std::shared_ptr<SignIn> runningSignIn() {
    std::lock_guard<std::mutex> lock(signInMutex);
    return running;
}

// The cloud's answer, waited for on a thread of the sign-in's own.
struct Answer {
    Failure failure;
    int status = 0;
    Value json;
};

Answer askedNow(const std::string &path, const std::string &body) {
    auto promise = std::make_shared<std::promise<Answer>>();
    std::future<Answer> answer = promise->get_future();
    askCloud("POST", path, "", body, [promise](Failure failure, int status, Value json) { promise->set_value({std::move(failure), status, std::move(json)}); });
    return answer.get();
}

void finishSignIn(Call call, const std::shared_ptr<SignIn> &attempt, const Value &answer) {
    const std::string token = textOf(answer["access_token"]);
    const Account account{textOf(answer["account"]["id"]), textOf(answer["account"]["name"])};
    if (token.empty() || account.id.empty() || account.name.empty()) {
        endSignIn(attempt);
        call.reject("crossbind cloud signed the app in with an answer it cannot read: start again.");
        return;
    }
    keepSignIn(account, token, [call, attempt, account](bool isKept) {
        endSignIn(attempt);
        call.resolve(Value::Object{{"account", Value::Object{{"id", account.id}, {"name", account.name}}}, {"keyring", isKept}});
    });
}

// Polls the device's sign-in every interval the cloud names, as RFC 8628 has it, five seconds more for each slow_down,
// until the page approves the code; then sends the number its user typed, once.
void poll(Call call, std::shared_ptr<SignIn> attempt, std::string deviceCode, int interval, std::chrono::steady_clock::time_point deadline) {
    const auto failed = [&call, &attempt](const std::string &words) {
        endSignIn(attempt);
        call.reject(words);
    };
    std::optional<int> sent;
    for (;;) {
        {
            std::unique_lock<std::mutex> lock(attempt->mutex);
            // The number goes as soon as its user typed it.
            if (!attempt->number || sent) attempt->changed.wait_for(lock, std::chrono::seconds(interval), [&attempt] { return attempt->isEnded; });
            if (attempt->isEnded) return;
        }
        if (std::chrono::steady_clock::now() > deadline) return failed(EXPIRED);
        Value::Object body{{"device_code", deviceCode}};
        {
            std::lock_guard<std::mutex> lock(attempt->mutex);
            if (attempt->number) sent = attempt->number;
        }
        if (sent) body.emplace_back("match", *sent);
        const Answer answer = askedNow("/v1/device/token", Value(std::move(body)).json());
        // A connection lost is the next poll's to try again.
        if (answer.failure) continue;
        if (answer.status == 200) return finishSignIn(call, attempt, answer.json);
        const std::string error = textOf(answer.json["error"]);
        if (error == "authorization_pending") continue;
        if (error == "slow_down") {
            interval += SLOW_DOWN_SECONDS;
            continue;
        }
        if (error == "matching_required" && !sent) {
            // The number is taken from the moment the page is asked for it.
            {
                std::lock_guard<std::mutex> lock(attempt->mutex);
                attempt->asksNumber = true;
            }
            call.send(Value::Object{{"number", true}});
            std::unique_lock<std::mutex> lock(attempt->mutex);
            attempt->changed.wait_until(lock, deadline, [&attempt] { return attempt->isEnded || attempt->number.has_value(); });
            if (attempt->isEnded) return;
            if (!attempt->number) {
                lock.unlock();
                return failed(EXPIRED);
            }
            continue;
        }
        if (error == "access_denied") return failed(sent ? WRONG_NUMBER : DENIED);
        if (error == "expired_token") return failed(EXPIRED);
        return failed(cloudWords(answer.json, "crossbind cloud ended the sign-in: start again."));
    }
}

// The sign-in: the page gets its code and the address of the page that approves it as the call's first message, then
// a message that asks for the number that page shows, which preview.signInNumber gives; the call answers the account.
void signIn(Call call) {
    auto attempt = std::make_shared<SignIn>();
    std::shared_ptr<SignIn> before;
    {
        std::lock_guard<std::mutex> lock(signInMutex);
        before = running;
        running = attempt;
    }
    if (before) endSignIn(before);
    call.onCancel([attempt] { endSignIn(attempt); });
    const Value::Object body{{"client", "app"}, {"version", config().version}, {"platform", config().platform}, {"os", config().system}};
    askCloud("POST", "/v1/device/authorize", "", Value(body).json(), [call, attempt](Failure failure, int status, Value answer) {
        const auto failed = [&call, &attempt](const std::string &words) {
            endSignIn(attempt);
            call.reject(words);
        };
        if (failure) return failed(unreachableCloud(*failure));
        if (status != 200) return failed(cloudWords(answer, "crossbind cloud did not start the sign-in: try again."));
        const std::string deviceCode = textOf(answer["device_code"]);
        const std::string code = textOf(answer["user_code"]);
        const std::string page = textOf(answer["verification_uri"]);
        // The page is the cloud's own, as the CLI holds it to.
        if (page.rfind(config().api + "/", 0) != 0) return failed("crossbind cloud named a sign-in page off its own address: " + page);
        if (deviceCode.empty() || code.empty()) return failed("crossbind cloud started a sign-in this app cannot read: try again.");
        const int interval = std::max(integerOf(answer["interval"]).value_or(SLOW_DOWN_SECONDS), LEAST_POLL_SECONDS);
        const int expiresIn = integerOf(answer["expires_in"]).value_or(0);
        {
            std::lock_guard<std::mutex> lock(attempt->mutex);
            attempt->page = page;
        }
        call.send(Value::Object{{"code", code}, {"page", page}, {"expiresIn", expiresIn}});
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(expiresIn);
        std::thread(poll, call, attempt, deviceCode, interval, deadline).detach();
    });
}

void signInNumber(Call call) {
    const std::optional<int> number = integerOf(call.options()["number"]);
    if (!number || *number < MATCH_FROM || *number > MATCH_TO) {
        call.reject("crossbind: preview.signInNumber takes the two digits the page shows, as { number: 47 }.");
        return;
    }
    const std::shared_ptr<SignIn> attempt = runningSignIn();
    if (!attempt) {
        call.reject("No sign-in waits for a number: start again.");
        return;
    }
    {
        std::lock_guard<std::mutex> lock(attempt->mutex);
        if (!attempt->asksNumber || attempt->number) {
            call.reject(attempt->number ? "The sign-in takes one number: start again." : "The page has not approved the code yet.");
            return;
        }
        attempt->number = number;
    }
    attempt->changed.notify_all();
    call.resolve();
}

void openPage(Call call) {
    const std::shared_ptr<SignIn> attempt = runningSignIn();
    std::string page;
    if (attempt) {
        std::lock_guard<std::mutex> lock(attempt->mutex);
        page = attempt->page;
    }
    if (page.empty()) {
        call.reject("No sign-in is under way: start one first.");
        return;
    }
    openSignInPage(page, [call](Failure failure) {
        if (failure) call.reject(*failure);
        else call.resolve();
    });
}

void signOut(Call call) {
    withAccount([call](std::optional<Account> account, std::string token) {
        if (!account) {
            call.resolve(Value::Object{{"revoked", true}});
            return;
        }
        // Signing out signs out on the device whatever the cloud answers, and says so where the token could not go.
        askCloud("DELETE", "/v1/token", token, "", [call](Failure failure, int status, Value) {
            const bool isRevoked = !failure && (status == 204 || status == 401);
            forgetSignIn([call, isRevoked] {
                if (isRevoked) call.resolve(Value::Object{{"revoked", true}});
                else call.resolve(Value::Object{{"revoked", false}, {"message", "The token could not be revoked. Sign it out on your account's page, under Devices."}});
            });
        });
    });
}

void deleteAccount(Call call) {
    withAccount([call](std::optional<Account> account, std::string token) {
        if (!account) {
            call.reject(signedOutWords());
            return;
        }
        askCloud("DELETE", "/v1/account", token, "", [call, name = account->name](Failure failure, int status, Value answer) {
            if (failure) {
                call.reject("Deleting your account needs the network.");
                return;
            }
            if (status == 401) {
                forgetSignIn([call] { call.reject(signedOutWords()); });
                return;
            }
            if (status != 204) {
                call.reject(cloudWords(answer, "crossbind cloud did not delete the account: try again."));
                return;
            }
            forgetSignIn([call, name] { call.resolve(Value::Object{{"message", name + " is deleted, with its tokens, sessions and snapshots."}}); });
        });
    });
}

// A session as the page sees it in the list: no key, and of a dev server the address the app asks first.
Value shownSession(const Session &session) {
    Value::Object shown{{"id", session.id}, {"source", session.source}, {"project", Value::Object{{"name", session.projectName}}},
        {"createdAt", session.createdAt}};
    if (session.source == "dev") {
        shown.emplace_back("on", session.addresses.front());
    } else {
        const std::optional<int> opened = openedVersion(session.id);
        shown.emplace_back("version", session.version);
        shown.emplace_back("opened", opened ? Value(*opened) : Value());
    }
    return Value(std::move(shown));
}

Value signedOutList() { return Value::Object{{"account", Value()}, {"sessions", Value::Array{}}, {"message", signedOutWords()}}; }

void sessions(Call call) {
    withAccount([call](std::optional<Account> account, std::string token) {
        if (!account) {
            call.resolve(signedOutList());
            return;
        }
        askCloud("GET", "/v1/sessions", token, "", [call, account](Failure failure, int status, Value answer) {
            if (failure) {
                call.reject(NO_LIST);
                return;
            }
            if (status == 401) {
                forgetSignIn([call] { call.resolve(signedOutList()); });
                return;
            }
            if (status != 200 || !answer["sessions"].isArray()) {
                call.reject(cloudWords(answer, NO_LIST));
                return;
            }
            std::vector<Session> found;
            Value::Array shown;
            for (const Value &item : answer["sessions"].asArray()) {
                const std::optional<Session> session = sessionOf(item);
                if (!session) continue;
                shown.push_back(shownSession(*session));
                found.push_back(*session);
            }
            keepList(found);
            call.resolve(Value::Object{{"account", Value::Object{{"id", account->id}, {"name", account->name}}}, {"sessions", Value(std::move(shown))},
                {"message", found.empty() ? Value(emptyListWords(account->name)) : Value()}});
        });
    });
}

// The playground's compile with the app's token, answered as the cloud answers: its status, then its answer's members.
void compile(Call call) {
    std::string body;
    try {
        body = Value(Value::Object{{"files", call.options()["files"]}, {"packages", call.options()["packages"]}}).json();
    } catch (const std::exception &) {
        call.reject("crossbind: preview.compile takes { files, packages } as JSON.");
        return;
    }
    if (body.size() > MAX_BODY_BYTES) {
        call.reject("crossbind: a compile sends 1 MiB at most.");
        return;
    }
    withAccount([call, body](std::optional<Account> account, std::string token) {
        if (!account) {
            call.reject("Sign in to compile your own C++ and Rust. The samples run as they are.");
            return;
        }
        askCloud("POST", "/playground/compile", token, body, [call](Failure failure, int status, Value answer) {
            if (failure) {
                call.reject("Compiling needs the network. The samples run as they are.");
                return;
            }
            Value::Object compiled{{"status", status}};
            if (answer.isObject()) {
                for (const auto &[name, value] : answer.asObject()) {
                    if (name == "status") compiled.front().second = value;
                    else compiled.emplace_back(name, value);
                }
            }
            call.resolve(Value(std::move(compiled)));
        });
    });
}

// A snapshot of the account's list, as preview.sessions() gave it, removed from crossbind cloud.
void removeSnapshot(Call call) {
    const std::string id = textOf(call.options()["session"]);
    const std::optional<Session> session = isSessionId(id) ? listed(id) : std::nullopt;
    if (!session || session->source != "snapshot") {
        call.reject("crossbind: preview.removeSnapshot removes a snapshot of the list preview.sessions() gave last.");
        return;
    }
    withAccount([call, id](std::optional<Account> account, std::string token) {
        if (!account) {
            call.reject(signedOutWords());
            return;
        }
        askCloud("DELETE", "/v1/snapshots/" + id, token, "", [call, id](Failure failure, int status, Value answer) {
            if (failure) {
                call.reject("Removing a snapshot needs the network.");
                return;
            }
            if (status != 204 && status != 404) {
                call.reject(cloudWords(answer, "crossbind cloud did not remove the snapshot: try again."));
                return;
            }
            dropListed(id);
            endPreview("This snapshot is no longer on your account's list.", id);
            if (status == 404) call.reject("This snapshot is no longer on your account's list.");
            else call.resolve();
        });
    });
}

}  // namespace

void askCloud(const std::string &method, const std::string &path, const std::string &token, const std::string &body,
    std::function<void(Failure failure, int status, Value answer)> done) {
    crossbind::Request::Headers headers{{"Accept", "application/json"}};
    if (!token.empty()) headers.emplace_back("Authorization", "Bearer " + token);
    if (!body.empty()) headers.emplace_back("Content-Type", "application/json");
    try {
        crossbind::fetch(method, config().api + path, headers, body, [done](Failure failure, crossbind::FetchResponse response) {
            if (failure) {
                done(failure, 0, {});
                return;
            }
            Value answer;
            try {
                if (!response.body.empty()) answer = parseJson(response.body);
            } catch (const std::exception &) {
                // An answer that is no JSON is told by its status alone.
            }
            done(std::nullopt, response.status, std::move(answer));
        });
    } catch (const std::exception &error) {
        done(std::string(error.what()), 0, {});
    }
}

std::optional<Session> sessionOf(const Value &value) {
    Session session;
    session.id = textOf(value["id"]);
    session.source = textOf(value["source"]);
    session.projectId = textOf(value["project"]["id"]);
    session.projectName = textOf(value["project"]["name"]);
    session.key = textOf(value["key"]);
    session.protocol = integerOf(value["protocol"]).value_or(0);
    session.createdAt = textOf(value["createdAt"]);
    if (!isSessionId(session.id) || !isSessionId(session.projectId) || !isKey(session.key) || session.protocol < 1) return std::nullopt;
    if (session.source == "snapshot") {
        session.version = integerOf(value["version"]).value_or(0);
        if (session.version < 1) return std::nullopt;
        return session;
    }
    if (session.source != "dev" || !value["addresses"].isArray()) return std::nullopt;
    for (const Value &address : value["addresses"].asArray()) session.addresses.push_back(textOf(address));
    if (session.addresses.empty() || session.addresses.size() > MOST_ADDRESSES) return std::nullopt;
    return session;
}

std::string cloudWords(const Value &answer, const std::string &otherwise) {
    const std::string description = textOf(answer["error_description"]);
    if (!description.empty()) return description;
    const std::string error = textOf(answer["error"]);
    return error.empty() ? otherwise : error;
}

void addCloudFunctions(crossbind::Registry &registry) {
    registry.function("preview.signIn", signIn);
    registry.function("preview.signInNumber", signInNumber);
    registry.function("preview.openSignInPage", openPage);
    registry.function("preview.signOut", signOut);
    registry.function("preview.deleteAccount", deleteAccount);
    registry.function("preview.sessions", sessions);
    registry.function("preview.compile", compile);
    registry.function("preview.removeSnapshot", removeSnapshot);
}

}  // namespace preview
