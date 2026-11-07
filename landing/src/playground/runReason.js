// Why Run is off, for its tooltip: a project the sample's prebuilt module serves runs without a compile, so an off Run
// is a project that needs one while the playground service cannot compile it.

export const PAUSED = 'The playground is paused for now.';

export function runOffReason({ prebuilt, session, canReset = false }) {
    if (prebuilt) return null;
    const service = session ? session.error ?? (session.enabled ? null : PAUSED) : 'The playground service has not answered yet.';
    if (!service) return null;
    return ['This project needs a compile.', service, canReset && 'Reset your changes to run it without one.'].filter(Boolean).join(' ');
}
