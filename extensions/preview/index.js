import { events, invoke } from 'crossbind/app/core';

// The crossbind app's previews of the account it is signed in to, for the app's own page: a page of a project reaches
// none of these. The token stays in the extension, which makes every call that carries it.
export const preview = {
    // The account signed in, or null; the cloud it signs in to; and whether the system's keyring keeps its token, which
    // without one is kept for the run alone.
    account: async () => invoke('preview.account'),
    // The device sign-in: onMessage gets { code, page, expiresIn } first, the code its user enters on that page, then
    // { number: true } once the page has approved it, for the two digits the page shows, which signInNumber sends once.
    // It answers { account, keyring }, or rejects with what to tell its user; signal ends it.
    signIn: async ({ onMessage, signal } = {}) => invoke('preview.signIn', {}, { onMessage, signal }),
    signInNumber: async (number) => invoke('preview.signInNumber', { number }),
    // The page of the sign-in under way, in the system's sign-in sheet on iOS and macOS, a Custom Tab on Android and the
    // default browser on Windows and Linux.
    openSignInPage: async () => invoke('preview.openSignInPage'),
    // { revoked }, with what to tell its user where the token could not be revoked: the device signs out all the same.
    signOut: async () => invoke('preview.signOut'),
    // { message } once crossbind cloud deleted the account, with its tokens, sessions and snapshots.
    deleteAccount: async () => invoke('preview.deleteAccount'),
    // { account, sessions, message }: the account's previews, newest first, and the words for a signed-out app or an
    // empty list.
    sessions: async () => invoke('preview.sessions'),
    // The Open sheet's lines of a session, once its source proved it is that session; onMessage gets { waiting, reason }
    // while iOS or macOS has yet to let the app on the local network. It rejects with what to tell its user.
    check: async (session, { onMessage, signal } = {}) => invoke('preview.check', { session }, { onMessage, signal }),
    // Serves the session check() answered last and gives { url }, which the page goes to.
    open: async (session) => invoke('preview.open', { session }),
    close: async () => invoke('preview.close'),
    // The playground's compile, signed in: { status, ...what crossbind cloud answered }.
    compile: async ({ files, packages }) => invoke('preview.compile', { files, packages }),
    removeSnapshot: async (session) => invoke('preview.removeSnapshot', { session }),
    // The projects opened on this device, signed in or not, in the order of their names: { projects: [{ id, name, account,
    // consents }] }, its id the name of its origin, and its consents the kinds its user answered, as { camera: true }.
    projects: async () => invoke('preview.projects'),
    // An Allow of a project of projects() made Don't Allow, as the preview's menu turns one off; it gives nothing.
    takeBack: async (id, kind) => invoke('preview.takeBack', { id, kind }),
    // What a project of projects() keeps on this device removed, in the window of the page that asks, which shows the
    // app's first page again as it ends; it answers as the clearing begins.
    clearData: async (id) => invoke('preview.clearData', { id }),
    // The links that opened the app since its page loaded, each { session } or { message } for one that names none; the
    // previews that ended but by preview.close, each { message } for one the extension ended itself and {} for one its
    // user closed from the preview's menu or with Back; and the clearings that ended, each { id, name, account }, with
    // { message } where something stays. Later ones come as the events preview.link, preview.ended and preview.cleared.
    // Listening first, then asking, misses none.
    links: async () => events.held('preview.link'),
    ended: async () => events.held('preview.ended'),
    cleared: async () => events.held('preview.cleared'),
};
