import { useEffect, useRef, useState } from 'react';
import { UNREACHABLE } from '../../../tooling/learn/src/useRunner.js';
import {
    fetchSession, requestCompile, signOut, turnstileToken,
} from './client.js';

// The playground service's session, which the site's compiles count against, and the site's compile for
// @crossbind/learn's runner: with the visitor's cookie, or with a Turnstile token for a visitor not signed in. A `lazy`
// page asks the server for the session only once it calls `connect`, when its project first needs a compile.
export function useSession({ lazy = false } = {}) {
    const [session, setSession] = useState(null);
    const check = useRef(null);
    const connected = useRef(false);
    const reloadSession = () => fetchSession().then(setSession, () => setSession({ error: UNREACHABLE }));
    const canCompile = Boolean(session) && !session.error && session.enabled;

    function connect() {
        if (connected.current) return;
        connected.current = true;
        reloadSession();
    }

    useEffect(() => {
        if (!lazy) connect();
    }, []);

    async function compile(request) {
        const turnstile = session.user ? undefined : await turnstileToken(check.current, session.turnstileSiteKey);
        const result = await requestCompile(request, turnstile);
        if (typeof result.remaining === 'number') setSession((current) => ({ ...current, remaining: result.remaining }));
        return result;
    }

    async function leave() {
        await signOut().catch(() => undefined);
        reloadSession();
    }

    return {
        session, check, canCompile, connect, compile, leave,
    };
}
