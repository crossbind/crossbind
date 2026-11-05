package dev.crossbind.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import java.util.UUID;

// A tap of a quick action of app.shortcutItems, which Android starts in a task of its own that it empties first, as it
// does each static shortcut's: the activity hands the tap to the app's, which keeps its page, and goes.
public final class CrossbindShortcutActivity extends Activity {
    private static final String TYPE = "dev.crossbind.app.shortcut";
    // What each type of the app's shortcuts.xml comes after, as Android reads an extra of digits, true or false as a number
    // or a boolean.
    private static final String TYPE_PREFIX = "type:";
    private static final String KEY = "dev.crossbind.app.shortcutKey";
    // What the app's activity knows a tap this activity handed over by, which no other app can give it.
    private static final String SECRET = UUID.randomUUID().toString();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String value = getIntent().getStringExtra(TYPE);
        if (value != null && value.startsWith(TYPE_PREFIX)) {
            String type = value.substring(TYPE_PREFIX.length());
            startActivity(new Intent(this, CrossbindActivity.class).putExtra(TYPE, type).putExtra(KEY, SECRET).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        finish();
    }

    // The type of the tap this activity handed over in this intent, or null for none.
    static String tapOf(Intent intent) {
        return SECRET.equals(intent.getStringExtra(KEY)) ? intent.getStringExtra(TYPE) : null;
    }
}
