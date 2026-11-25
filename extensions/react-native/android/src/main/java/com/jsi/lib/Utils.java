package com.jsi.lib;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.io.FileOutputStream;
import android.content.res.AssetManager;
import com.facebook.react.bridge.ReactApplicationContext;

public class Utils {
    public static boolean copyAssetFolder(ReactApplicationContext context, String srcName, String dstName) {
        try {
            boolean result = true;
            String fileList[] = context.getAssets().list(srcName);
            if (fileList == null) return false;

            if (fileList.length == 0) {
                result = copyAssetFile(context, srcName, dstName);
            } else {
                File file = new File(dstName);
                result = file.mkdirs();
                for (String filename : fileList) {
                    result &= copyAssetFolder(context, srcName + File.separator + filename, dstName + File.separator + filename);
                }
            }
            return result;
        } catch (IOException e) {
            e.printStackTrace();
            return false;
        }
    }

    public static boolean copyAssetFile(ReactApplicationContext context, String srcName, String dstName) {
        try {
            InputStream in = context.getAssets().open(srcName);
            File outFile = new File(dstName);
            OutputStream out = new FileOutputStream(outFile);
            byte[] buffer = new byte[1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            in.close();
            out.close();
            return true;
        } catch (IOException e) {
            e.printStackTrace();
            return false;
        }
    }
}
