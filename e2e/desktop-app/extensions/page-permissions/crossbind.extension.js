// The e2e app's page-permissions, in place of the host's, which answers what the page asks to use at once and keeps what
// each request asked for, for src/main.js to check.
export default function pagePermissions() {
    return {
        name: 'page-permissions',
        contract: 1,
        root: import.meta.dirname,
        app: {
            sources: ['permissions.cpp'],
            android: { java: 'android', class: 'dev.crossbind.e2e.pagepermissions.PagePermissionsExtension' },
        },
    };
}
