package dev.crossbind.e2e.probe;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

// The files e2e/run.mjs opens the app on, as a file manager's provider would hand them over: content://<authority>/<name>,
// each of the MIME type of its name's extension and holding TEXT, which e2e/launch.mjs's PHONE_FILE_TEXT is as well. Any
// app may read them, as the app takes no file of a provider of its own that other apps cannot read.
public class ProbeFiles extends ContentProvider {
    private static final String TEXT = "crossbind e2e";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        String name = String.valueOf(uri.getLastPathSegment());
        if (name.endsWith(".cbe2e")) return "application/x-crossbind-e2e";
        if (name.endsWith(".cbprobe")) return "application/x-crossbind-probe";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        cursor.addRow(new Object[] {uri.getLastPathSegment(), TEXT.length()});
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = new File(getContext().getCacheDir(), "probe-file");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(TEXT.getBytes(StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new FileNotFoundException("crossbind: the probe cannot write " + file + ": " + error.getMessage());
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
