export default function activities() {
    return {
        name: 'activities',
        contract: 1,
        root: import.meta.dirname,
        reads: ['activityTypes'],
        // The app's own types, whose activities it hands the page, on the systems that continue them.
        fromApp(api) {
            const types = api.config.app.activityTypes;
            return ['macos', 'ios'].includes(api.platform) && types?.length > 0 ? { types: [...types] } : null;
        },
        app: {
            macos: { sources: ['native/apple.mm'] },
            ios: { sources: ['native/apple.mm'] },
        },
    };
}
