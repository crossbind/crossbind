export default function power() {
    return {
        name: 'power',
        contract: 1,
        root: import.meta.dirname,
        app: {
            macos: { sources: ['native/power.cpp', 'native/darwin.mm'] },
            linux: { sources: ['native/power.cpp', 'native/linux.cpp'] },
            windows: { sources: ['native/power.cpp', 'native/windows.cpp'], libraries: ['comctl32'] },
        },
    };
}
