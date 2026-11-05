/** A user activity of an iOS or macOS app's, which another of its user's devices continues, as Handoff does: its type, one of app.activityTypes in crossbind.config.js, what the app keeps in its userInfo, JSON values, and the http or https page a device without the app opens instead. */
export interface UserActivity {
    type: string;
    /** An object, always, in the event user-activity. */
    userInfo?: Record<string, unknown>;
    webpageUrl?: string;
}

export declare const app: {
    /** Makes this user activity the app's current one on iOS and macOS, for its user's other devices to continue, as Handoff does; null makes none current. Its type is one of app.activityTypes in crossbind.config.js, and another platform rejects. */
    setUserActivity(activity: UserActivity | null): Promise<void>;
};

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener with each user activity of app.activityTypes the system continues an iOS or macOS app with once the page has called events.held('user-activity'), until the function it returns is called. */
        'user-activity': UserActivity;
    }
    interface HeldEvents {
        /** The user activities of app.activityTypes the system continued the app with that the host held for the page, which came before it asked since it loaded, the launch's own among them. */
        'user-activity': UserActivity;
    }
}
