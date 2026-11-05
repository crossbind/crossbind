export default function pagePermissions() {
    return {
        name: 'page-permissions',
        contract: 1,
        root: import.meta.dirname,
        reads: ['permissions'],
        app: {
            macos: { sources: ['native/permissions.cpp'] },
            ios: { sources: ['native/permissions.cpp'] },
            linux: { sources: ['native/permissions.cpp'] },
            windows: { sources: ['native/permissions.cpp'] },
            android: { java: 'native/android', class: 'dev.crossbind.extension.pagepermissions.PagePermissionsExtension' },
        },
    };
}
