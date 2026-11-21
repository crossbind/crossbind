// crossbind.dev/open/?s=<session>, the address a QR code of a preview names: the page hands the session to the crossbind
// app by its scheme, as crossbind://open?s=<session>, and asks nothing of any server. The app reads the session from its
// own account's list, so the address opens nothing for anyone else.

// A session's id: 16 random bytes in base64url.
export const SESSION = /^[A-Za-z0-9_-]{22}$/;

// The crossbind app's address for the session a page's query names, or null where it names none.
export function appLink(search) {
    const session = new URLSearchParams(search).get('s');
    return session !== null && SESSION.test(session) ? `crossbind://open?s=${session}` : null;
}

if (typeof document !== 'undefined') {
    const link = appLink(window.location.search);
    if (link) document.getElementById('open-app').href = link;
    document.getElementById(link ? 'open-app' : 'open-none').hidden = false;
}
