export default function pageDrops() {
    return {
        name: 'page-drops',
        contract: 1,
        root: import.meta.dirname,
        app: {
            macos: { sources: ['native/drops.cpp'] },
            linux: { sources: ['native/drops.cpp'] },
            windows: { sources: ['native/drops.cpp'] },
        },
    };
}
