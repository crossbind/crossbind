// The kit's Rust crate is a cargo package like core/embind-rust/demo: crossbind builds it per
// platform and stages the archive as a prebuilt, so every leg links it the same way.
export default {
    general: {
        name: 'confrust',
    },
    export: {
        type: 'cargo',
        libName: ['confrust'],
        crate: '.',
        bindings: {
            vectors: [
                { of: 'i32', name: 'ConfRsIntVector' },
                { of: 'f64', name: 'ConfRsF64Vector' },
                { of: 'bool', name: 'ConfRsBoolVector' },
            ],
        },
    },
    paths: {
        config: import.meta.url,
        base: '../..',
        output: 'dist',
    },
};
