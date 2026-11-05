/** The text the system clipboard holds, or '' when it holds none. iOS asks its user before an app reads what another app copied. */
export declare function readText(): Promise<string>;

/** Puts text on the system clipboard, in place of what it held. */
export declare function writeText(text: string): Promise<void>;
