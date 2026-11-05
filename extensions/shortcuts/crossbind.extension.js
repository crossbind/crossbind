export default function shortcuts() {
    return {
        name: 'shortcuts',
        contract: 1,
        root: import.meta.dirname,
        reads: ['shortcutItems'],
        // A phone with quick actions of its own.
        fromApp(api) {
            return ['ios', 'android'].includes(api.platform) && api.config.app.shortcutItems?.length > 0 ? {} : null;
        },
        app: {
            ios: { sources: ['native/shortcuts.cpp'] },
            android: { sources: ['native/shortcuts.cpp'] },
        },
    };
}
