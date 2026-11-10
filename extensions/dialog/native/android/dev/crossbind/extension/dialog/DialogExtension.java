package dev.crossbind.extension.dialog;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import org.json.JSONArray;
import org.json.JSONObject;

// The dialogs the native code shows in the activity in front: the system's picker, whose files it copies into the app's
// cache, answered with their paths, or null when its user cancelled; and a message dialog, answered with the index of
// the button clicked, or -1 when it went without one.
public final class DialogExtension implements Extension {
    // Whether the process has had COPIES remove the picks of the process before, which no page of this one holds.
    private static final AtomicBoolean ARE_PICKS_CLEARED = new AtomicBoolean();
    private static final ExecutorService COPIES = Executors.newSingleThreadExecutor();
    private static final int MAX_NAME_BYTES = 255;
    private static final int MAX_ENDING = 16;

    private AlertDialog messageDialog;

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        switch (function) {
            case "open" -> open(host, options.optBoolean("multiple"), options.optJSONArray("extensions"), call);
            case "message" -> {
                JSONArray buttons = options.optJSONArray("buttons");
                String[] labels = new String[buttons == null ? 0 : buttons.length()];
                for (int i = 0; i < labels.length; i += 1) labels[i] = buttons.optString(i);
                showMessageDialog(host.activity(), options.optString("message"), options.optString("detail"), labels, call);
            }
            default -> call.reject("crossbind: the dialog extension's Java has no function " + function);
        }
    }

    @Override
    public void onCreate(ExtensionHost host) {
        if (ARE_PICKS_CLEARED.getAndSet(true)) return;
        File picks = picksOf(host.activity());
        COPIES.execute(() -> deleteTree(picks));
    }

    // A message dialog that goes with its activity answers as one closed.
    @Override
    public void onDestroy(ExtensionHost host) {
        if (messageDialog != null) messageDialog.dismiss();
    }

    // The system's picker, for the types of the extensions where Android knows each, else for any file, as it filters
    // by type alone. Its picks are copied into one folder of their own, as a file's sidecars are found beside it.
    private void open(ExtensionHost host, boolean multiple, JSONArray extensions, Call call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        String[] types = typesOf(extensions);
        if (types.length > 0) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        Activity activity = host.activity();
        try {
            host.startForResult(intent, (result, data) -> {
                List<Uri> picked = picked(result, data);
                if (picked.isEmpty()) call.resolve(null);
                else COPIES.execute(() -> copy(activity, picked, call));
            });
        } catch (ActivityNotFoundException none) {
            call.reject("crossbind: nothing on this device picks a file");
        }
    }

    private static String[] typesOf(JSONArray extensions) {
        Set<String> types = new LinkedHashSet<>();
        for (int i = 0; extensions != null && i < extensions.length(); i += 1) {
            String extension = extensions.optString(i);
            String type = extension.equals("*") ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(Locale.ROOT));
            if (type == null) return new String[0];
            types.add(type);
        }
        return types.toArray(new String[0]);
    }

    // What the picker chose, several files as clip data; none when its user cancelled.
    private static List<Uri> picked(int result, Intent data) {
        List<Uri> picked = new ArrayList<>();
        if (result != Activity.RESULT_OK || data == null) return picked;
        ClipData clip = data.getClipData();
        if (clip == null && data.getData() != null) picked.add(data.getData());
        for (int i = 0; clip != null && i < clip.getItemCount(); i += 1) picked.add(clip.getItemAt(i).getUri());
        return picked;
    }

    private static void copy(Activity activity, List<Uri> picked, Call call) {
        File folder = new File(picksOf(activity), Long.toString(System.nanoTime()));
        JSONArray paths = new JSONArray();
        try {
            if (!folder.mkdirs()) throw new IOException("cannot make " + folder);
            for (Uri uri : picked) {
                File copy = freeFile(folder, nameOf(activity, uri));
                try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new IOException("its provider gives no stream");
                    Files.copy(in, copy.toPath());
                }
                paths.put(copy.getPath());
            }
        } catch (IOException | RuntimeException error) {
            // A copy cut short is no file its user picked.
            deleteTree(folder);
            call.reject("crossbind: the app cannot copy a file its user picked: " + error);
            return;
        }
        call.resolve(paths);
    }

    private static File picksOf(Activity activity) {
        return new File(activity.getCacheDir(), "picked");
    }

    // A name the folder has no file of yet, as two picks may share one.
    private static File freeFile(File folder, String name) {
        File file = new File(folder, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String ending = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; file.exists(); i += 1) file = new File(folder, stem + " " + i + ending);
        return file;
    }

    // The name of a file, as its provider shows it, made one a folder takes: without a slash, neither . nor .., and cut
    // to fit before its extension.
    private static String nameOf(Activity activity, Uri uri) {
        String name = null;
        try (Cursor cursor = activity.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        } catch (RuntimeException error) {
            Log.w("crossbind", "crossbind: the provider of " + uri + " gives no name", error);
        }
        if (name == null) name = uri.getLastPathSegment();
        name = name == null ? "" : name.replace('/', '_').replace('\0', '_');
        if (name.isEmpty() || name.equals(".") || name.equals("..")) return "file";
        int dot = name.lastIndexOf('.');
        String ending = dot > 0 && name.length() - dot <= MAX_ENDING ? name.substring(dot) : "";
        String stem = name.substring(0, name.length() - ending.length());
        while (!stem.isEmpty() && (stem + ending).getBytes(StandardCharsets.UTF_8).length > MAX_NAME_BYTES) {
            stem = stem.substring(0, stem.offsetByCodePoints(stem.length(), -1));
        }
        return stem + ending;
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }

    // Android has a positive, a neutral and a negative button: the first label is the positive one, and the last of
    // several the negative, which Android places where its apps put Cancel. Back and a tap outside close the dialog. The
    // message goes in the dialog's text with the detail, as a title stops after two lines.
    private void showMessageDialog(Activity activity, String message, String detail, String[] labels, Call call) {
        if (activity.isFinishing() || activity.isDestroyed()) {
            call.resolve(-1);
            return;
        }
        String[] names = labels.length == 0 ? new String[] {activity.getString(android.R.string.ok)} : labels;
        int[] clicked = {-1};
        AlertDialog.Builder builder = new AlertDialog.Builder(activity).setMessage(detail.isEmpty() ? message : message + "\n\n" + detail)
                .setPositiveButton(names[0], (dialog, which) -> clicked[0] = 0)
                .setOnDismissListener((dialog) -> {
                    messageDialog = null;
                    call.resolve(clicked[0]);
                });
        if (names.length == 3) builder.setNeutralButton(names[1], (dialog, which) -> clicked[0] = 1);
        if (names.length > 1) builder.setNegativeButton(names[names.length - 1], (dialog, which) -> clicked[0] = names.length - 1);
        try {
            messageDialog = builder.show();
        } catch (WindowManager.BadTokenException gone) {
            call.resolve(-1);
        }
    }
}
