// The extension as an app's crossbind.config.js lists it: extensions: [starter()].
export default function starter() {
    return {
        name: 'starter',
        contract: 1,
        root: import.meta.dirname,
        app: {
            sources: ['native/starter.cpp'],
        },
    };
}
