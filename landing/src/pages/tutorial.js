import {
    CREATE_COMMAND, LIBRARIES_URL, PLAYGROUND_URL, TUTORIAL_URL,
} from '../data.js';
import { guideHref } from '../guide/nav.js';
import { tutorialSections } from '../tutorial/sections.js';

// /tutorial/: crossbind lesson by lesson, one page per playground sample (src/playground/samples), each runnable in
// the page. TutorialPage.jsx is the interactive part; these blocks are what search and llms.txt see. Plain data, so
// Node can import it like every page. A lesson names its part of the tutorial; the lessons of one part sit together
// and make a section of the contents.
//
// A lesson is one idea on one screen: a lede, two short paragraphs and a "Try it" that changes only main.js below its
// imports, so it runs at once from the sample's prebuilt module. Its code awaits every call, `new` and value read from
// native code, as a browser app's default Web Worker needs; on the playground's page thread the awaits change nothing.

const tryIt = (text) => ({ type: 'callout', title: 'Try it', text });
const lesson = (sample) => `${TUTORIAL_URL}${sample}/`;

const STEPS = [
    {
        part: 'Start',
        sample: 'function',
        title: 'A function',
        description: 'Declare a function in a C++ header and call it from JavaScript.',
        lede: 'crossbind reads your C++ header and binds what it declares: no glue code and no binding file.',
        blocks: [
            { type: 'p', text: '`native.h` declares two functions and `native.cpp` defines them. `main.js` imports them from the header like any module, and `await initNative()` loads the native code once.' },
            { type: 'p', text: "Each call has an `await`: a browser app runs the module in a Web Worker by default, where every call returns a promise. On the playground's page thread the `await` changes nothing, so the same code runs in both." },
            tryIt('Greet someone else and add two other numbers. A change below the imports of `main.js` runs at once; a change to the C++ or the imports compiles first.'),
        ],
    },
    {
        part: 'Start',
        sample: 'class',
        title: 'A class',
        description: 'Declare a class in a C++ header and use it as a JavaScript class.',
        lede: 'A C++ class arrives as a JavaScript class: `new` runs its constructor and its public methods are methods.',
        blocks: [
            { type: 'p', text: "`native.h` declares `Counter` under a function like the last lesson's. `await new Counter(41)` runs the C++ constructor; `increment` and `value` are its public methods, and `current`, being private, stays inside C++." },
            { type: 'p', text: `The object lives in C++ and JavaScript holds a handle to it. The garbage collector frees it once the handle is gone; [Object lifetime](${lesson('lifetime')}) shows how to free it sooner.` },
            tryIt('Start a second counter at 100, increment it twice and print both values.'),
        ],
    },
    {
        part: 'Start',
        sample: 'rustfile',
        title: 'A Rust file',
        description: 'Import a Rust file like a header: its functions and structs become functions and classes.',
        lede: 'A Rust file is imported like a header. A `pub fn` is a function, and a `pub struct` with its `impl` is a class.',
        blocks: [
            { type: 'p', text: '`units.rs` is plain Rust, with no attributes and no binding code. `Celsius::new` is the constructor, and names in snake_case arrive in camelCase: `word_count` is `wordCount` and `to_fahrenheit` is `toFahrenheit`.' },
            { type: 'p', text: `C++ and Rust files sit side by side in one project, and one \`initNative()\` starts both. The [Rust lessons](${lesson('collections')}) go on to collections, \`Option\` and \`Result\`.` },
            tryIt('Count the words of another sentence, and convert 37 degrees.'),
        ],
    },
    {
        part: 'Start',
        sample: 'library',
        title: 'A library',
        description: 'Add a ready-made library to a project and call it from JavaScript.',
        lede: 'A ready-made library is a package. The project names it as a dependency and imports its header like one of its own.',
        blocks: [
            { type: 'p', text: "This project has no C++ of its own. `crossbind.config.js` lists SQLite's package, a crossbind port from npm, and `main.js` imports two functions from its header. The library comes prebuilt." },
            { type: 'p', text: `A library's header binds only the functions you import by name, so a large header costs nothing until you use it. [Libraries](${LIBRARIES_URL}) lists the ready-made ones, and the [later lessons](${lesson('zstd')}) use a crate and a Conan package too.` },
            tryIt('Take the semicolon off `sql`, or open a quote and leave it open, and ask again whether the statement is complete.'),
        ],
    },
    {
        part: 'C++',
        sample: 'numbers',
        title: 'Numbers',
        description: 'How C++ numbers, booleans and 64-bit integers cross into JavaScript.',
        lede: '`int`, `double` and `bool` arrive as numbers and booleans. A 64-bit integer arrives as a `BigInt`, so no digit goes missing.',
        blocks: [
            { type: 'p', text: 'A JavaScript `Number` is exact only up to 2^53. `fibonacci(90)` is larger, so its `int64_t` result crosses as a `BigInt`; turning it into a `Number` shows the digits a `double` would lose.' },
            { type: 'p', text: 'A 64-bit parameter takes a `BigInt` or a whole `Number`. An argument of the wrong type, a string for an `int` say, throws a `TypeError` instead of crossing as 0.' },
            tryIt("Print `typeof` each result, then call `isEven('ten')` inside a `try` and print the error."),
        ],
    },
    {
        part: 'C++',
        sample: 'vectors',
        title: 'Vectors and maps',
        description: 'Pass arrays to C++ vectors and read the vectors and maps C++ returns.',
        lede: 'A `std::vector` parameter takes a plain array. A vector or a map that C++ returns arrives as an object with methods of its own.',
        blocks: [
            { type: 'p', text: '`mean` takes a `std::vector<double>` and `main.js` hands it an array. `split` returns a `std::vector<std::string>`, which `m.toArray` turns into an array; `m` is the module `initNative()` resolves to.' },
            { type: 'p', text: '`countWords` returns a `std::map<std::string, int>`, read with `get(key)` and `size()`. In a Web Worker a returned vector is a plain array already; `toArray` takes both, so the same line works there.' },
            tryIt('Split a sentence on its spaces, and look up a word that is not in `counts`.'),
        ],
    },
    {
        part: 'C++',
        sample: 'structs',
        title: 'Structs and enums',
        description: 'Structs with public fields and scoped enums, used from JavaScript.',
        lede: 'The public fields of a struct become properties, and every member of an enum is there by name.',
        blocks: [
            { type: 'p', text: '`await new Point()` makes a `Point` with both fields at zero. A field is a property: `await at.x` reads it and `at.x = 1` writes it. `step` takes the point by value, so C++ works on a copy and returns a new one.' },
            { type: 'p', text: 'The members of `enum class Direction` are `Direction.North`, `Direction.East` and so on, and they pass straight into C++. A field of a number, a `bool` or a `std::string` is a property; one of vector or class type needs accessor methods.' },
            tryIt('Walk the square the other way round. There is no `turnLeft`: call `turnRight` three times.'),
        ],
    },
    {
        part: 'C++',
        sample: 'lifetime',
        title: 'Object lifetime',
        description: 'When a C++ object made from JavaScript is freed, and how to free it at once.',
        lede: 'An object made with `new` lives in C++. The garbage collector frees it once its handle is gone, and `delete()` frees it at once.',
        blocks: [
            { type: 'p', text: '`Block` counts itself: the constructor adds one and the destructor takes one away. After `await first.delete()` the count drops at once, and `first` cannot be used again. `second` goes whenever the collector reclaims it.' },
            { type: 'p', text: 'The collector weighs only the small JavaScript handle, not the memory behind it. Call `delete()` on an object that holds a lot of memory or a resource such as a file, and on objects made in a loop.' },
            tryIt('Make ten blocks in a loop and print the count, then delete each block inside the loop and print it again.'),
        ],
    },
    {
        part: 'C++',
        sample: 'inheritance',
        title: 'Inheritance',
        description: 'C++ class hierarchies and virtual methods, used from JavaScript.',
        lede: 'A class hierarchy keeps its shape in JavaScript: a derived object goes wherever its base class is expected.',
        blocks: [
            { type: 'p', text: "`Circle` and `Square` derive from `Shape`, whose `area` is virtual. `largerArea` takes two `Shape` references; handed a `Circle` and a `Square`, each call to `area()` runs that class's own code, as it would in C++." },
            { type: 'p', text: 'A class binds with one base; a second base class is left out. The hierarchy itself stays in C++: a JavaScript class cannot extend `Shape` to override its methods.' },
            tryIt('Find the radius at which the circle becomes the larger of the two.'),
        ],
    },
    {
        part: 'C++',
        sample: 'callbacks',
        title: 'Callbacks',
        description: 'Pass a JavaScript function to C++ and let C++ call it.',
        lede: 'C++ can call a JavaScript function you pass it: a function pointer parameter takes one.',
        blocks: [
            { type: 'p', text: '`countdown` takes a `Visitor`, a pointer to a function, and calls it once for each number; `applyTwice` uses the value its callback returns. A function passed to C++ holds a slot in the module until `releaseCallback` frees it.' },
            { type: 'p', text: 'A JavaScript function cannot cross into a Web Worker. An app that passes callbacks keeps the module on the page thread, which is what `useWorker: false` asks for; the playground runs there in any case.' },
            tryIt('Pass `applyTwice` a function that squares its value, and count down from 5.'),
        ],
    },
    {
        part: 'C++',
        sample: 'errors',
        title: 'Optional values and exceptions',
        description: 'An empty std::optional and a thrown C++ exception, as JavaScript sees them.',
        lede: 'An empty `std::optional` arrives as no value, and a C++ exception as an `Error`.',
        blocks: [
            { type: 'p', text: '`indexOf` returns a `std::optional<int>`: the index when the letter is there, and no value when the optional is empty, which `??` replaces with a default. Its `char` parameter takes a one-letter string.' },
            { type: 'p', text: "`parsePercent` throws a `std::out_of_range`, and `main.js` catches it as an `Error`. On the web its message is the exception's type followed by its text." },
            tryIt("Add `'abc'` to the list: `std::stoi` throws an exception of its own. Then look for a letter that occurs twice."),
        ],
    },
    {
        part: 'C++',
        sample: 'buffers',
        title: 'Pointers and buffers',
        description: 'Pass raw memory to C++: allocate a buffer, let C++ work on it and read it back.',
        lede: 'A raw pointer crosses as a handle: JavaScript allocates the memory, and C++ reads and writes it in place.',
        blocks: [
            { type: 'p', text: '`allocBuffer(4)` reserves four bytes inside the module and returns a handle to them, and `writeBuffer` copies a `Uint8Array` in. `invert` takes the handle as its `uint8_t *` and changes the bytes where they are; `readBuffer` copies them back out.' },
            { type: 'p', text: "The helpers are imported from the header, beside your own functions. A handle frees its block once the garbage collector reclaims it; memory a library hands out stays the library's to free." },
            tryIt('Invert the block a second time and read it again, then do the same with a block of 8 bytes.'),
        ],
    },
    {
        part: 'C++',
        sample: 'limits',
        title: 'What does not bind',
        description: 'The C++ that crossbind leaves out, such as templates and overloads by type, and how to wrap it.',
        lede: 'crossbind binds a subset of C++. What falls outside is left out without an error, and a small wrapper brings it back.',
        blocks: [
            { type: 'p', text: "A template has no single type, so `larger` does not bind; `largerInt`, a plain function over it, does. Overloads are told apart by their number of arguments: `describe(7, 'km')` works, but the `std::string` one has the same count as the `int` one and cannot be reached." },
            { type: 'p', text: `Also left out: private members, operators, a second base class, and array or struct fields. A function over a type it does not know, such as \`std::pair\`, fails when called. [C++ bindings](${guideHref('bindings')}#rules) has the rules.` },
            tryIt("Call `describe('seven', 'km')` and read the error: which overload answered?"),
        ],
    },
    {
        part: 'Rust',
        sample: 'collections',
        title: 'Collections and bytes',
        description: 'Rust vectors, maps and byte slices as JavaScript arrays, objects and typed arrays.',
        lede: 'Rust collections cross as plain JavaScript values: a `Vec` is an array, a map with string keys is an object, and bytes are a `Uint8Array`.',
        blocks: [
            { type: 'p', text: '`sorted` takes an array and returns one, and `word_lengths` returns a `BTreeMap`, which arrives as an object keyed by its strings. Each is a deep copy: JavaScript and Rust share no collection.' },
            { type: 'p', text: '`invert` reads its `&[u8]` from a `Uint8Array` and returns a `Vec<u8>`, which arrives as a new `Uint8Array`. `&[f64]` and `Vec<f64>` cross the same way, as a `Float64Array`.' },
            tryIt('Sort another list, then invert the inverted bytes to get the first array back.'),
        ],
    },
    {
        part: 'Rust',
        sample: 'results',
        title: 'Option and Result',
        description: "Rust's Option and Result as null and thrown errors in JavaScript.",
        lede: '`None` arrives as `null`, and an `Err` as a thrown `Error`.',
        blocks: [
            { type: 'p', text: '`first_long_word` returns an `Option<String>`: the word, or `null` for `None`. An `Option` parameter works the other way round, taking `null` or `undefined` as `None`.' },
            { type: 'p', text: "`parse_score` returns a `Result`. An `Ok` crosses as its value, and an `Err` is thrown as an `Error` whose message is the error's text. A panic arrives as an `Error` too, but the module is unusable after it: treat one as a crash." },
            tryIt("Ask for a word of at least 2 letters, and add `'100'` and `'-1'` to the list."),
        ],
    },
    {
        part: 'Libraries',
        sample: 'zstd',
        title: 'A library in your C++',
        description: 'Include a ready-made library from your own C++ and expose a function of your own.',
        lede: 'A library is also there for your own C++: include its header and call it.',
        blocks: [
            { type: 'p', text: "`crossbind.config.js` lists zstd's package, a crossbind port, as a dependency. That puts `zstd.h` on the include path and links the library, so `native.h` uses it as any C++ project would." },
            { type: 'p', text: 'JavaScript sees only the two functions the header defines. This is the way in for a library whose API is all templates, and for one you would rather keep behind a few functions of your own.' },
            tryIt('Compress a text that repeats less, the alphabet say, and compare the two sizes.'),
        ],
    },
    {
        part: 'Libraries',
        sample: 'capi',
        title: 'A C API from JavaScript',
        description: "Call a C library's own functions from JavaScript: handles, out-parameters and constants.",
        lede: "A C library's own functions are callable as they are. Its handles, its out-parameters and its constants cross too.",
        blocks: [
            { type: 'p', text: '`sqlite3_open` returns the database through a `sqlite3 **`. `allocPointer(1)` makes room for that pointer and `readPointerAt` reads it back as a handle, which later calls take as their `sqlite3 *`. `SQLITE_OK` is a `#define`, bound because `main.js` imports it.' },
            { type: 'p', text: '`null` stands for a C `NULL`, here for the callback and the two pointers `sqlite3_exec` can do without. Nothing closes the database for you: a C API is tidied up by hand, as `sqlite3_close` does here.' },
            tryIt('Insert three more rows with another `sqlite3_exec` and print `sqlite3_changes` again.'),
        ],
    },
    {
        part: 'Libraries',
        sample: 'wrapper',
        title: 'A class around a C API',
        description: 'Wrap a C API in a small C++ class so JavaScript gets an object instead of pointers.',
        lede: 'A few lines of C++ turn a C API into a class: the constructor opens, the destructor closes, and a status code becomes an exception.',
        blocks: [
            { type: 'p', text: '`database.h` includes `sqlite3.h` and keeps the `sqlite3 *` private, so JavaScript sees no pointer. `await new Database()` opens the database, `run` executes a statement, and `delete()` runs the destructor, which closes it.' },
            { type: 'p', text: `This is the pattern for whatever the generator does not bind as it is, and for an API you want shaped for JavaScript. [Wrapping what does not fit](${guideHref('bindings')}#wrapper) has more of it.` },
            tryIt('Run a statement with a typo in it inside a `try`, and print the error the class throws.'),
        ],
    },
    {
        part: 'Libraries',
        sample: 'crate',
        title: 'A crate',
        description: 'Import a crate from crates.io by name and use its types from JavaScript.',
        lede: 'A crate from crates.io is imported by its name: `cargo:semver` is the `semver` crate.',
        blocks: [
            { type: 'p', text: "`crossbind.config.js` lists the crate with its version, and `main.js` imports the crate's own types. `VersionReq::parse` is `VersionReq.parse`; it returns a `Result`, so a requirement it cannot read throws." },
            { type: 'p', text: `crossbind reads the crate's public API as it reads a Rust file of yours: no wrapper crate and no attributes. Not every crate fits; [crates.io](${guideHref('crates-io')}) says what binds.` },
            tryIt('Change the requirement to `>=1.0, <1.4`. Then give `VersionReq.parse` a text that is no requirement and catch the error.'),
        ],
    },
    {
        part: 'Libraries',
        sample: 'conan',
        title: 'A Conan package',
        description: 'Use a C or C++ library from ConanCenter by naming it in the config.',
        lede: "ConanCenter's C and C++ libraries are a line of config away: `conan:zlib/zlib.h` is zlib's header from its Conan package.",
        blocks: [
            { type: 'p', text: "`crossbind.config.js` names the package and its version, and crossbind has Conan build it for the platform. `main.js` imports from the header with `conan:` before the package's name, and the functions it names are bound." },
            { type: 'p', text: `That suits a package with a C API. A C++ library that is all templates binds nothing by itself: include it from your own C++, as [A library in your C++](${lesson('zstd')}) does. [ConanCenter](${guideHref('conan')}) covers both.` },
            tryIt('Ask `compressBound` about 10 bytes and about a million, and see how little the overhead grows.'),
        ],
    },
    {
        part: 'Runtime',
        sample: 'files',
        title: 'Files',
        description: "Read and write files from C++ and from JavaScript in the module's file system.",
        lede: "C++ reads and writes files with its own library. On the web they live in the module's file system, which JavaScript reaches too.",
        blocks: [
            { type: 'p', text: '`m.FS` is that file system. `main.js` writes a file under `/memfs`, the folder kept in memory, and C++ then opens the same path with `std::ifstream` and `std::ofstream`, as it would on a disk.' },
            { type: 'p', text: `A file under \`/memfs\` lasts as long as the page. A browser app that needs it after a reload writes under \`/opfs\`, which needs the Web Worker. On Node.js the same C++ opens real paths. [Files](${guideHref('filesystem')}) has the details.` },
            tryIt('Append two more lines from JavaScript and count again.'),
        ],
    },
    {
        part: 'Runtime',
        sample: 'worker',
        title: 'Worker and page thread',
        description: 'Where the native module runs in a browser, and what that changes for a call.',
        lede: 'A browser app runs the module in a Web Worker unless it asks otherwise. That decides what a call returns and whether the page waits.',
        blocks: [
            { type: 'p', text: "The playground runs the module on the page's own thread. While `slowSum` runs, nothing else on the page does: the timer in `main.js` never ticks. In a worker the same call returns a promise at once and the page stays free." },
            { type: 'p', text: `That is why every call in this tutorial has an \`await\`. \`initNative({ useWorker: false })\` keeps the module on the page thread, where calls return values and callbacks can be passed; see [Worker mode](${guideHref('runtime-api')}#worker).` },
            tryIt('Take the `await` off `slowSum` and print `sum`. Here it is still a number; in a worker it would be a promise.'),
        ],
    },
    {
        part: 'Runtime',
        sample: 'calls',
        title: 'The cost of a call',
        description: 'What a call into native code costs, measured, and why one call beats many.',
        lede: 'A call into native code costs more than a call inside it. Cross once with the whole job, not once for every item.',
        blocks: [
            { type: 'p', text: 'Both halves of `main.js` add the numbers from 1 to 50,000. The first calls `add` for each number; the second hands the loop to C++ with one call to `sumTo`. The work is the same, and the gap between the two timings is the cost of 50,000 crossings.' },
            { type: 'p', text: 'In a Web Worker each crossing is also a message to another thread, so the gap grows many times over. And native code is not faster by nature: for a small job the crossing can cost more than it saves, so measure, as this sample does.' },
            tryIt('Halve and double `count`, and watch how each timing follows.'),
            { type: 'h2', id: 'next', text: 'Your project' },
            { type: 'p', text: `\`${CREATE_COMMAND}\` starts a project of your own. From there:` },
            {
                type: 'ul',
                items: [
                    `[Quick start](${guideHref('quick-start')}): crossbind in a new or an existing project.`,
                    `[C++ bindings](${guideHref('bindings')}): every type, pointers and buffers, constants and memory.`,
                    `[Rust](${guideHref('rust')}) and [crates.io](${guideHref('crates-io')}): Rust files and crates.`,
                    `[Libraries](${LIBRARIES_URL}): ready-made C and C++ libraries, from SQLite to GDAL.`,
                    `[Apps](${guideHref('apps')}): the same page and native code as a desktop and phone app.`,
                    `[Runtime API](${guideHref('runtime-api')}), [Configuration](${guideHref('configuration')}) and [CLI](${guideHref('cli')}): \`initNative()\`, \`crossbind.config.js\` and the command line.`,
                    `[Playground](${PLAYGROUND_URL}): every sample, free to change, with more packages.`,
                ],
            },
        ],
    },
];

// The first lesson is the tutorial's own address; the others sit under it by sample. A lesson's heading is its topic
// alone, while the browser tab, search and llms.txt also say it is part of the tutorial.
export const TUTORIAL_PAGES = STEPS.map((step, index) => {
    const href = index === 0 ? TUTORIAL_URL : lesson(step.sample);
    return {
        kind: 'tutorial',
        section: 'Tutorial',
        path: href.replace(/\/$/, ''),
        href,
        ...step,
        headTitle: `Tutorial: ${step.title}`,
        description: `${step.description} Lesson ${index + 1} of the crossbind tutorial.`,
    };
});

// The contents: every lesson under its part, numbered (src/tutorial/sections.js).
export const TUTORIAL_SECTIONS = tutorialSections(TUTORIAL_PAGES);
