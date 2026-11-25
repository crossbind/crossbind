package dev.crossbind.extension.preview;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.util.JsonReader;
import android.util.JsonToken;
import android.util.Log;
import android.view.KeyEvent;

import dev.crossbind.app.Extension.PagePermission;
import dev.crossbind.app.ExtensionHost;

import java.io.File;
import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;

import org.json.JSONException;
import org.json.JSONObject;

// The camera, the microphone and the location a project's page asks for, on Android: the app's own question, an
// AlertDialog over the activity, for the preview the extension's native code serves and answered at its two buttons
// alone, and each answer kept in preview/consents.json in the app's files by the origin's name and the kind, as the
// native code keeps it on the other platforms. A store that cannot be read, is no JSON or has another shape gives no
// consent, and a value that is neither true nor false is no answer. On the UI thread alone.
final class Consents {
    private static final String TAG = "Crossbind";
    // The kinds a project is asked for; any other is denied it with no question.
    private static final List<String> ASKED = List.of("camera", "microphone", "location");
    private static final String DETAIL = "It is a preview of your project. You can change this in the preview's menu.";

    // What an allowed request goes on to: the system's own question for the app, once.
    private final BiConsumer<ExtensionHost, PagePermission> allowed;
    // The preview served: its origin's URL, the origin's name its answers are kept under, and the project's name from
    // the account's list, which the question shows.
    private String url;
    private String name;
    private String project;
    // The requests that wait for the question up, in the order they came.
    private final List<PagePermission> waiting = new ArrayList<>();
    private AlertDialog question;
    // The answers the store could not keep, which hold for the app's run: by the origin's name and the kind.
    private final Map<String, Map<String, Boolean>> held = new HashMap<>();

    Consents(BiConsumer<ExtensionHost, PagePermission> allowed) {
        this.allowed = allowed;
    }

    void serve(String url, String name, String project) {
        end();
        this.url = url;
        this.name = name;
        this.project = project;
    }

    // The preview's end: its question closes unanswered, what waits for it is denied, and nothing is kept.
    void end() {
        url = null;
        name = null;
        project = null;
        AlertDialog shown = question;
        question = null;
        if (shown != null) shown.dismiss();
        List<PagePermission> ending = new ArrayList<>(waiting);
        waiting.clear();
        for (PagePermission request : ending) request.deny();
    }

    // One of the three kinds alone, each listed in app.permissions, of the preview's own origin.
    void ask(ExtensionHost host, PagePermission request) {
        boolean isAskable = request.isListed() && !request.kinds().isEmpty() && ASKED.containsAll(request.kinds());
        if (!isAskable || url == null || !(request.origin() + "/").equals(url)) {
            request.deny();
            return;
        }
        waiting.add(request);
        settle(host);
    }

    // Decides each waiting request that what is kept decides, and asks about the first other one's kinds not answered
    // yet, where no question is up.
    private void settle(ExtensionHost host) {
        Object store = read(storeOf(host));
        List<PagePermission> granted = new ArrayList<>();
        List<PagePermission> denied = new ArrayList<>();
        List<PagePermission> still = new ArrayList<>();
        for (PagePermission request : waiting) {
            Boolean kept = keptFor(store, request.kinds());
            if (kept == null) still.add(request);
            else (kept ? granted : denied).add(request);
        }
        waiting.clear();
        waiting.addAll(still);
        for (PagePermission request : denied) request.deny();
        for (PagePermission request : granted) allowed.accept(host, request);
        if (question != null || waiting.isEmpty()) return;
        List<String> kinds = new ArrayList<>();
        for (String kind : waiting.get(0).kinds()) {
            if (keptOf(store, kind) == null && !kinds.contains(kind)) kinds.add(kind);
        }
        show(host, kinds);
    }

    // Back, Escape and a touch outside leave it up: a dialog that cancels on neither still closes at Escape, whose key
    // it takes here. Don't Allow takes the first focus, which a key's press finds.
    private void show(ExtensionHost host, List<String> kinds) {
        AlertDialog[] shown = new AlertDialog[1];
        DialogInterface.OnClickListener answer = (dialog, button) -> answered(host, shown[0], kinds, button == DialogInterface.BUTTON_POSITIVE);
        shown[0] = new AlertDialog.Builder(host.activity())
                .setTitle(messageOf(project, kinds))
                .setMessage(DETAIL)
                .setNegativeButton("Don't Allow", answer)
                .setPositiveButton("Allow", answer)
                .setCancelable(false)
                .setOnKeyListener((dialog, key, event) -> key == KeyEvent.KEYCODE_ESCAPE || key == KeyEvent.KEYCODE_BACK)
                .create();
        shown[0].setOnShowListener((dialog) -> shown[0].getButton(DialogInterface.BUTTON_NEGATIVE).requestFocus());
        question = shown[0];
        shown[0].show();
    }

    // An answer of a question that went before it, as at the preview's end, keeps nothing.
    private void answered(ExtensionHost host, AlertDialog dialog, List<String> kinds, boolean isAllowed) {
        if (dialog != question || name == null) return;
        question = null;
        keep(host, kinds, isAllowed);
        settle(host);
    }

    // As "Allow “made-up-app” to use the camera and the microphone?".
    private static String messageOf(String project, List<String> kinds) {
        StringBuilder named = new StringBuilder();
        for (int i = 0; i < kinds.size(); i += 1) {
            if (i > 0) named.append(i + 1 == kinds.size() ? " and " : ", ");
            named.append("location".equals(kinds.get(i)) ? "your location" : "the " + kinds.get(i));
        }
        return "Allow “" + project + "” to use " + named + "?";
    }

    // The answer kept of a kind of the preview's origin: one the store could not keep, else the store's own.
    private Boolean keptOf(Object store, String kind) {
        Map<String, Boolean> run = held.get(name);
        if (run != null && run.containsKey(kind)) return run.get(kind);
        if (!(store instanceof Map<?, ?> entries) || !(entries.get(name) instanceof Map<?, ?> kinds)) return null;
        return kinds.get(kind) instanceof Boolean answer ? answer : null;
    }

    // TRUE where each kind is allowed, FALSE where one is denied, null where one is not answered yet.
    private Boolean keptFor(Object store, List<String> kinds) {
        boolean isOpen = false;
        for (String kind : kinds) {
            Boolean answer = keptOf(store, kind);
            if (Boolean.FALSE.equals(answer)) return false;
            if (answer == null) isOpen = true;
        }
        return isOpen ? null : true;
    }

    // Keeps an answer for these kinds of the preview's origin, the store's other entries as they were; one the store
    // cannot take holds for the app's run, and the log says so.
    private void keep(ExtensionHost host, List<String> kinds, boolean isAllowed) {
        File file = storeOf(host);
        Object store = read(file);
        try {
            JSONObject entries = new JSONObject();
            JSONObject entry = new JSONObject();
            if (store instanceof Map<?, ?> was) {
                for (Map.Entry<?, ?> member : was.entrySet()) {
                    if (!name.equals(member.getKey())) entries.put((String) member.getKey(), JSONObject.wrap(member.getValue()));
                }
                if (was.get(name) instanceof Map<?, ?> kept) {
                    for (Map.Entry<?, ?> answer : kept.entrySet()) {
                        if (answer.getValue() instanceof Boolean && !kinds.contains(answer.getKey())) entry.put((String) answer.getKey(), answer.getValue());
                    }
                }
            }
            for (String kind : kinds) entry.put(kind, isAllowed);
            entries.put(name, entry);
            write(file, entries.toString());
        } catch (IOException | JSONException error) {
            Map<String, Boolean> run = held.computeIfAbsent(name, (origin) -> new HashMap<>());
            for (String kind : kinds) run.put(kind, isAllowed);
            Log.w(TAG, "crossbind: preview could not keep an answer in its consents.json, which holds for this run: " + error);
        }
    }

    // In the app's files, as the native code's data folder is.
    private static File storeOf(ExtensionHost host) {
        return new File(new File(host.activity().getFilesDir(), "preview"), "consents.json");
    }

    // The store as JSON's values, read strictly: maps, whose first of a name stands, lists, strings, numbers, booleans
    // and null; null where it cannot be read or is no JSON.
    private static Object read(File file) {
        try (JsonReader reader = new JsonReader(new StringReader(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)))) {
            Object value = valueOf(reader);
            return reader.peek() == JsonToken.END_DOCUMENT ? value : null;
        } catch (IOException | RuntimeException error) {
            return null;
        }
    }

    private static Object valueOf(JsonReader reader) throws IOException {
        switch (reader.peek()) {
            case BEGIN_OBJECT -> {
                Map<String, Object> members = new LinkedHashMap<>();
                reader.beginObject();
                while (reader.hasNext()) {
                    String key = reader.nextName();
                    members.putIfAbsent(key, valueOf(reader));
                }
                reader.endObject();
                return members;
            }
            case BEGIN_ARRAY -> {
                List<Object> items = new ArrayList<>();
                reader.beginArray();
                while (reader.hasNext()) items.add(valueOf(reader));
                reader.endArray();
                return items;
            }
            case BOOLEAN -> {
                return reader.nextBoolean();
            }
            case NUMBER -> {
                return new BigDecimal(reader.nextString());
            }
            case STRING -> {
                return reader.nextString();
            }
            case NULL -> {
                reader.nextNull();
                return JSONObject.NULL;
            }
            default -> throw new IOException("crossbind: the store is no JSON");
        }
    }

    // Written whole, a file the next read sees all of or none of.
    private static void write(File file, String text) throws IOException {
        File folder = file.getParentFile();
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("its folder could not be made");
        File written = new File(file.getPath() + ".new");
        Files.write(written.toPath(), text.getBytes(StandardCharsets.UTF_8));
        if (written.renameTo(file)) return;
        written.delete();
        throw new IOException("the file could not be written");
    }
}
