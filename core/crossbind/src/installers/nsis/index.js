import fs from 'node:fs';
import path from 'node:path';

// The script NSIS builds a setup program from, which a Windows app's updater runs with /S /UPDATE /D=<its folder>.
const SCRIPT = path.join(import.meta.dirname, 'installer.nsi');

// The name a Windows app's setup program gives its Start menu shortcut and folder, which Windows takes as a file name.
export function windowsName(label) {
    if (/[<>:/|?*]|[ .]$/.test(label)) {
        throw new Error(`crossbind: ${JSON.stringify(label)}, the name of a Windows app's Start menu shortcut and folder, is no file name Windows takes, which holds none of < > : / | ? * and ends in neither a space nor a dot. Change app.name in crossbind.config.js.`);
    }
    return label;
}

// A Windows setup program reads a dollar sign in its text as the start of a variable.
const nsisText = (text) => text.replaceAll('$', () => '$$');

// The schemes a Windows app's setup program registers, as a macro that calls the one it is given on each.
const schemesMacro = (schemes) => ['!macro CROSSBIND_URL_SCHEMES DO', ...schemes.map((scheme) => `  !insertmacro \${DO} "${scheme}"`), '!macroend', ''].join('\n');
// The extensions of the files it opens, each with its type's name, in a string of the script's, which takes a quote as
// $\", as a macro that calls the one it is given on each.
export const fileTypesMacro = (fileTypes) => ['!macro CROSSBIND_FILE_TYPES DO', ...fileTypes.flatMap(({ name, extensions }) => extensions
    .map((ending) => `  !insertmacro \${DO} "${ending}" "${nsisText(name).replaceAll('"', '$\\"')}"`)), '!macroend', ''].join('\n');

// crossbind's installer of a Windows app: its setup program, which NSIS builds in the windows image; with a key in the
// environment, the script that signs the app signs it and its uninstaller as NSIS writes them. The name of its shortcut
// and folder stops a build that could not make it before anything compiles.
export default function nsis() {
    return {
        name: 'nsis',
        root: import.meta.dirname,
        installer: {
            platform: 'windows',
            check(api) {
                windowsName(api.app.name);
            },
            make(api, { app }) {
                fs.mkdirSync(api.workDir, { recursive: true });
                const icon = api.windows.icon();
                const iconFile = path.join(api.workDir, `${path.basename(app)}.ico`);
                if (icon) fs.writeFileSync(iconFile, icon);
                const schemes = api.app.urlSchemes;
                const schemesFile = path.join(api.workDir, `${path.basename(app)}.schemes.nsh`);
                if (schemes.length > 0) fs.writeFileSync(schemesFile, schemesMacro(schemes));
                const { fileTypes } = api.app;
                const fileTypesFile = path.join(api.workDir, `${path.basename(app)}.filetypes.nsh`);
                if (fileTypes.length > 0) fs.writeFileSync(fileTypesFile, fileTypesMacro(fileTypes));
                const { signer } = api.windows;
                api.run([
                    'makensis', '-V2', '-INPUTCHARSET', 'UTF8',
                    `-DNAME=${nsisText(windowsName(api.app.name))}`,
                    `-DEXE=${nsisText(`${api.project.name}.exe`)}`,
                    `-DID=${api.app.id}`,
                    `-DVERSION=${nsisText(api.app.version)}`,
                    `-DAPP=${app}`,
                    `-DOUTFILE=${app}-setup.exe`,
                    ...(icon ? [`-DICON=${iconFile}`] : []),
                    ...(schemes.length > 0 ? [`-DSCHEMES=${schemesFile}`] : []),
                    ...(fileTypes.length > 0 ? [`-DFILETYPES=${fileTypesFile}`] : []),
                    ...(signer ? [`-DSIGNER=${signer}`] : []),
                    SCRIPT,
                ], { cwd: path.dirname(app), isSigning: true });
                return [`${app}-setup.exe`];
            },
        },
    };
}
