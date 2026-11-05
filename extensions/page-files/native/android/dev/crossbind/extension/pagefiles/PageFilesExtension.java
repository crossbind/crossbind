package dev.crossbind.extension.pagefiles;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

// The host's page-files on Android: a file input opens the system's picker for its accept types, with several files
// where the input takes them.
public final class PageFilesExtension implements Extension {
    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        call.reject("crossbind: page-files has no function " + function);
    }

    @Override
    public void onFileInput(ExtensionHost host, FileInput input) {
        Intent intent = input.params().createIntent();
        if (input.allowsMultiple()) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            host.startForResult(intent, (result, data) -> input.pick(picked(result, data)));
        } catch (ActivityNotFoundException none) {
            Log.w("crossbind", "nothing on this device picks a file");
            input.useDefault();
        }
    }

    // What the picker chose, several files as clip data.
    private static Uri[] picked(int result, Intent data) {
        if (result != Activity.RESULT_OK || data == null) return null;
        List<Uri> picked = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip == null) picked.add(data.getData());
        else for (int i = 0; i < clip.getItemCount(); i += 1) picked.add(clip.getItemAt(i).getUri());
        return picked.toArray(new Uri[0]);
    }
}
