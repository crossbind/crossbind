import fs from 'node:fs';
import path from 'node:path';
import state from '../state/index.js';
import { ANDROID_API_LEVEL } from '../utils/androidToolchain.js';
import { HERMES } from '../utils/hermes.js';
import resolveAppHostRoot from '../utils/resolveAppHost.js';
import { SIGNING } from './androidGradle.js';
import { appLinkParts } from '../utils/appLaunches.js';
import { mergedVerification } from './mavenVerification.js';

// The ABIs an Android app builds for: phones and Apple silicon's emulators, and the emulators of x86_64 machines.
export const ANDROID_ABIS = ['arm64-v8a', 'x86_64'];
// The Android release the app is compiled against and declares it was tested on.
const TARGET_SDK = 36;
export const ANDROIDX_WEBKIT = '1.17.1';

const groovyString = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// The launcher shapes an adaptive icon: the app's icon in the middle of a white square.
const ADAPTIVE_ICON = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/white" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;

const DAY_NIGHT = '@android:style/Theme.DeviceDefault.DayNight';
// The activity's theme shows app.window.backgroundColor until the page paints, and the activity puts it behind the page,
// whose WebView would be white; transparent, which the activity takes for none, without it.
const backgroundValues = (color) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="crossbind_background">${color ?? '#00000000'}</color>
    <style name="CrossbindBackground" parent="${DAY_NIGHT}">
        <item name="android:windowBackground">@color/crossbind_background</item>
    </style>
</resources>
`;

// The Android permissions behind each of app.permissions, after the one every app asks for; the activity asks its user
// for them when the page first uses the device.
const INTERNET = '    <uses-permission android:name="android.permission.INTERNET" />';
const ANDROID_PERMISSIONS = {
    camera: ['CAMERA'],
    microphone: ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS'],
    location: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
};
// The permissions the app asks for beside INTERNET, each once: app.permissions' and its extensions'.
const usesPermissions = (permissions, extensionPermissions) => [...new Set([
    ...permissions.flatMap((name) => ANDROID_PERMISSIONS[name]).map((permission) => `android.permission.${permission}`),
    ...extensionPermissions,
])].filter((permission) => permission !== 'android.permission.INTERNET')
    .map((permission) => `    <uses-permission android:name="${permission}" />`);

// What an extension's own manifest adds to the app's: the elements of its manifest, and those of its application, which
// go inside the app's, whose attributes are the app's alone. The app's manifest declares the android and tools prefixes.
const APPLICATION_END = '    </application>';
const PREFIXES = ['android', 'tools'];

// A manifest's text without its comments, removed until none is left, as removing one may join others into one.
function withoutComments(text) {
    let current = text;
    let previous;
    do {
        previous = current;
        current = current.replace(/<!--[\s\S]*?-->/g, '');
    } while (current !== previous);
    return current;
}

function manifestParts(name, file) {
    const text = withoutComments(fs.readFileSync(file, 'utf8').replace(/<\?xml[\s\S]*?\?>/, ''));
    const root = /^\s*<manifest\b([^>]*)>([\s\S]*)<\/manifest>\s*$/.exec(text);
    if (!root) throw new Error(`crossbind: the extension ${name}'s manifest ${file} is no <manifest> of elements, as an AndroidManifest.xml is.`);
    const other = [...root[1].matchAll(/xmlns:([\w-]+)/g)].map(([, prefix]) => prefix).find((prefix) => !PREFIXES.includes(prefix));
    if (other) throw new Error(`crossbind: the extension ${name}'s manifest ${file} declares the prefix ${other}, which the app's has not: it takes android and tools.`);
    const attribute = [...root[1].matchAll(/([\w:.-]+)\s*=/g)].map(([, key]) => key).find((key) => !key.startsWith('xmlns'));
    if (attribute) throw new Error(`crossbind: the extension ${name}'s manifest ${file} gives its <manifest> ${attribute}, which is the app's own.`);
    // The permissions it asks for are those its permissions list, which the app asks for once each.
    if (/<uses-permission[\s/>]/.test(root[2])) {
        throw new Error(`crossbind: the extension ${name}'s manifest ${file} asks for a permission with <uses-permission>, which its app.android.permissions lists, as the app asks for each once.`);
    }
    const applications = [...root[2].matchAll(/<application\b([^>]*?)(?:\/>|>([\s\S]*?)<\/application>)/g)];
    if (applications.length > 1) throw new Error(`crossbind: the extension ${name}'s manifest ${file} holds ${applications.length} <application> elements, of which it takes one.`);
    const [application] = applications;
    if (application && application[1].trim() !== '') {
        throw new Error(`crossbind: the extension ${name}'s manifest ${file} gives its <application> attributes, which are the app's own: it holds what the extension adds to the app's alone.`);
    }
    return { manifest: application ? root[2].replace(application[0], '') : root[2], application: application?.[2] ?? '' };
}

// An extension's elements, as the app's manifest holds them, at the indentation of their place there.
function indented(text, indent) {
    const lines = text.split('\n').filter((line, index, all) => line.trim() !== '' || (index > all.findIndex((one) => one.trim() !== '')
        && index < all.findLastIndex((one) => one.trim() !== '')));
    const margin = Math.min(...lines.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)[0].length));
    return lines.map((line) => (line.trim() === '' ? '' : `${indent}${line.slice(margin).trimEnd()}`)).join('\n');
}

// What the activity opens, from a browser or a file manager as well, before the end of the activity's element.
const ACTIVITY_END = '        </activity>';
const viewFilter = (data, isVerified = false) => [
    `            <intent-filter${isVerified ? ' android:autoVerify="true"' : ''}>`,
    '                <action android:name="android.intent.action.VIEW" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <category android:name="android.intent.category.BROWSABLE" />',
    ...data.map((attributes) => `                <data ${attributes} />`),
    '            </intent-filter>',
].join('\n');
// The links of the app's schemes.
const urlFilter = (schemes) => viewFilter(schemes.map((scheme) => `android:scheme="${scheme}"`));
// The files of the app's types, which other apps hand it as content: addresses alone, as a file: one would have the app
// read its own: by their MIME types, as Android matches what a content provider gives, else by their names' extensions,
// which a provider's path shows or not; .*\\. takes one dot, and Android's pattern a single match.
const fileFilters = (fileTypes) => fileTypes.map(({ extensions, mimeTypes }) => viewFilter(['android:scheme="content"', ...(mimeTypes.length > 0
    ? mimeTypes.map((mime) => `android:mimeType="${mime}"`)
    : ['android:host="*"', 'android:mimeType="*/*"', ...extensions.flatMap((ending) => [`android:pathPattern=".*\\\\.${ending}"`, `android:pathPattern=".*\\\\..*\\\\.${ending}"`])])]));
// The https links of app.links, which Android verifies against each site's assetlinks.json.
const linkFilters = (links) => links.map((link) => {
    const { host, path: prefix } = appLinkParts(link);
    return viewFilter(['android:scheme="https"', `android:host="${host}"`, ...(prefix ? [`android:pathPrefix="${prefix}"`] : [])], true);
});

// The class of each extension's Java, which the activity calls by the extension's name, in the extensions' order.
const extensionsJava = (java) => `// crossbind writes this file from the app's extensions: the class of each one's Java, under its name.
package dev.crossbind.app;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

final class Extensions {
    // In the order of the app's extensions, in which each hears what the activity does.
    static final Map<String, Extension> ALL;

    static {
        Map<String, Extension> all = new LinkedHashMap<>();${java.map(({ name, className }) => `
        all.put(${JSON.stringify(name)}, new ${className}());`).join('')}
        ALL = Collections.unmodifiableMap(all);
    }

    private Extensions() {}
}
`;

const buildGradle = ({ id, label, version, abis, icon, launchMode, theme, libraries = [] }) => `// crossbind writes this project anew on every build: the module comes prebuilt in src/main/jniLibs/, and the app's
// files are in src/main/assets/app/.
plugins {
    id 'com.android.application'
}

android {
    namespace 'dev.crossbind.app'
    compileSdk ${TARGET_SDK}

    defaultConfig {
        applicationId ${groovyString(id)}
        // The module's libraries are built against this API level.
        minSdk ${ANDROID_API_LEVEL}
        targetSdk ${TARGET_SDK}
        versionCode ${version.code}
        versionName ${groovyString(version.name)}
        manifestPlaceholders = [appName: ${groovyString(label)}, appIcon: ${groovyString(icon)}, launchMode: ${groovyString(launchMode)}, appTheme: ${groovyString(theme)}]
        ndk {
            abiFilters ${abis.map(groovyString).join(', ')}
        }
    }

    // A release is signed with the upload key crossbind's environment names, else with the debug key.
    signingConfigs {
        release {
            def keystore = System.getenv('${SIGNING.keystore}')
            if (keystore) {
                storeFile file(keystore)
                storePassword System.getenv('${SIGNING.password}')
                keyAlias System.getenv('${SIGNING.alias}')
                keyPassword System.getenv('${SIGNING.keyPassword}') ?: System.getenv('${SIGNING.password}')
            }
        }
    }

    buildTypes {
        release {
            signingConfig System.getenv('${SIGNING.keystore}') ? signingConfigs.release : signingConfigs.debug
        }
    }

    // Release builds skip lint's vital checks, whose tools crossbind's android-app image leaves out: the module's code is
    // crossbind's own.
    lint {
        checkReleaseBuilds false
    }

    packaging {
        jniLibs {
            // Hermes brings fbjni, and with it an older libc++_shared.so; the module's is the NDK's it was built with.
            pickFirsts += ['**/libc++_shared.so']
            // The libraries come stripped, and stripping them again would take an NDK of the plugin's own.
            keepDebugSymbols += ['**/*.so']
        }
    }

    // The page keeps all its files, an _app directory or a .well-known one among them, which Android leaves out by default.
    androidResources {
        ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    // Hermes' release build in every variant: it is the one the host links against.
    implementation('com.facebook.hermes:hermes-android:${HERMES.version}') {
        attributes {
            attribute(com.android.build.api.attributes.BuildTypeAttr.ATTRIBUTE, objects.named(com.android.build.api.attributes.BuildTypeAttr, 'release'))
        }
    }
    implementation 'androidx.webkit:webkit:${ANDROIDX_WEBKIT}'
${libraries.map((library) => `    implementation '${library}'\n`).join('')}}
`;

// An Android app as a Gradle project, written anew from the parts its ABI targets built: each brings its libraries,
// the first also the app's files. Gradle adds Hermes, androidx.webkit and its extensions' libraries from Maven, and makes
// the APK or the bundle.
// The icons given are the files of the app's launcher icon under res/; without them it has the system's. Each of java
// is an extension's folder of Java sources, by package, which the app's sources take beside the activity, and the
// class in it the activity calls.
export default function writeGradleProject(to, {
    parts, id, label, version, icons = null, urlSchemes = [], fileTypes = [], links = [], background = null, permissions = [], java = [],
    extensionPermissions = [], manifests = [], resources = [], maven = [],
}) {
    const { name } = state.config.general;
    if (parts.length === 0) throw new Error(`crossbind: no part of the Android app ${name} is built, so there is no Gradle project to write.`);
    // What the extensions add is read before the project goes, which a manifest crossbind refuses then leaves as it was.
    const added = manifests.map(({ name: extension, file }) => manifestParts(extension, file));
    // An app whose extensions ask Maven for libraries checks every file Gradle resolves, which it then resolves online.
    const verification = maven.length > 0 ? mergedVerification(
        fs.readFileSync(path.join(resolveAppHostRoot(), 'android-verification-metadata.xml'), 'utf8'),
        maven.map(({ name: extension, verification: file }) => ({ name: extension, xml: fs.readFileSync(file, 'utf8') })),
    ) : null;
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(path.join(resolveAppHostRoot(), 'android'), to, { recursive: true });
    if (verification) fs.writeFileSync(path.join(to, 'gradle', 'verification-metadata.xml'), verification);
    const main = path.join(to, 'app', 'src', 'main');
    const manifest = path.join(main, 'AndroidManifest.xml');
    const text = fs.readFileSync(manifest, 'utf8');
    if (!text.includes(ACTIVITY_END) || !text.includes(INTERNET) || !text.includes(APPLICATION_END)) {
        throw new Error(`crossbind: ${manifest}, from the app host, has no activity or permissions to give app.urlSchemes and app.permissions: update @crossbind/core-app-host to match crossbind.`);
    }
    const own = (key, indent) => added.map((part) => part[key]).filter((part) => part.trim() !== '').map((part) => indented(part, indent));
    // A replacer, as the extensions' text may hold what a replacement string reads as a pattern, as $&.
    fs.writeFileSync(manifest, text
        .replace(INTERNET, () => [INTERNET, ...usesPermissions(permissions, extensionPermissions), ...own('manifest', '    ')].join('\n'))
        .replace(ACTIVITY_END, () => [...(urlSchemes.length > 0 ? [urlFilter(urlSchemes)] : []), ...fileFilters(fileTypes), ...linkFilters(links), ACTIVITY_END].join('\n'))
        .replace(APPLICATION_END, () => [...own('application', '        '), APPLICATION_END].join('\n')));
    fs.writeFileSync(path.join(main, 'java', 'dev', 'crossbind', 'app', 'Extensions.java'), extensionsJava(java));
    // The Java and Kotlin sources of an extension's folder alone, which may hold its manifest and resources as well: the
    // Android Gradle plugin compiles Kotlin beside the Java.
    java.forEach(({ name: extension, dir }) => {
        const sources = path.join(main, 'java');
        const files = fs.readdirSync(dir, { recursive: true }).filter((file) => /\.(java|kt)$/.test(file) && fs.statSync(path.join(dir, file), { throwIfNoEntry: false })?.isFile());
        files.forEach((file) => {
            if (fs.existsSync(path.join(sources, file))) {
                throw new Error(`crossbind: the extension ${extension} has ${file} in its Java, which the app's Gradle project has already.`);
            }
        });
        files.forEach((file) => {
            fs.mkdirSync(path.dirname(path.join(sources, file)), { recursive: true });
            fs.copyFileSync(path.join(dir, file), path.join(sources, file));
        });
    });
    parts.forEach(({ arch, dir }) => fs.cpSync(path.join(dir, 'lib'), path.join(main, 'jniLibs', arch), { recursive: true }));
    // A release keeps its libraries as linked beside the stripped ones it ships, for Google Play's crash reports.
    parts.filter(({ dir }) => fs.existsSync(path.join(dir, 'symbols')))
        .forEach(({ arch, dir }) => fs.cpSync(path.join(dir, 'symbols'), path.join(to, 'symbols', arch), { recursive: true }));
    fs.cpSync(path.join(parts[0].dir, 'app'), path.join(main, 'assets', 'app'), { recursive: true });
    if (icons) {
        Object.entries({ ...icons, 'mipmap-anydpi/ic_launcher.xml': ADAPTIVE_ICON }).forEach(([file, content]) => {
            fs.mkdirSync(path.dirname(path.join(main, 'res', file)), { recursive: true });
            fs.writeFileSync(path.join(main, 'res', file), content);
        });
    }
    fs.mkdirSync(path.join(main, 'res', 'values'), { recursive: true });
    fs.writeFileSync(path.join(main, 'res', 'values', 'background.xml'), backgroundValues(background));
    // An extension's resources join the app's, of which they replace none.
    resources.forEach(({ name: extension, dir }) => {
        fs.readdirSync(dir, { recursive: true }).forEach((file) => {
            const into = path.join(main, 'res', file);
            if (fs.existsSync(into) && !fs.statSync(into).isDirectory()) {
                throw new Error(`crossbind: the extension ${extension} has ${file} in its resources, which the app's Gradle project has already.`);
            }
        });
        fs.cpSync(dir, path.join(main, 'res'), { recursive: true });
    });
    fs.writeFileSync(path.join(to, 'app', 'build.gradle'), buildGradle({
        id, label, version, abis: parts.map(({ arch }) => arch), icon: icons ? '@mipmap/ic_launcher' : '@android:drawable/sym_def_app_icon',
        launchMode: urlSchemes.length + fileTypes.length + links.length > 0 ? 'singleTask' : 'standard', theme: background ? '@style/CrossbindBackground' : DAY_NIGHT,
        libraries: [...new Set(maven.flatMap(({ coordinates }) => coordinates))],
    }));
    return to;
}
