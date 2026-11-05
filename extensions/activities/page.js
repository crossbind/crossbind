import { checkedOptions, invoke } from 'crossbind/app/core';

// A user activity is { type, userInfo, webpageUrl }: NSUserActivity takes an http or https page alone.
const ACTIVITY = { type: 'string', userInfo: { isFitting: (value) => value !== null && typeof value === 'object' && !Array.isArray(value), name: 'object' }, webpageUrl: 'string' };

function checkedActivity(activity) {
    if (activity === null) return {};
    checkedOptions('app.setUserActivity', activity, ACTIVITY);
    if (!activity.type) throw new TypeError('crossbind: app.setUserActivity takes a type, one of app.activityTypes.');
    const page = activity.webpageUrl;
    if (page !== undefined && !(URL.canParse(page) && ['http:', 'https:'].includes(new URL(page).protocol))) {
        throw new TypeError("crossbind: app.setUserActivity's webpageUrl is no http or https address.");
    }
    return activity;
}

const NOT_CURRENT = 'crossbind: an iOS or macOS app alone sets a user activity, of a type app.activityTypes in crossbind.config.js lists';

export const app = {
    // Makes this user activity the app's current one on iOS and macOS, for its user's other devices to continue, as
    // Handoff does: { type, userInfo, webpageUrl }, its type one of app.activityTypes. null makes none current.
    setUserActivity: async (activity) => {
        const checked = checkedActivity(activity);
        try {
            return await invoke('activities.set', checked);
        } catch (error) {
            throw error?.message === 'crossbind: an app has no function activities.set' ? new Error(NOT_CURRENT) : error;
        }
    },
};
