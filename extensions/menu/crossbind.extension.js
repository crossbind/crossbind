export default function menu() {
    return {
        name: 'menu',
        contract: 1,
        root: import.meta.dirname,
        holds: ['menu', 'notification', 'tray'],
        // A Linux tray names itself by the app's id on the session bus.
        fromApp: (api) => (api.platform === 'linux' ? { id: api.app.id } : {}),
        app: {
            sources: ['native/menu.cpp'],
            macos: { sources: ['native/darwin.mm'], frameworks: ['UserNotifications'] },
            ios: { sources: ['native/ios.cpp'] },
            linux: { sources: ['native/linux.cpp', 'native/linux-tray.cpp', 'native/linux-notifications.cpp'] },
            windows: { sources: ['native/windows.cpp'], libraries: ['comctl32', 'shell32'] },
            android: { sources: ['native/android.cpp'] },
        },
    };
}
