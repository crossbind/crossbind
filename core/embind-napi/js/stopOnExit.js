// Every package bundles a loader of its own, and Node warns at an eleventh 'exit' listener, so the addons share one,
// found by a registered symbol. Each boot moves it to the end of the list: the stops then run after every handler
// registered so far, as a listener added at that boot would, since a call into an addon after its stop crashes.
const ADDON_STOPS = Symbol.for('crossbind.addonStops.v1');

export default function stopOnExit(stop, proc = process) {
    if (!proc[ADDON_STOPS]) {
        const stops = [];
        proc[ADDON_STOPS] = { stops, onExit: () => stops.forEach((stopAddon) => stopAddon()) };
    }
    const { stops, onExit } = proc[ADDON_STOPS];
    stops.push(stop);
    proc.removeListener('exit', onExit);
    proc.on('exit', onExit);
}
