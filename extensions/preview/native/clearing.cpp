// What a project keeps on this device removed, for its origin alone, from the preview's menu or by the app's page: the
// origin is served for the clearing alone, nothing of the project's passed to a source, and its own page, the
// extension's text, removes the origin's storage, then tells its end with the token the extension loaded it with; the
// extension then removes its own, the origin's answers, its note and its snapshots' versions, and ends the origin, its
// window showing the app's page again. On Windows, where a project's service worker may answer before the extension's
// handler, the web view's own removal does it first. And what Settings' "Projects' data" calls.
#include "preview.h"

#include <algorithm>
#include <chrono>
#include <mutex>
#include <thread>

namespace preview {
namespace {

using crossbind::Call;
using crossbind::Request;

const std::string PREFIX = "/__crossbind-preview/";
const std::string PAGE_PATH = PREFIX + "clear";
const std::string END_PATH = PREFIX + "cleared";
// A clearing that its page has not ended by then ends all the same: its page took 4 to 109 ms where it was measured.
constexpr auto CLEARING_TIME = std::chrono::seconds(10);
constexpr std::size_t TOKEN_BYTES = 32;
// What the page names what stays by, with the words its user reads.
const std::vector<std::pair<std::string, std::string>> STORES{{"serviceWorkers", "service workers"}, {"caches", "Cache Storage"}, {"indexedDB", "IndexedDB"},
    {"opfs", "OPFS"}, {"localStorage", "localStorage"}, {"sessionStorage", "sessionStorage"}, {"cookies", "cookies"}};
const std::string CLEARING_NOW = "crossbind clears a project's data now: try again once that is done.";
const std::string UNLISTED_CLEAR = "crossbind: preview.clearData(id) clears the data of a project preview.projects() lists.";
const std::string UNLISTED_TAKE_BACK = "crossbind: preview.takeBack(id, kind) takes back the camera's, the microphone's or the location's Allow of a project preview.projects() lists.";
const std::string REST = " Its permissions are removed; clear its data again to remove the rest.";
const Request::Headers PAGE_HEADERS{{"Content-Type", "text/html; charset=utf-8"}, {"Cache-Control", "no-store"}};

// The page takes the token from its URL, which it then leaves, as another page of the origin hears the URL of the one
// that changes its storage; it removes each item of each store, and names a store where one stays or where it cannot
// list them; it waits for each, a database another of the origin's pages holds open among them, which the clearing's
// time ends.
const std::string PAGE = R"HTML(<!doctype html>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<script>
(async () => {
    const token = new URLSearchParams(location.search).get('token');
    history.replaceState(null, '', location.pathname);
    const left = [];
    const each = async (store, list, remove) => {
        let items = [];
        try {
            items = await list();
        } catch {
            left.push(store);
            return;
        }
        for (const item of items) {
            try {
                await remove(item);
            } catch {
                if (!left.includes(store)) left.push(store);
            }
        }
    };
    await each('serviceWorkers', () => (navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : []), async (registration) => {
        if (!(await registration.unregister())) throw new Error();
    });
    await each('caches', () => (self.caches ? caches.keys() : []), async (name) => {
        if (!(await caches.delete(name))) throw new Error();
    });
    await each('indexedDB', () => (self.indexedDB ? indexedDB.databases() : []), ({ name }) => new Promise((done, fail) => {
        const deleting = indexedDB.deleteDatabase(name);
        deleting.onsuccess = done;
        deleting.onerror = () => fail(deleting.error);
    }));
    await each('opfs', async () => {
        if (!navigator.storage?.getDirectory) return [];
        const root = await navigator.storage.getDirectory();
        const names = [];
        for await (const name of root.keys()) names.push(name);
        return names.map((name) => () => root.removeEntry(name, { recursive: true }));
    }, (remove) => remove());
    await each('localStorage', () => [localStorage], (storage) => storage.clear());
    await each('sessionStorage', () => [sessionStorage], (storage) => storage.clear());
    const cookies = () => document.cookie.split(';').map((pair) => pair.split('=')[0].trim()).filter(Boolean);
    await each('cookies', cookies, (name) => {
        for (const path of ['/', '/__crossbind-preview']) {
            for (const domain of ['', `; domain=${location.hostname}`]) document.cookie = `${name}=; max-age=0; path=${path}${domain}`;
        }
        if (cookies().includes(name)) throw new Error();
    });
    await fetch(`/__crossbind-preview/cleared?token=${token}&left=${left.join(',')}`, { cache: 'no-store' });
})();
</script>
)HTML";

// The clearing that runs: its number, the project as the note has it, its origin, the token its page is loaded and
// tells its end with, emptied once used, and whether the preview's menu began it.
struct Clearing {
    uint64_t number = 0;
    Noted project;
    crossbind::Origin origin;
    std::string token;
    bool isFromMenu = false;
};

// How a clearing ended: told by its page, with what stays, or not; and Windows' own removal's failure.
struct Outcome {
    bool isTold = false;
    std::vector<std::string> left;
    Failure unremoved;
};

std::mutex clearingMutex;
std::optional<Clearing> clearing;
uint64_t clearings = 0;

std::string quoted(const std::string &project) { return "\xE2\x80\x9C" + project + "\xE2\x80\x9D"; }

// The value of a part of a query, as "left" of "token=…&left=indexedDB": none where it has no such part.
std::string valueOf(const std::string &query, const std::string &name) {
    for (std::size_t from = 0; from <= query.size();) {
        const std::size_t amp = query.find('&', from);
        const std::string part = query.substr(from, amp == std::string::npos ? std::string::npos : amp - from);
        if (part.rfind(name + "=", 0) == 0) return part.substr(name.size() + 1);
        if (amp == std::string::npos) break;
        from = amp + 1;
    }
    return {};
}

// The stores the page names, its own words alone, each once.
std::vector<std::string> leftOf(const std::string &text) {
    std::vector<std::string> left;
    for (const auto &[store, words] : STORES) {
        if (("," + text + ",").find("," + store + ",") != std::string::npos) left.push_back(words);
    }
    return left;
}

// What its user is told stays, where something may.
std::optional<std::string> staysOf(const std::string &project, const Outcome &outcome) {
    if (outcome.unremoved) return "crossbind could not remove what " + quoted(project) + " keeps on this device: " + *outcome.unremoved + "." + REST;
    if (!outcome.isTold) return "crossbind could not finish clearing what " + quoted(project) + " keeps on this device, so some of it may stay." + REST;
    if (outcome.left.empty()) return std::nullopt;
    std::string named;
    for (std::size_t i = 0; i < outcome.left.size(); i += 1) {
        if (i > 0) named += i + 1 == outcome.left.size() ? " and " : ", ";
        named += outcome.left[i];
    }
    return "Some of what " + quoted(project) + " keeps stays on this device: " + named + "." + REST;
}

// The clearing of this number ended, once: the origin's answers go whatever happened, and its note and snapshots'
// versions where nothing stays, so that a project something of which stays is listed to clear again.
void endClearing(uint64_t number, const Outcome &outcome) {
    std::optional<Clearing> ended;
    {
        std::lock_guard<std::mutex> lock(clearingMutex);
        if (!clearing || clearing->number != number) return;
        ended.swap(clearing);
    }
    const Noted &project = ended->project;
    forgetConsents(project.origin);
    const std::optional<std::string> stays = staysOf(project.project, outcome);
    if (!stays) {
        forgetVersions(project.snapshots);
        forgetProject(project.origin);
    }
    // Held before the app's page that comes reads them.
    if (ended->isFromMenu) holdEvent("ended", Value::Object{});
    Value::Object cleared{{"id", project.origin}, {"name", project.project}, {"account", project.account}};
    if (stays) cleared.emplace_back("message", *stays);
    holdEvent("cleared", Value(std::move(cleared)));
    ended->origin.end();
}

// preview.clearData: whatever preview is open ends first, then the origin is served for the clearing alone, whose page
// loads in the window of the page that asked; it answers once the clearing has begun, as that page is about to go.
void clearData(Call call) {
    const std::string id = textOf(call.options()["id"]);
    const std::optional<Noted> project = isOriginName(id) ? notedProject(id) : std::nullopt;
    if (!project) {
        call.reject(UNLISTED_CLEAR);
        return;
    }
    if (isClearingAny()) {
        call.reject(CLEARING_NOW);
        return;
    }
    endPreview();
    try {
        const crossbind::Origin origin = crossbind::serveOrigin(
            id, "project",
            [id](Request request) {
                if (isClearingPath(request.path())) answerClearing(id, std::move(request));
                else request.respond(404);
            },
            project->project);
        if (!beginClearing(*project, origin, call.page().windowId(), false)) {
            origin.end();
            call.reject(CLEARING_NOW);
            return;
        }
        call.resolve();
    } catch (const std::exception &error) {
        call.reject(error.what());
    }
}

// preview.projects: each project the note holds, signed in or not, in the order of their names, with the kinds its user
// answered, kept or held for the run.
void projects(Call call) {
    const std::vector<Noted> noted = notedProjects();
    std::vector<std::string> origins;
    for (const Noted &each : noted) origins.push_back(each.origin);
    consentsOf(origins, [call, noted](std::map<std::string, Answers> answers) {
        Value::Array listed;
        for (const Noted &each : noted) {
            Value::Object consents;
            for (const auto &[kind, isAllowed] : answers[each.origin]) consents.emplace_back(kind, isAllowed);
            listed.emplace_back(Value::Object{{"id", each.origin}, {"name", each.project}, {"account", each.account}, {"consents", Value(std::move(consents))}});
        }
        call.resolve(Value::Object{{"projects", Value(std::move(listed))}});
    });
}

// preview.takeBack: an Allow of a project the note lists made Don't Allow, and nothing else; the page of that origin's
// open preview reloads, as a change at Permissions reloads it.
void takeBack(Call call) {
    const std::string id = textOf(call.options()["id"]);
    const std::string kind = textOf(call.options()["kind"]);
    const bool isKind = std::find(ASKED_KINDS.begin(), ASKED_KINDS.end(), kind) != ASKED_KINDS.end();
    if (!isKind || !isOriginName(id) || !notedProject(id)) {
        call.reject(UNLISTED_TAKE_BACK);
        return;
    }
    takeBackConsent(id, kind, [call, id](bool isTaken, bool isServed) {
        if (isTaken && isServed) reloadPreviewOf(id);
        call.resolve();
    });
}

}  // namespace

bool isClearingPath(const std::string &path) { return path.rfind(PREFIX, 0) == 0; }

bool isClearing(const std::string &origin) {
    std::lock_guard<std::mutex> lock(clearingMutex);
    return clearing && clearing->project.origin == origin;
}

bool isClearingAny() {
    std::lock_guard<std::mutex> lock(clearingMutex);
    return clearing.has_value();
}

std::string clearingWords() { return CLEARING_NOW; }

bool beginClearing(const Noted &project, crossbind::Origin origin, uint64_t window, bool isFromMenu) {
    std::string token;
    try {
        token = toBase64url(randomBytes(TOKEN_BYTES));
    } catch (const std::exception &) {
        return false;
    }
    uint64_t number = 0;
    {
        std::lock_guard<std::mutex> lock(clearingMutex);
        if (clearing) return false;
        number = ++clearings;
        clearing = Clearing{number, project, origin, token, isFromMenu};
    }
    const std::string page = origin.url() + PAGE_PATH.substr(1) + "?token=" + token;
#if defined(_WIN32)
    removeOriginData(window, origin.url(), [number, window, page](Failure failure) {
        if (failure) endClearing(number, {false, {}, failure});
        else loadWindow(window, page);
    });
#else
    loadWindow(window, page);
#endif
    std::thread([number] {
        std::this_thread::sleep_for(CLEARING_TIME);
        endClearing(number, {});
    }).detach();
    return true;
}

// The prefix's paths: the page of the origin's clearing and its end, each asked with its token while it runs and its
// token is unused; 404 for every other, as for each outside a clearing.
void answerClearing(const std::string &origin, Request request) {
    bool isPage = false;
    std::optional<uint64_t> told;
    std::vector<std::string> left;
    {
        std::lock_guard<std::mutex> lock(clearingMutex);
        const bool isOwn = clearing && clearing->project.origin == origin && !clearing->token.empty()
            && isSameSecret(valueOf(request.query(), "token"), clearing->token);
        isPage = isOwn && request.path() == PAGE_PATH;
        if (isOwn && request.path() == END_PATH) {
            clearing->token.clear();
            told = clearing->number;
            left = leftOf(valueOf(request.query(), "left"));
        }
    }
    if (isPage) {
        request.respond(200, PAGE_HEADERS, PAGE);
        return;
    }
    if (!told) {
        request.respond(404);
        return;
    }
    request.respond(204);
    endClearing(*told, {true, std::move(left), std::nullopt});
}

void addClearingFunctions(crossbind::Registry &registry) {
    registry.function("preview.projects", projects);
    registry.function("preview.takeBack", takeBack);
    registry.function("preview.clearData", clearData);
}

}  // namespace preview
