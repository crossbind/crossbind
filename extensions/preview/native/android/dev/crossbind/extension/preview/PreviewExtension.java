package dev.crossbind.extension.preview;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.json.JSONObject;

// The preview extension's Java: the app's token sealed with a key of the Android Keystore, which never leaves it, in a
// file of the app's own that no backup takes; HMAC-SHA256 and SHA-256; the page that approves a sign-in in a Custom
// Tab of the system's browser; and what a page asks to use, as the holder of page-permissions, by the page's role, a
// project's at the app's own question (Consents.java).
public final class PreviewExtension implements Extension {
    private static final String KEY_ALIAS = "crossbind-preview-token";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;
    // The extra by which the system's browser opens a link as a Custom Tab, with no library in the app.
    private static final String CUSTOM_TAB = "android.support.customtabs.extra.SESSION";
    private static final String COARSE = Manifest.permission.ACCESS_COARSE_LOCATION;
    private static final Map<String, String> DEVICES = Map.of(
            "camera", Manifest.permission.CAMERA,
            "microphone", Manifest.permission.RECORD_AUDIO);

    private final Consents consents = new Consents(PreviewExtension::grant);

    // The app's own page gets the devices the manifest asks for, as the host's page-permissions does; a project's page
    // those its user allows at the app's own question, then as the app's own; a page of no role nothing.
    @Override
    public void onPagePermission(ExtensionHost host, PagePermission request) {
        if ("app".equals(request.role())) {
            if (request.isListed()) grant(host, request);
            else request.deny();
        } else if (!request.role().isEmpty()) {
            consents.ask(host, request);
        } else {
            request.deny();
        }
    }

    // Once the app's user gives them, at the system's own question for the app: the location the approximate one at
    // least.
    private static void grant(ExtensionHost host, PagePermission request) {
        Activity activity = host.activity();
        if (request.kinds().equals(List.of("location"))) {
            if (isGranted(activity, COARSE)) request.allow();
            else host.afterAsking(new String[] {COARSE, Manifest.permission.ACCESS_FINE_LOCATION}, () -> answer(activity, request, COARSE));
        } else {
            String[] permissions = request.kinds().stream().map(DEVICES::get).toArray(String[]::new);
            host.afterAsking(permissions, () -> answer(activity, request, permissions));
        }
    }

    private static void answer(Activity activity, PagePermission request, String... permissions) {
        if (Arrays.stream(permissions).allMatch((permission) -> isGranted(activity, permission))) request.allow();
        else request.deny();
    }

    private static boolean isGranted(Activity activity, String permission) {
        return activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        try {
            switch (function) {
                case "hmac" -> {
                    Mac mac = Mac.getInstance("HmacSHA256");
                    mac.init(new SecretKeySpec((byte[]) options.get("key"), "HmacSHA256"));
                    call.resolve(mac.doFinal((byte[]) options.get("text")));
                }
                case "sha256" -> call.resolve(MessageDigest.getInstance("SHA-256").digest((byte[]) options.get("text")));
                case "readSecret" -> call.resolve(read(fileOf(host, options.getString("cloud"))));
                case "writeSecret" -> {
                    write(fileOf(host, options.getString("cloud")), options.getString("secret"));
                    call.resolve(null);
                }
                case "deleteSecret" -> {
                    File file = fileOf(host, options.getString("cloud"));
                    if (file.exists() && !file.delete()) throw new IOException("the token's file stays");
                    call.resolve(null);
                }
                case "openSignInPage" -> {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(options.getString("url")));
                    Bundle extras = new Bundle();
                    extras.putBinder(CUSTOM_TAB, null);
                    intent.putExtras(extras);
                    host.activity().startActivity(intent);
                    call.resolve(null);
                }
                // The preview the native code serves from here on, and its end.
                case "serving" -> {
                    consents.serve(options.getString("url"), options.getString("name"), options.getString("project"));
                    call.resolve(null);
                }
                case "ended" -> {
                    consents.end();
                    call.resolve(null);
                }
                default -> call.reject("crossbind: preview's Java has no function " + function);
            }
        } catch (Exception error) {
            call.reject("crossbind: " + error);
        }
    }

    // The cloud's token in the app's own folder that Android's backups leave out.
    private static File fileOf(ExtensionHost host, String cloud) {
        return new File(host.activity().getNoBackupFilesDir(), "crossbind-preview-" + cloud.replaceAll("[^A-Za-z0-9]", "_"));
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.getKey(KEY_ALIAS, null) instanceof SecretKey kept) return kept;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    // The file holds the length of its initialization vector, the vector, then the sealed token.
    private static String read(File file) throws Exception {
        if (!file.exists()) return null;
        byte[] sealed = Files.readAllBytes(file.toPath());
        int vector = sealed[0];
        Cipher cipher = Cipher.getInstance(CIPHER);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, sealed, 1, vector));
        return new String(cipher.doFinal(sealed, 1 + vector, sealed.length - 1 - vector), StandardCharsets.UTF_8);
    }

    private static void write(File file, String secret) throws Exception {
        Cipher cipher = Cipher.getInstance(CIPHER);
        try {
            cipher.init(Cipher.ENCRYPT_MODE, key());
        } catch (GeneralSecurityException error) {
            // A key that no longer seals is made anew, or the device would keep no token again.
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            store.deleteEntry(KEY_ALIAS);
            cipher.init(Cipher.ENCRYPT_MODE, key());
        }
        byte[] vector = cipher.getIV();
        byte[] sealed = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[1 + vector.length + sealed.length];
        out[0] = (byte) vector.length;
        System.arraycopy(vector, 0, out, 1, vector.length);
        System.arraycopy(sealed, 0, out, 1 + vector.length, sealed.length);
        File written = new File(file.getPath() + ".new");
        Files.write(written.toPath(), out);
        if (!written.renameTo(file)) throw new IOException("the token's file could not be written");
    }
}
