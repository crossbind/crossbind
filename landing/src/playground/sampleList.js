// The playground's samples in picker order, their files in samples/<id>/: the tutorial's, in its order, then the
// ones other pages open. A sample with no native file and no package runs the compiler template's C++, on which the
// image warms its build. A title is 21 characters at most: the Samples menu opens leftwards from its button and a
// longer one would run off the screen. Plain data, so the demo build reads it too.
export const SAMPLE_LIST = Object.freeze([
    { id: 'function', title: 'A function', packages: [] },
    { id: 'class', title: 'A class', packages: [] },
    { id: 'rustfile', title: 'A Rust file', packages: [] },
    { id: 'library', title: 'A library', packages: ['port:sqlite3'] },
    { id: 'numbers', title: 'Numbers', packages: [] },
    { id: 'vectors', title: 'Vectors and maps', packages: [] },
    { id: 'structs', title: 'Structs and enums', packages: [] },
    { id: 'lifetime', title: 'Lifetime', packages: [] },
    { id: 'inheritance', title: 'Inheritance', packages: [] },
    { id: 'callbacks', title: 'Callbacks', packages: [] },
    { id: 'errors', title: 'Errors and optionals', packages: [] },
    { id: 'buffers', title: 'Pointers and buffers', packages: [] },
    { id: 'limits', title: 'What does not bind', packages: [] },
    { id: 'collections', title: 'Collections and bytes', packages: [] },
    { id: 'results', title: 'Option and Result', packages: [] },
    { id: 'zstd', title: 'A library in your C++', packages: ['port:zstd'] },
    { id: 'capi', title: 'A C API from JS', packages: ['port:sqlite3'] },
    { id: 'wrapper', title: 'A C API in a class', packages: ['port:sqlite3'] },
    { id: 'crate', title: 'A crate', packages: ['crate:semver'] },
    { id: 'conan', title: 'A Conan package', packages: ['conan:zlib'] },
    { id: 'files', title: 'Files', packages: [] },
    { id: 'worker', title: 'Worker or page thread', packages: [] },
    { id: 'calls', title: 'The cost of a call', packages: [] },
    { id: 'sqlite', title: 'SQLite', packages: ['port:sqlite3'] },
    { id: 'hero', title: 'C++ and Rust', packages: [] },
].map((sample) => Object.freeze({ ...sample, packages: Object.freeze(sample.packages) })));
