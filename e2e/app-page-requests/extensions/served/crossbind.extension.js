// An origin the app serves, labelled as a project's would be, whose page's dialog the host's own page-dialogs titles with
// the label and closes as the origin ends.
export default function served(options) {
    const native = { sources: ['served.cpp'] };
    return {
        name: 'e2e-served',
        contract: 4,
        root: import.meta.dirname,
        options,
        app: { macos: native, linux: native, windows: native },
    };
}
