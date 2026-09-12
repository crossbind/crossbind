// Fixed locale and zone: these render during prerender in Node and again on hydration in the
// browser, and the two must agree byte for byte.
const LONG = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const formatPublishedAt = (iso) => LONG.format(new Date(iso));
export const formatPublishedAtShort = (iso) => SHORT.format(new Date(iso));

export const CHANNEL_LABEL = { beta: 'Beta', rc: 'Release candidate', stable: 'Stable' };
