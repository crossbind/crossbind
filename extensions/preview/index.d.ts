export interface Account {
    id: string;
    name: string;
}

/** A preview of the account's list: a dev server's, on its address, or a snapshot's, at its version. */
export interface ListedSession {
    id: string;
    source: 'dev' | 'snapshot';
    project: { name: string };
    createdAt: string;
    /** A dev server's address, as "192.168.1.6:5173". */
    on?: string;
    /** A snapshot's version, and the one this device opened last, or null. */
    version?: number;
    opened?: number | null;
}

/** The Open sheet's lines of a session whose source proved it is that session. */
export interface CheckedSession {
    session: string;
    source: 'dev' | 'snapshot';
    project: { name: string };
    account: { name: string };
    on?: string;
    version?: number;
    opened?: number | null;
}

export type SignInMessage = { code: string; page: string; expiresIn: number } | { number: true };

export type ConsentKind = 'camera' | 'microphone' | 'location';

/** A project this device opened, as the note of the projects opened keeps it, with the kinds its user answered. */
export interface NotedProject {
    /** The name of the project's origin. */
    id: string;
    name: string;
    account: string;
    consents: Partial<Record<ConsentKind, boolean>>;
}

/** A clearing that ended, with what stays where something does. */
export interface ClearedProject {
    id: string;
    name: string;
    account: string;
    message?: string;
}

export declare const preview: {
    account(): Promise<{ account: Account | null; cloud: string; keyring: boolean }>;
    signIn(options?: { onMessage?: (message: SignInMessage) => void; signal?: AbortSignal }): Promise<{ account: Account; keyring: boolean }>;
    signInNumber(number: number): Promise<void>;
    openSignInPage(): Promise<void>;
    signOut(): Promise<{ revoked: boolean; message?: string }>;
    deleteAccount(): Promise<{ message: string }>;
    sessions(): Promise<{ account: Account | null; sessions: ListedSession[]; message: string | null }>;
    check(session: string, options?: { onMessage?: (message: { waiting: string; reason: string }) => void; signal?: AbortSignal }): Promise<CheckedSession>;
    open(session: string): Promise<{ url: string }>;
    close(): Promise<void>;
    compile(project: { files: Record<string, string>; packages: string[] }): Promise<{ status: number; [member: string]: unknown }>;
    removeSnapshot(session: string): Promise<void>;
    projects(): Promise<{ projects: NotedProject[] }>;
    takeBack(id: string, kind: ConsentKind): Promise<void>;
    clearData(id: string): Promise<void>;
    links(): Promise<Array<{ session: string } | { message: string }>>;
    ended(): Promise<Array<{ message?: string }>>;
    cleared(): Promise<ClearedProject[]>;
};
