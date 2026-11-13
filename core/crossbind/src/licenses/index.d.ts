/** A component a page or the app it runs in carries: a library the native module links, a part of an app's host or crossbind's runtime, or an npm package in the page's bundle. */
export interface License {
    /** The name its project gives it. */
    name: string;
    /** The version of the code the page or app carries. */
    version: string | null;
    /** An SPDX expression. */
    license: string | null;
    /** Where its code is. */
    source: string | null;
    /** Its license texts as it carries them, each under its file's name. */
    text: string | null;
}

/** The components the page and its app carry, by name, from the crossbind-licenses.json a build with crossbind's Vite or Rollup plugin writes beside the page. Rejects on a dev server, which has none. */
export function licenses(): Promise<License[]>;
