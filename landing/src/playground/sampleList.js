// The playground's samples in picker order, their files in samples/<id>/. A sample with no native files runs the
// compiler template's, on which the image warms its build. Plain data, so the demo build reads it too.
export const SAMPLE_LIST = Object.freeze([
    { id: 'hello', title: 'Functions and classes', packages: [] },
    { id: 'numbers', title: 'Numbers and BigInt', packages: [] },
    { id: 'strings', title: 'Strings and vectors', packages: [] },
    { id: 'structs', title: 'Structs and enums', packages: [] },
    { id: 'inheritance', title: 'Inheritance', packages: [] },
    { id: 'callbacks', title: 'Callbacks', packages: [] },
    { id: 'errors', title: 'Exceptions', packages: [] },
    { id: 'rust', title: 'Rust', packages: [] },
    { id: 'packages', title: 'Packages', packages: ['port:sqlite3', 'crate:semver', 'conan:nlohmann_json'] },
    { id: 'sqlite', title: 'SQLite', packages: ['port:sqlite3'] },
    { id: 'hero', title: 'C++ and Rust', packages: [] },
].map((sample) => Object.freeze({ ...sample, packages: Object.freeze(sample.packages) })));
