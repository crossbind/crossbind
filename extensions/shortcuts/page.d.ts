/** What the event shortcut-item carries: the type of the quick action of app.shortcutItems its user tapped on an iOS or Android app's icon. */
export interface ShortcutItem {
    type: string;
}

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener with each tap of a quick action of app.shortcutItems on an iOS or Android app's icon once the page has called events.held('shortcut-item'), until the function it returns is called. */
        'shortcut-item': ShortcutItem;
    }
    interface HeldEvents {
        /** The taps of the quick actions of app.shortcutItems that the host held for the page, which came before it asked since it loaded, the launch's own among them. */
        'shortcut-item': ShortcutItem;
    }
}
