// The fixture's hooks, which its page and a previewed project's page call: e2e/run.mjs's next step and the report of
// one, through the run's endpoint on the device's loopback; the preview's end, as the preview's own menu will end it;
// whether an origin is served now; and on iOS a site's link, handed as iOS hands one.
export default function hooks({ endpoint }) {
    return {
        name: 'e2e-hooks',
        contract: 4,
        root: import.meta.dirname,
        options: { endpoint },
        app: { sources: ['hooks.cpp'], ios: { sources: ['ios.mm'] } },
    };
}
