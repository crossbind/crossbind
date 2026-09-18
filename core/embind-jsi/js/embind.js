function warnOnce(msg) {
  console.warn(msg);
}

function callRuntimeCallbacks() { }

// include: shell.js
/**
 * @license
 * Copyright 2010 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
globalThis.Module = typeof globalThis.Module != 'undefined' ? globalThis.Module : {};

// See https://caniuse.com/mdn-javascript_builtins_bigint64array
// include: polyfill/bigint64array.js

if (typeof globalThis.BigInt64Array === "undefined") {
  // BigInt64Array polyfill for Safari versions between v14.0 and v15.0.
  // All browsers other than Safari added BigInt and BigInt64Array at the same
  // time, but Safari introduced BigInt in v14.0 and introduced BigInt64Array in
  // v15.0

  function partsToBigIntSigned(lower, upper) {
    return BigInt(lower) | (BigInt(upper + 2 * (upper & 0x80000000)) << 32n);
  }

  function partsToBigIntUnsigned(lower, upper) {
    return BigInt(lower) | (BigInt(upper) << 32n);
  }

  function bigIntToParts(value) {
    var lower = Number(BigInt(value) & BigInt(0xffffffff)) | 0;
    var upper = Number(BigInt(value) >> 32n) | 0;
    return [lower, upper];
  }

  function createBigIntArrayShim(partsToBigInt) {
    function createBigInt64Array(array) {
      if (typeof array === "number") {
        array = new Uint32Array(2 * array);
      }
      var orig_array;
      if (!ArrayBuffer.isView(array)) {
        if (array.constructor && array.constructor.name === "ArrayBuffer") {
          array = new Uint32Array(array);
        } else {
          orig_array = array;
          array = new Uint32Array(array.length * 2);
        }
      }
      var proxy = new Proxy(
        {
          slice: function (min, max) {
            if (max === undefined) {
              max = array.length;
            }
            var new_buf = array.slice(min * 2, max * 2);
            return createBigInt64Array(new_buf);
          },
          subarray: function (min, max) {
            var new_buf = array.subarray(min * 2, max * 2);
            return createBigInt64Array(new_buf);
          },
          [Symbol.iterator]: function* () {
            for (var i = 0; i < array.length / 2; i++) {
              yield partsToBigInt(array[2 * i], array[2 * i + 1]);
            }
          },
          BYTES_PER_ELEMENT: 2 * array.BYTES_PER_ELEMENT,
          buffer: array.buffer,
          byteLength: array.byteLength,
          byteOffset: array.byteOffset,
          length: array.length / 2,
          copyWithin: function (target, start, end) {
            array.copyWithin(target * 2, start * 2, end * 2);
            return proxy;
          },
          set: function (source, targetOffset) {
            if (targetOffset === undefined) {
              targetOffset = 0;
            }
            if (2 * (source.length + targetOffset) > array.length) {
              // This is the Chrome error message
              // Firefox: "invalid or out-of-range index"
              throw new RangeError("offset is out of bounds");
            }
            for (var i = 0; i < source.length; i++) {
              var value = source[i];
              var pair = bigIntToParts(value);
              array.set(pair, 2 * (targetOffset + i));
            }
          },
        },
        {
          get: function (target, idx, receiver) {
            if (typeof idx !== "string" || !/^\d+$/.test(idx)) {
              return Reflect.get(target, idx, receiver);
            }
            var lower = array[idx * 2];
            var upper = array[idx * 2 + 1];
            return partsToBigInt(lower, upper);
          },
          set: function (target, idx, value, receiver) {
            if (typeof idx !== "string" || !/^\d+$/.test(idx)) {
              return Reflect.set(target, idx, value, receiver);
            }
            if (typeof value !== "bigint") {
              // Chrome error message, Firefox has no "a" in front if "BigInt".
              throw new TypeError(`Cannot convert ${value} to a BigInt`);
            }
            var pair = bigIntToParts(value);
            array.set(pair, 2 * idx);
            return true;
          },
        }
      );
      if (orig_array) {
        proxy.set(orig_array);
      }
      return proxy;
    }
    return createBigInt64Array;
  }

  globalThis.BigUint64Array = createBigIntArrayShim(partsToBigIntUnsigned);
  globalThis.BigInt64Array = createBigIntArrayShim(partsToBigIntSigned);
}

// end include: polyfill/bigint64array.js

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)


// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = Object.assign({}, Module);

var arguments_ = [];
var thisProgram = './this.program';
var quit_ = (status, toThrow) => {
  throw toThrow;
};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = typeof window == 'object';
var ENVIRONMENT_IS_WORKER = typeof importScripts == 'function';
// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = typeof process == 'object' && typeof process.versions == 'object' && typeof process.versions.node == 'string';
var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (Module['ENVIRONMENT']) {
  throw new Error('Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)');
}

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var read_,
  readAsync,
  readBinary,
  setWindowTitle;

if (ENVIRONMENT_IS_SHELL) {

  if ((typeof process == 'object' && typeof require === 'function') || typeof window == 'object' || typeof importScripts == 'function') throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

  if (typeof read != 'undefined') {
    read_ = (f) => {
      return read(f);
    };
  }

  readBinary = (f) => {
    let data;
    if (typeof readbuffer == 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data == 'object');
    return data;
  };

  readAsync = (f, onload, onerror) => {
    setTimeout(() => onload(readBinary(f)), 0);
  };

  if (typeof clearTimeout == 'undefined') {
    globalThis.clearTimeout = (id) => { };
  }

  if (typeof scriptArgs != 'undefined') {
    arguments_ = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    arguments_ = arguments;
  }

  if (typeof quit == 'function') {
    quit_ = (status, toThrow) => {
      // Unlike node which has process.exitCode, d8 has no such mechanism. So we
      // have no way to set the exit code and then let the program exit with
      // that code when it naturally stops running (say, when all setTimeouts
      // have completed). For that reason, we must call `quit` - the only way to
      // set the exit code - but quit also halts immediately.  To increase
      // consistency with node (and the web) we schedule the actual quit call
      // using a setTimeout to give the current stack and any exception handlers
      // a chance to run.  This enables features such as addOnPostRun (which
      // expected to be able to run code after main returns).
      setTimeout(() => {
        if (!(toThrow instanceof ExitStatus)) {
          let toLog = toThrow;
          if (toThrow && typeof toThrow == 'object' && toThrow.stack) {
            toLog = [toThrow, toThrow.stack];
          }
          err('exiting due to exception: ' + toLog);
        }
        quit(status);
      });
      throw toThrow;
    };
  }

  if (typeof print != 'undefined') {
    // Prefer to use print/printErr where they exist, as they usually work better.
    if (typeof console == 'undefined') console = /** @type{!Console} */({});
    console.log = /** @type{!function(this:Console, ...*): undefined} */ (print);
    console.warn = console.error = /** @type{!function(this:Console, ...*): undefined} */ (typeof printErr != 'undefined' ? printErr : print);
  }

} else

  // Note that this includes Node.js workers when relevant (pthreads is enabled).
  // Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
  // ENVIRONMENT_IS_NODE.
  if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
      scriptDirectory = self.location.href;
    } else if (typeof document != 'undefined' && document.currentScript) { // web
      scriptDirectory = document.currentScript.src;
    }
    // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
    // otherwise, slice off the final part of the url to find the script directory.
    // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
    // and scriptDirectory will correctly be replaced with an empty string.
    // If scriptDirectory contains a query (starting with ?) or a fragment (starting with #),
    // they are removed because they could contain a slash.
    if (scriptDirectory.indexOf('blob:') !== 0) {
      scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf('/') + 1);
    } else {
      scriptDirectory = '';
    }

    if (!(typeof window == 'object' || typeof importScripts == 'function')) throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

    // Differentiate the Web Worker from the Node Worker case, as reading must
    // be done differently.
    {
      // include: web_or_worker_shell_read.js
      /**
       * @license
       * Copyright 2019 The Emscripten Authors
       * SPDX-License-Identifier: MIT
       */

      read_ = (url) => {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.send(null);
        return xhr.responseText;
      }

      if (ENVIRONMENT_IS_WORKER) {
        readBinary = (url) => {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', url, false);
          xhr.responseType = 'arraybuffer';
          xhr.send(null);
          return new Uint8Array(/** @type{!ArrayBuffer} */(xhr.response));
        };
      }

      readAsync = (url, onload, onerror) => {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
            onload(xhr.response);
            return;
          }
          onerror();
        };
        xhr.onerror = onerror;
        xhr.send(null);
      }

      // end include: web_or_worker_shell_read.js
    }

    setWindowTitle = (title) => document.title = title;
  } else {
    throw new Error('environment detection error');
  }

var out = console.log.bind(console);
var err = console.warn.bind(console);

// Merge back in the overrides
Object.assign(Module, moduleOverrides);
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = null;
// checkIncomingModuleAPI();

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
legacyModuleProp('arguments', 'arguments_');
legacyModuleProp('thisProgram', 'thisProgram');
legacyModuleProp('quit', 'quit_');

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
// Assertions on removed incoming Module JS APIs.
assert(typeof Module['memoryInitializerPrefixURL'] == 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['pthreadMainPrefixURL'] == 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['cdInitializerPrefixURL'] == 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['filePackagePrefixURL'] == 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['read'] == 'undefined', 'Module.read option was removed (modify read_ in JS)');
assert(typeof Module['readAsync'] == 'undefined', 'Module.readAsync option was removed (modify readAsync in JS)');
assert(typeof Module['readBinary'] == 'undefined', 'Module.readBinary option was removed (modify readBinary in JS)');
assert(typeof Module['setWindowTitle'] == 'undefined', 'Module.setWindowTitle option was removed (modify setWindowTitle in JS)');
assert(typeof Module['TOTAL_MEMORY'] == 'undefined', 'Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY');
legacyModuleProp('read', 'read_');
legacyModuleProp('readAsync', 'readAsync');
legacyModuleProp('readBinary', 'readBinary');
legacyModuleProp('setWindowTitle', 'setWindowTitle');
var IDBFS = 'IDBFS is no longer included by default; build with -lidbfs.js';
var PROXYFS = 'PROXYFS is no longer included by default; build with -lproxyfs.js';
var WORKERFS = 'WORKERFS is no longer included by default; build with -lworkerfs.js';
var NODEFS = 'NODEFS is no longer included by default; build with -lnodefs.js';


// end include: shell.js
// include: preamble.js
/**
 * @license
 * Copyright 2010 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html

var wasmBinary; legacyModuleProp('wasmBinary', 'wasmBinary');
var noExitRuntime = true; legacyModuleProp('noExitRuntime', 'noExitRuntime');


// Wasm globals

var wasmMemory;

//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed' + (text ? ': ' + text : ''));
  }
}

// We used to include malloc/free by default in the past. Show a helpful error in
// builds with assertions.
function _malloc() {
  abort("malloc() called but not included in the build - add '_malloc' to EXPORTED_FUNCTIONS");
}
function _free() {
  // Show a helpful error since we used to include free by default in the past.
  // console.warn("free() called but not included in the build - add '_free' to EXPORTED_FUNCTIONS");
}

// Memory management

var HEAP = [],
  /** @type {!Int8Array} */
  HEAP8 = [],
  /** @type {!Uint8Array} */
  HEAPU8 = [],
  /** @type {!Int16Array} */
  HEAP16 = [],
  /** @type {!Uint16Array} */
  HEAPU16 = [],
  /** @type {!Int32Array} */
  HEAP32 = [],
  /** @type {!Uint32Array} */
  HEAPU32 = [],
  /** @type {!Float32Array} */
  HEAPF32 = [],
  /* BigInt64Array type is not correctly defined in closure
  /** not-@type {!BigInt64Array} */
  HEAP64 = [],
  /* BigUInt64Array type is not correctly defined in closure
  /** not-t@type {!BigUint64Array} */
  HEAPU64 = [],
  /** @type {!Float64Array} */
  HEAPF64 = [],

  DATA_VIEW = [];


var HEAP_OFFSET = [];

function updateMemoryViews(offset, offset2, offset3, offset4) {
  // var b = wasmMemory.buffer;
  var b = globalThis.jsiArrayBuffer;
  var b2 = globalThis.jsiArrayBuffer2;
  var b3 = globalThis.jsiArrayBuffer3;
  var b4 = globalThis.jsiArrayBuffer4;

  // console.log('length: ' + b.byteLength + ', offset 1: ' + offset + ', offset 2: ' + offset2 + ', offset 3: ' + offset3 + ', offset 4: ' + offset4);

  HEAP_OFFSET = [offset, offset2, offset3, offset4];

  HEAP8.push(new Int8Array(b));
  HEAP8.push(new Int8Array(b2));
  HEAP8.push(new Int8Array(b3));
  HEAP8.push(new Int8Array(b4));

  HEAPU8.push(new Uint8Array(b));
  HEAPU8.push(new Uint8Array(b2));
  HEAPU8.push(new Uint8Array(b3));
  HEAPU8.push(new Uint8Array(b4));

  DATA_VIEW.push(new DataView(b));
  DATA_VIEW.push(new DataView(b2));
  DATA_VIEW.push(new DataView(b3));
  DATA_VIEW.push(new DataView(b4));
}

function __crossbind_register_heap_window(offset, arrayBuffer) {
  for (let i = 0; i < HEAP_OFFSET.length; i++) {
    if (HEAP_OFFSET[i] === offset) return;
  }
  HEAP_OFFSET.push(offset);
  HEAP8.push(new Int8Array(arrayBuffer));
  HEAPU8.push(new Uint8Array(arrayBuffer));
  DATA_VIEW.push(new DataView(arrayBuffer));
}
globalThis.__crossbind_register_heap_window = __crossbind_register_heap_window;

const UINT32_MAX_BIGINT = 4294967295n;

function findHeapIndex(ptr) {
  let bestIdx = -1;
  let bestDelta = UINT32_MAX_BIGINT;
  for (let i = 0; i < HEAP_OFFSET.length; i++) {
    const offset = HEAP_OFFSET[i];
    if (ptr >= offset) {
      const delta = ptr - offset;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

function getHeapIndex(ptr) {
  let bestIdx = findHeapIndex(ptr);

  // Self-healing: a pointer can land outside every window (fresh heap regions from
  // by-value returns, allocator arenas, ...). Ask native to register a covering
  // window and retry once before giving up.
  if (bestIdx === -1 && typeof globalThis.__crossbind_ensure_heap_window === 'function') {
    globalThis.__crossbind_ensure_heap_window(ptr);
    bestIdx = findHeapIndex(ptr);
  }

  if (bestIdx === -1) {
    throw (`Heap error !!! pointer: ${ptr}, no covering window in: ${HEAP_OFFSET}`);
  }

  return bestIdx;
}

function writeToMemoryUsingShift(pointer, signed, shift, value) {
  // console.log(`writeToMemory, pointer: ${pointer}`);
  const pi = getHeapIndex(pointer);
  const offset = Number(pointer - HEAP_OFFSET[pi]);
  const shiftAsInt = Number(shift);
  // console.log(`writeToMemory, pi: ${pi}, shift: ${shiftAsInt}, signed: ${signed}, value: ${value}, pointer: ${pointer}`);

  switch (shiftAsInt) {
    case 0: result = signed ? DATA_VIEW[pi].setInt8(offset, value, true) : DATA_VIEW[pi].setUint8(offset, value, true);
      break;
    case 1: result = signed ? DATA_VIEW[pi].setInt16(offset, value, true) : DATA_VIEW[pi].setUint16(offset, value, true);
      break;
    case 2: result = signed ? DATA_VIEW[pi].setInt32(offset, value, true) : DATA_VIEW[pi].setUint32(offset, value, true);
      break;
    case 3: result = signed ? DATA_VIEW[pi].setBigInt64(offset, value, true) : DATA_VIEW[pi].setBigUint64(offset, value, true);
      break;
    default:
      throw new TypeError("Unknown heap type");
  }
}

function readFromMemoryUsingShift(pointer, signed, shift, isFloat = false) {
  // console.log(`readFromMemory, pointer: ${pointer}`);
  const pi = getHeapIndex(pointer);
  const offset = Number(pointer - HEAP_OFFSET[pi]);
  // console.log(`readFromMemory, pi: ${pi}, shift: ${shift}, signed: ${signed}, pointer: ${pointer}, offset: ${offset}`);
  const shiftAsInt = Number(shift);

  let result = null;
  if (isFloat) {
    switch (shiftAsInt) {
      case 2: result = DATA_VIEW[pi].getFloat32(offset, true);
        break;
      case 3: result = DATA_VIEW[pi].getFloat64(offset, true);
        break;
      default:
        throw new TypeError("Unknown heap type");
    }
  } else {
    switch (shiftAsInt) {
      case 0: result = signed ? DATA_VIEW[pi].getInt8(offset, true) : DATA_VIEW[pi].getUint8(offset, true);
        break;
      case 1: result = signed ? DATA_VIEW[pi].getInt16(offset, true) : DATA_VIEW[pi].getUint16(offset, true);
        break;
      case 2: result = signed ? DATA_VIEW[pi].getInt32(offset, true) : DATA_VIEW[pi].getUint32(offset, true);
        break;
      case 3: result = signed ? DATA_VIEW[pi].getBigInt64(offset, true) : DATA_VIEW[pi].getBigUint64(offset, true);
        break;
      default:
        throw new TypeError("Unknown heap type");
    }
  }

  // console.log(`readFromMemory, result 1: ${result}`);

  return result;
}

function readFromMemoryUsingBit(pointer, signed, bit) {
  let shift = 0;
  switch (bit) {
    case 8: shift = 0;
      break;
    case 16: shift = 1;
      break;
    case 32: shift = 2;
      break;
    case 64: shift = 3;
      break;
    default:
      throw new TypeError("Unknown bit");
  }

  return readFromMemoryUsingShift(pointer, signed, shift);
}

function readFromMemoryUsingSize(pointer, signed, bit) {
  let shift = 0;
  switch (bit) {
    case 1: shift = 0;
      break;
    case 2: shift = 1;
      break;
    case 4: shift = 2;
      break;
    default:
      throw new TypeError("Unknown size");
  }

  return readFromMemoryUsingShift(pointer, signed, shift);
}

globalThis.updateMemoryViews = updateMemoryViews;

assert(!Module['STACK_SIZE'], 'STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time')

assert(typeof Int32Array != 'undefined' && typeof Float64Array !== 'undefined' && Int32Array.prototype.subarray != undefined && Int32Array.prototype.set != undefined,
  'JS engine does not provide full typed array support');

// If memory is defined in wasm, the user can't provide it, or set INITIAL_MEMORY
assert(!Module['wasmMemory'], 'Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally');
assert(!Module['INITIAL_MEMORY'], 'Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically');

// include: runtime_init_table.js
// In regular non-RELOCATABLE mode the table is exported
// from the wasm module and this will be assigned once
// the exports are available.
var wasmTable;

// end include: runtime_init_table.js
// include: runtime_stack_check.js
/**
 * @license
 * Copyright 2019 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// end include: runtime_stack_check.js
// include: runtime_assertions.js
/**
 * @license
 * Copyright 2019 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// Endianness check
(function () {
  var h16 = new Int16Array(1);
  var h8 = new Int8Array(h16.buffer);
  h16[0] = 0x6373;
  if (h8[0] !== 0x73 || h8[1] !== 0x63) throw 'Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)';
})();

// end include: runtime_assertions.js
var __ATPRERUN__ = []; // functions called before the runtime is initialized
var __ATINIT__ = []; // functions called during startup
var __ATEXIT__ = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;

var runtimeKeepaliveCounter = 0;

function keepRuntimeAlive() {
  return noExitRuntime || runtimeKeepaliveCounter > 0;
}

function preRun() {
  callRuntimeCallbacks(__ATPRERUN__);
}

function initRuntime() {
  assert(!runtimeInitialized);
  runtimeInitialized = true;

  callRuntimeCallbacks(__ATINIT__);
}

function postRun() {

  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

// include: runtime_math.js
/**
 * @license
 * Copyright 2019 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/fround

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/trunc

assert(Math.imul, 'This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.fround, 'This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.clz32, 'This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.trunc, 'This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');

// end include: runtime_math.js
// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

function getUniqueRunDependency(id) {
  var orig = id;
  while (1) {
    if (!runDependencyTracking[id]) return id;
    id = orig + Math.random();
  }
}

function addRunDependency(id) {
  runDependencies++;

  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval != 'undefined') {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(() => {
        if (ABORT) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
          return;
        }
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            err('still waiting on run dependencies:');
          }
          err('dependency: ' + dep);
        }
        if (shown) {
          err('(end of list)');
        }
      }, 10000);
    }
  } else {
    err('warning: run dependency added without ID');
  }
}

function removeRunDependency(id) {
  runDependencies--;

  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    err('warning: run dependency removed without ID');
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

/** @param {string|number=} what */
function abort(what) {

  what = 'Aborted(' + what + ')';
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);

  ABORT = true;
  EXITSTATUS = 1;

  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.

  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // defintion for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */
  var e = new WebAssembly.RuntimeError(what);

  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

// include: memoryprofiler.js
/**
 * @license
 * Copyright 2015 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// end include: memoryprofiler.js
// show errors on likely calls to FS when it was not included
var FS = {
  error: function () {
    abort('Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with -sFORCE_FILESYSTEM');
  },
  init: function () { FS.error() },
  createDataFile: function () { FS.error() },
  createPreloadedFile: function () { FS.error() },
  createLazyFile: function () { FS.error() },
  open: function () { FS.error() },
  mkdev: function () { FS.error() },
  registerDevice: function () { FS.error() },
  analyzePath: function () { FS.error() },

  ErrnoError: function ErrnoError() { FS.error() },
};
Module['FS_createDataFile'] = FS.createDataFile;
Module['FS_createPreloadedFile'] = FS.createPreloadedFile;

// include: URIUtils.js
/**
 * @license
 * Copyright 2017 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  // Prefix of data URIs emitted by SINGLE_FILE and related options.
  return filename.startsWith(dataURIPrefix);
}

// Indicates whether filename is delivered via file protocol (as opposed to http/https)
function isFileURI(filename) {
  return filename.startsWith('file://');
}

// end include: URIUtils.js
/** @param {boolean=} fixedasm */
function createExportWrapper(name, fixedasm) {
  return function () {
    var displayName = name;
    var asm = fixedasm;
    if (!fixedasm) {
      asm = Module['asm'];
    }
    assert(runtimeInitialized, 'native function `' + displayName + '` called before runtime initialization');
    if (!asm[name]) {
      assert(asm[name], 'exported native function `' + displayName + '` not found');
    }
    return asm[name].apply(null, arguments);
  };
}

// include: runtime_exceptions.js
/**
 * @license
 * Copyright 2023 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// end include: runtime_exceptions.js
var wasmBinaryFile;
wasmBinaryFile = '';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function getBinary(file) {
  try {
    if (file == wasmBinaryFile && wasmBinary) {
      return new Uint8Array(wasmBinary);
    }
    if (readBinary) {
      return readBinary(file);
    }
    throw "both async and sync fetching of the wasm failed";
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise(binaryFile) {
  // If we don't have the binary yet, try to load it asynchronously.
  // Fetch has some additional restrictions over XHR, like it can't be used on a file:// url.
  // See https://github.com/github/fetch/pull/92#issuecomment-140665932
  // Cordova or Electron apps are typically loaded from a file:// url.
  // So use fetch if it is available and the url is not a file, otherwise fall back to XHR.
  if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
    if (typeof fetch == 'function'
      && !isFileURI(binaryFile)
    ) {
      return fetch(binaryFile, { credentials: 'same-origin' }).then((response) => {
        if (!response['ok']) {
          throw "failed to load wasm binary file at '" + binaryFile + "'";
        }
        return response['arrayBuffer']();
      }).catch(() => getBinary(binaryFile));
    }
    else {
      if (readAsync) {
        // fetch is not available or url is file => try XHR (readAsync uses XHR internally)
        return new Promise((resolve, reject) => {
          readAsync(binaryFile, (response) => resolve(new Uint8Array(/** @type{!ArrayBuffer} */(response))), reject)
        });
      }
    }
  }

  // Otherwise, getBinary should be able to get it synchronously
  return Promise.resolve().then(() => getBinary(binaryFile));
}

function instantiateArrayBuffer(binaryFile, imports, receiver) {
  return getBinaryPromise(binaryFile).then((binary) => {
    return WebAssembly.instantiate(binary, imports);
  }).then((instance) => {
    return instance;
  }).then(receiver, (reason) => {
    err('failed to asynchronously prepare wasm: ' + reason);

    // Warn on some common problems.
    if (isFileURI(wasmBinaryFile)) {
      err('warning: Loading from a file URI (' + wasmBinaryFile + ') is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing');
    }
    abort(reason);
  });
}

function instantiateAsync(binary, binaryFile, imports, callback) {
  if (!binary &&
    typeof WebAssembly.instantiateStreaming == 'function' &&
    !isDataURI(binaryFile) &&
    // Don't use streaming for file:// delivered objects in a webview, fetch them synchronously.
    !isFileURI(binaryFile) &&
    // Avoid instantiateStreaming() on Node.js environment for now, as while
    // Node.js v18.1.0 implements it, it does not have a full fetch()
    // implementation yet.
    //
    // Reference:
    //   https://github.com/emscripten-core/emscripten/pull/16917
    !ENVIRONMENT_IS_NODE &&
    typeof fetch == 'function') {
    return fetch(binaryFile, { credentials: 'same-origin' }).then((response) => {
      // Suppress closure warning here since the upstream definition for
      // instantiateStreaming only allows Promise<Repsponse> rather than
      // an actual Response.
      // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure is fixed.
      /** @suppress {checkTypes} */
      var result = WebAssembly.instantiateStreaming(response, imports);

      return result.then(
        callback,
        function (reason) {
          // We expect the most common failure cause to be a bad MIME type for the binary,
          // in which case falling back to ArrayBuffer instantiation should work.
          err('wasm streaming compile failed: ' + reason);
          err('falling back to ArrayBuffer instantiation');
          return instantiateArrayBuffer(binaryFile, imports, callback);
        });
    });
  } else {
    return instantiateArrayBuffer(binaryFile, imports, callback);
  }
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm() {
  // prepare imports
  var info = {
    'env': wasmImports,
    'wasi_snapshot_preview1': wasmImports,
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/
  function receiveInstance(instance, module) {
    var exports = instance.exports;

    exports = instrumentWasmExportsForMemory64(exports);

    Module['asm'] = exports;

    wasmMemory = Module['asm']['memory'];
    assert(wasmMemory, "memory not found in wasm exports");
    // This assertion doesn't hold when emscripten is run in --post-link
    // mode.
    // TODO(sbc): Read INITIAL_MEMORY out of the wasm file in post-link mode.
    //assert(wasmMemory.buffer.byteLength === 16777216);
    updateMemoryViews();

    wasmTable = Module['asm']['__indirect_function_table'];
    assert(wasmTable, "table not found in wasm exports");

    removeRunDependency('wasm-instantiate');

    return exports;
  }
  // wait for the pthread pool (if any)
  addRunDependency('wasm-instantiate');

  // Prefer streaming instantiation if available.
  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
    // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
    // When the regression is fixed, can restore the above PTHREADS-enabled path.
    receiveInstance(result['instance']);
  }

  instantiateAsync(wasmBinary, wasmBinaryFile, info, receiveInstantiationResult);
  return {}; // no exports yet; we'll fill them in later
}

// include: runtime_debug.js
/**
 * @license
 * Copyright 2020 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

function legacyModuleProp(prop, newName) {
  if (!Object.getOwnPropertyDescriptor(Module, prop)) {
    Object.defineProperty(Module, prop, {
      configurable: true,
      get: function () {
        abort('Module.' + prop + ' has been replaced with plain ' + newName + ' (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)');
      }
    });
  }
}

function ignoredModuleProp(prop) {
  if (Object.getOwnPropertyDescriptor(Module, prop)) {
    abort('`Module.' + prop + '` was supplied but `' + prop + '` not included in INCOMING_MODULE_JS_API');
  }
}

// forcing the filesystem exports a few things by default
function isExportedByForceFilesystem(name) {
  return name === 'FS_createPath' ||
    name === 'FS_createDataFile' ||
    name === 'FS_createPreloadedFile' ||
    name === 'FS_unlink' ||
    name === 'addRunDependency' ||
    // The old FS has some functionality that WasmFS lacks.
    name === 'FS_createLazyFile' ||
    name === 'FS_createDevice' ||
    name === 'removeRunDependency';
}

function missingGlobal(sym, msg) {
  if (typeof globalThis !== 'undefined') {
    Object.defineProperty(globalThis, sym, {
      configurable: true,
      get: function () {
        warnOnce('`' + sym + '` is not longer defined by emscripten. ' + msg);
        return undefined;
      }
    });
  }
}

missingGlobal('buffer', 'Please use HEAP8.buffer or wasmMemory.buffer');

function missingLibrarySymbol(sym) {
  if (typeof globalThis !== 'undefined' && !Object.getOwnPropertyDescriptor(globalThis, sym)) {
    Object.defineProperty(globalThis, sym, {
      configurable: true,
      get: function () {
        // Can't `abort()` here because it would break code that does runtime
        // checks.  e.g. `if (typeof SDL === 'undefined')`.
        var msg = '`' + sym + '` is a library symbol and not included by default; add it to your library.js __deps or to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE on the command line';
        // DEFAULT_LIBRARY_FUNCS_TO_INCLUDE requires the name as it appears in
        // library.js, which means $name for a JS name with no prefix, or name
        // for a JS name like _name.
        var librarySymbol = sym;
        if (!librarySymbol.startsWith('_')) {
          librarySymbol = '$' + sym;
        }
        msg += " (e.g. -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=" + librarySymbol + ")";
        if (isExportedByForceFilesystem(sym)) {
          msg += '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
        }
        warnOnce(msg);
        return undefined;
      }
    });
  }
  // Any symbol that is not included from the JS libary is also (by definition)
  // not exported on the Module object.
  unexportedRuntimeSymbol(sym);
}

function unexportedRuntimeSymbol(sym) {
  if (!Object.getOwnPropertyDescriptor(Module, sym)) {
    Object.defineProperty(Module, sym, {
      configurable: true,
      get: function () {
        var msg = "'" + sym + "' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the FAQ)";
        if (isExportedByForceFilesystem(sym)) {
          msg += '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
        }
        abort(msg);
      }
    });
  }
}

// Used by XXXXX_DEBUG settings to output debug messages.
function dbg(text) {
  // TODO(sbc): Make this configurable somehow.  Its not always convenient for
  // logging to show up as errors.
  console.error.apply(console, arguments);
}

// end include: runtime_debug.js
// === Body ===


// end include: preamble.js

function embind_init_charCodes() {
  var codes = new Array(256);
  for (var i = 0; i < 256; ++i) {
    codes[i] = String.fromCharCode(i);
  }
  embind_charCodes = codes;
}
var embind_charCodes = undefined;
function readLatin1String(ptr) {
  return ptr;
  /* var ret = "";
  var c = ptr;
  while (HEAPU8[c]) {
      ret += embind_charCodes[HEAPU8[c++]];
  }
  return ret; */
}

var awaitingDependencies = {};

var registeredTypes = {};

var typeDependencies = {};

var char_0 = 48;

var char_9 = 57;
function makeLegalFunctionName(name) {
  if (undefined === name) {
    return '_unknown';
  }
  name = name.replace(/[^a-zA-Z0-9_]/g, '$');
  var f = name.charCodeAt(0);
  if (f >= char_0 && f <= char_9) {
    return '_' + name;
  }
  return name;
}
function createNamedFunction(name, body) {
  name = makeLegalFunctionName(name);
  // Use an abject with a computed property name to create a new function with
  // a name specified at runtime, but without using `new Function` or `eval`.
  return {
    [name]: function () {
      return body.apply(this, arguments);
    }
  }[name];
}
function extendError(baseErrorType, errorName) {
  var errorClass = createNamedFunction(errorName, function (message) {
    this.name = errorName;
    this.message = message;

    var stack = (new Error(message)).stack;
    if (stack !== undefined) {
      this.stack = this.toString() + '\n' +
        stack.replace(/^Error(:[^\n]*)?\n/, '');
    }
  });
  errorClass.prototype = Object.create(baseErrorType.prototype);
  errorClass.prototype.constructor = errorClass;
  errorClass.prototype.toString = function () {
    if (this.message === undefined) {
      return this.name;
    } else {
      return this.name + ': ' + this.message;
    }
  };

  return errorClass;
}
var BindingError = undefined;
function throwBindingError(message) {
  console.log(message);
  throw new BindingError(message);
}




var InternalError = undefined;
function throwInternalError(message) {
  throw new InternalError(message);
}
function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
  myTypes.forEach(function (type) {
    typeDependencies[type] = dependentTypes;
  });

  function onComplete(typeConverters) {
    var myTypeConverters = getTypeConverters(typeConverters);
    if (myTypeConverters.length !== myTypes.length) {
      throwInternalError('Mismatched type converter count');
    }
    for (var i = 0; i < myTypes.length; ++i) {
      registerType(myTypes[i], myTypeConverters[i]);
    }
  }

  var typeConverters = new Array(dependentTypes.length);
  var unregisteredTypes = [];
  var registered = 0;
  dependentTypes.forEach((dt, i) => {
    if (registeredTypes.hasOwnProperty(dt)) {
      typeConverters[i] = registeredTypes[dt];
    } else {
      unregisteredTypes.push(dt);
      if (!awaitingDependencies.hasOwnProperty(dt)) {
        awaitingDependencies[dt] = [];
      }
      awaitingDependencies[dt].push(() => {
        typeConverters[i] = registeredTypes[dt];
        ++registered;
        if (registered === unregisteredTypes.length) {
          onComplete(typeConverters);
        }
      });
    }
  });
  if (0 === unregisteredTypes.length) {
    onComplete(typeConverters);
  }
}
/** @param {Object=} options */
function registerType(rawType, registeredInstance, options = {}) {
  // console.log('1', rawType);
  if (!('argPackAdvance' in registeredInstance)) {
    throw new TypeError('registerType registeredInstance requires argPackAdvance');
  }

  // console.log('2', rawType);
  var name = registeredInstance.name;
  if (!rawType) {
    throwBindingError(`type "${name}" must have a positive integer typeid pointer`);
  }
  // console.log('3', rawType);
  if (registeredTypes.hasOwnProperty(rawType)) {
    if (options.ignoreDuplicateRegistrations) {
      return;
    } else {
      throwBindingError(`Cannot register type '${name}' twice`);
    }
  }
  // console.log('4', rawType);
  registeredTypes[rawType] = registeredInstance;
  delete typeDependencies[rawType];
  // console.log('5', rawType);
  if (awaitingDependencies.hasOwnProperty(rawType)) {
    var callbacks = awaitingDependencies[rawType];
    delete awaitingDependencies[rawType];
    callbacks.forEach((cb) => cb());
  }
  // console.log('6', rawType);
}

function __embind_register_void(rawType, name) {
  name = readLatin1String(name);
  // console.log('__embind_register_void', name, rawType);
  registerType(rawType, {
    isVoid: true, // void return values can be optimized out sometimes
    name: name,
    'argPackAdvance': 0n,
    'fromWireType': function () {
      return undefined;
    },
    'toWireType': function (destructors, o) {
      // TODO: assert if anything else is given?
      return undefined;
    },
  });
}
globalThis.__embind_register_void = __embind_register_void;

function __embind_register_jsiValue(rawType, name) {
  name = readLatin1String(name);
  // console.log('__embind_register_jsiValue', name, rawType);
  registerType(rawType, {
    isVoid: false, // void return values can be optimized out sometimes
    name: name,
    'argPackAdvance': 0n,
    'fromWireType': function (v) {
      return v;
    },
    'toWireType': function (destructors, o) {
      return o;
    },
  });
}
globalThis.__embind_register_jsiValue = __embind_register_jsiValue;

function getShiftFromSize(size) {
  switch (size) {
    case 1: return 0;
    case 2: return 1;
    case 4: return 2;
    case 8: return 3;
    case 1n: return 0;
    case 2n: return 1;
    case 4n: return 2;
    case 8n: return 3;
    default:
      throw new TypeError('Unknown type size: ' + size);
  }
}


function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
  // console.log('bool', name, rawType, size, trueValue, falseValue);
  var shift = getShiftFromSize(size);

  name = readLatin1String(name);
  registerType(rawType, {
    name: name,
    'fromWireType': function (wt) {
      // ambiguous emscripten ABI: sometimes return values are
      // true or false, and sometimes integers (0 or 1)
      return !!wt;
    },
    'toWireType': function (destructors, o) {
      return o ? trueValue : falseValue;
    },
    'argPackAdvance': 8n,
    'readValueFromPointer': function (pointer) {
      // console.log('__embind_register_bool readValueFromPointer', pointer);
      return this['fromWireType'](readFromMemoryUsingSize(pointer, true, size));
    },
    destructorFunction: null, // This type does not need a destructor
  });
}
globalThis.__embind_register_bool = __embind_register_bool;

function __embind_register_optional(rawOptionalType, rawInnerType) {
  whenDependentTypesAreResolved([rawOptionalType], [rawInnerType], function (innerTypes) {
    var inner = innerTypes[0];
    return [{
      name: `std::optional<${inner.name}>`,
      // No value crosses as undefined (JS may also hand back null); a present value
      // rides the inner type's own converters unchanged.
      'fromWireType': function (wt) {
        if (wt === undefined || wt === null) return undefined;
        return inner['fromWireType'](wt);
      },
      'toWireType': function (destructors, o) {
        if (o === undefined || o === null) return undefined;
        return inner['toWireType'](destructors, o);
      },
      'argPackAdvance': 8n,
      'readValueFromPointer': function (pointer) {
        throw new Error(`std::optional<${inner.name}> cannot be read from raw memory`);
      },
      destructorFunction: null,
    }];
  });
}
globalThis.__embind_register_optional = __embind_register_optional;

function embindRepr(v) {
  if (v === null) {
    return 'null';
  }
  var t = typeof v;
  if (t === 'object' || t === 'array' || t === 'function') {
    return v.toString();
  } else {
    return '' + v;
  }
}


function integerReadValueFromPointer(name, shift, signed) {
  // integers are quite common, so generate very specialized functions
  switch (shift) {
    case 0:
    case 0n: return signed ?
      function readS8FromPointer(pointer) { return readFromMemoryUsingShift(pointer, true, 0); } :
      function readU8FromPointer(pointer) { return readFromMemoryUsingShift(pointer, false, 0); };
    case 1:
    case 1n: return signed ?
      function readS16FromPointer(pointer) { return readFromMemoryUsingShift(pointer, true, 1); } :
      function readU16FromPointer(pointer) { return readFromMemoryUsingShift(pointer, false, 1); };
    case 2:
    case 2n: return signed ?
      function readS32FromPointer(pointer) { return readFromMemoryUsingShift(pointer, true, 2); } :
      function readU32FromPointer(pointer) { return readFromMemoryUsingShift(pointer, false, 2); };
    case 3:
    case 3n: return signed ?
      function readS64FromPointer(pointer) { return readFromMemoryUsingShift(pointer, true, 3); } :
      function readU64FromPointer(pointer) { return readFromMemoryUsingShift(pointer, false, 3); };
    default:
      throw new TypeError("Unknown integer type: " + name);
  }
}


function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
  // console.log('integer', name, primitiveType, size, minRange, maxRange);
  name = readLatin1String(name);
  // LLVM doesn't have signed and unsigned 32-bit types, so u32 literals come
  // out as 'i32 -1'. Always treat those as max u32.
  /* if (maxRange === -1) {
      maxRange = 4294967295;
  } */

  var shift = getShiftFromSize(size);

  var fromWireType = (value) => value;

  if (minRange === 0) {
    var bitshift = 32 - 8 * size;
    fromWireType = (value) => (value << bitshift) >>> bitshift;
  }

  var isUnsignedType = (name.includes('unsigned'));
  var checkAssertions = (value, toTypeName) => {
    if (typeof value != "number" && typeof value != "boolean" && typeof value != "bigint") {
      throw new TypeError(`Cannot convert "${embindRepr(value)}" to ${toTypeName}`);
    }
    if (value < minRange || (maxRange !== -1 && shift !== 2 && shift !== 3 && value > maxRange)) {
      throw new TypeError(`Passing a number "${embindRepr(value)}" from JS side to C/C++ side to an argument of type "${name}", which is outside the valid range [${minRange}, ${maxRange}]!`);
    }
  }
  var toWireType;
  if (isUnsignedType) {
    toWireType = function (destructors, value) {
      checkAssertions(value, this.name);
      return value >>> 0;
    }
  } else {
    toWireType = function (destructors, value) {
      checkAssertions(value, this.name);
      // The VM will perform JS to Wasm value conversion, according to the spec:
      // https://www.w3.org/TR/wasm-js-api-1/#towebassemblyvalue
      return value;
    }
  }
  registerType(primitiveType, {
    name: name,
    'fromWireType': fromWireType,
    'toWireType': toWireType,
    'argPackAdvance': 8n,
    'readValueFromPointer': integerReadValueFromPointer(name, shift, minRange !== 0),
    destructorFunction: null, // This type does not need a destructor
  });
}

globalThis.__embind_register_integer = __embind_register_integer;



function __embind_register_bigint(primitiveType, name, size, minRange, maxRange) {
  // console.log('bigint', name, primitiveType, size, minRange, maxRange);
  name = readLatin1String(name);

  var shift = getShiftFromSize(size);

  var isUnsignedType = (name.indexOf('u') != -1);

  // maxRange comes through as -1 for uint64_t (see issue 13902). Work around that temporarily
  if (isUnsignedType) {
    maxRange = (1n << 64n) - 1n;
  }

  registerType(primitiveType, {
    name: name,
    'fromWireType': function (value) {
      return value;
    },
    'toWireType': function (destructors, value) {
      // console.log('__embind_register_bigint - toWireType');
      if (typeof value != "bigint" && typeof value != "number") {
        throw new TypeError(`Cannot convert "${embindRepr(value)}" to ${this.name}`);
      }
      if (value < minRange || value > maxRange) {
        throw new TypeError(`Passing a number "${embindRepr(value)}" from JS side to C/C++ side to an argument of type "${name}", which is outside the valid range [${minRange}, ${maxRange}]!`);
      }
      return BigInt(value);
    },
    'argPackAdvance': 8n,
    'readValueFromPointer': integerReadValueFromPointer(name, shift, !isUnsignedType),
    destructorFunction: null, // This type does not need a destructor
  });
}

globalThis.__embind_register_bigint = __embind_register_bigint;


function floatReadValueFromPointer(name, shift) {
  switch (shift) {
    case 2:
    case 2n:
      return function (pointer) {
        return readFromMemoryUsingShift(pointer, true, 2, true);
      };
    case 3:
    case 3n:
      return function (pointer) {
        return readFromMemoryUsingShift(pointer, true, 3, true);
      };
    default:
      throw new TypeError("Unknown float type: " + name);
  }
}



function __embind_register_float(rawType, name, size) {
  // console.log('float', name, rawType, size);
  var shift = getShiftFromSize(size);
  name = readLatin1String(name);
  registerType(rawType, {
    name: name,
    'fromWireType': function (value) {
      return value;
    },
    'toWireType': function (destructors, value) {
      if (typeof value != "number" && typeof value != "boolean") {
        throw new TypeError(`Cannot convert ${embindRepr(value)} to ${this.name}`);
      }
      // The VM will perform JS to Wasm value conversion, according to the spec:
      // https://www.w3.org/TR/wasm-js-api-1/#towebassemblyvalue
      return value;
    },
    'argPackAdvance': 8n,
    'readValueFromPointer': floatReadValueFromPointer(name, shift),
    destructorFunction: null, // This type does not need a destructor
  });
}

globalThis.__embind_register_float = __embind_register_float;


function simpleReadValueFromPointer(pointer) {
  /* console.log(
    'simpleReadValueFromPointer :',
    this.name, JSON.stringify(pointer, null, 2),
    readFromMemoryUsingShift(pointer, true, 2)
  ); */
  return this['fromWireType'](readFromMemoryUsingShift(pointer, true, 2));
}

function simpleReadValueFromPointer64(pointer) {
  /* console.log(
    'simpleReadValueFromPointer :',
    this.name, JSON.stringify(pointer, null, 3),
    readFromMemoryUsingShift(pointer, true, 3)
  ); */
  return this['fromWireType'](readFromMemoryUsingShift(pointer, false, 3));
}


function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
  // console.log('stringToUTF8Array');
  assert(typeof str === 'string');
  // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
  // undefined and false each don't write out any bytes.
  if (!(maxBytesToWrite > 0))
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
    // unit, not a Unicode code point of the character! So decode
    // UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
    // and https://www.ietf.org/rfc/rfc2279.txt
    // and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      heap[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      heap[outIdx++] = 0xC0 | (u >> 6);
      heap[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      heap[outIdx++] = 0xE0 | (u >> 12);
      heap[outIdx++] = 0x80 | ((u >> 6) & 63);
      heap[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u > 0x10FFFF) warnOnce('Invalid Unicode code point ' + ptrToString(u) + ' encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).');
      heap[outIdx++] = 0xF0 | (u >> 18);
      heap[outIdx++] = 0x80 | ((u >> 12) & 63);
      heap[outIdx++] = 0x80 | ((u >> 6) & 63);
      heap[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  heap[outIdx] = 0;
  return outIdx - startIdx;
}
function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');

  const index = getHeapIndex(outPtr);
  return stringToUTF8Array(str, HEAPU8[index], outPtr - HEAP_OFFSET[index], maxBytesToWrite);
}

function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
    // unit, not a Unicode code point of the character! So decode
    // UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var c = str.charCodeAt(i); // possibly a lead surrogate
    if (c <= 0x7F) {
      len++;
    } else if (c <= 0x7FF) {
      len += 2;
    } else if (c >= 0xD800 && c <= 0xDFFF) {
      len += 4; ++i;
    } else {
      len += 3;
    }
  }
  return len;
}

var UTF8Decoder = typeof TextDecoder != 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
 * array that contains uint8 values, returns a copy of that string as a
 * Javascript String object.
 * heapOrArray is either a regular array, or a JavaScript typed array view.
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(heapOrArray, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on
  // null terminator by itself.  Also, use the length info to avoid running tiny
  // strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation,
  // so that undefined means Infinity)
  while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
    return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
  }
  var str = '';
  // If building with TextDecoder, we have already computed the string length
  // above, so test loop end condition against that
  while (idx < endPtr) {
    // For UTF8 byte structure, see:
    // http://en.wikipedia.org/wiki/UTF-8#Description
    // https://www.ietf.org/rfc/rfc2279.txt
    // https://tools.ietf.org/html/rfc3629
    var u0 = heapOrArray[idx++];
    if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
    var u1 = heapOrArray[idx++] & 63;
    if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
    var u2 = heapOrArray[idx++] & 63;
    if ((u0 & 0xF0) == 0xE0) {
      u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
    } else {
      if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte ' + ptrToString(u0) + ' encountered when deserializing a UTF-8 string in wasm memory to a JS string!');
      u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
    }

    if (u0 < 0x10000) {
      str += String.fromCharCode(u0);
    } else {
      var ch = u0 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    }
  }
  return str;
}


/**
 * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
 * emscripten HEAP, returns a copy of that string as a Javascript String object.
 *
 * @param {number} ptr
 * @param {number=} maxBytesToRead - An optional length that specifies the
 *   maximum number of bytes to read. You can omit this parameter to scan the
 *   string until the first 0 byte. If maxBytesToRead is passed, and the string
 *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
 *   string will cut short at that byte index (i.e. maxBytesToRead will not
 *   produce a string of exact length [ptr, ptr+maxBytesToRead[) N.B. mixing
 *   frequent uses of UTF8ToString() with and without maxBytesToRead may throw
 *   JS JIT optimizations off, so it is worth to consider consistently using one
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  assert(typeof ptr === 'bigint' || typeof ptr === 'number');
  const index = getHeapIndex(ptr);

  return ptr ? UTF8ArrayToString(HEAPU8[index], ptr - HEAP_OFFSET[index], maxBytesToRead) : '';
}
function __embind_register_std_string(rawType, name) {
  name = readLatin1String(name);
  var stdStringIsUTF8
    //process only std::string bindings with UTF8 support, in contrast to e.g. std::basic_string<unsigned char>
    = (name === "std::string");

  registerType(rawType, {
    name: name,
    'fromWireType': function (value) {
      if (typeof value !== 'bigint') {
        return value;
      }

      var length = readFromMemoryUsingShift(value, false, 2) //HEAPU32[value >> 2];
      var payload = value + 8n;
      var str;
      if (stdStringIsUTF8) {
        var decodeStartPtr = payload;
        for (var i = 0n; i <= length; ++i) {
          var currentBytePtr = payload + i;
          const heapIndex = getHeapIndex(currentBytePtr);
          if (i == length || HEAPU8[heapIndex][currentBytePtr - HEAP_OFFSET[heapIndex]] == 0) {
            var maxRead = currentBytePtr - decodeStartPtr;
            var stringSegment = UTF8ToString(decodeStartPtr, maxRead);
            if (str === undefined) {
              str = stringSegment
            } else {
              str += String.fromCharCode(0);
              str += stringSegment
            }
            decodeStartPtr = currentBytePtr + 1n
          }
        }
      } else {
        /* var a = new Array(length);
        for (var i = 0; i < length; ++i) {
          a[i] = String.fromCharCode(HEAPU8[payload + i])
        }
        str = a.join("") */
      }
      _free(value);
      return str;
    },
    'toWireType': function (destructors, value, usePointer = false) {
      return value;
      /* if (!usePointer) {
        return value;
      }

      if (value instanceof ArrayBuffer) {
        value = new Uint8Array(value)
      }
      var length;
      var valueIsOfTypeString = typeof value == "string";
      if (!(valueIsOfTypeString || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Int8Array)) {
        throwBindingError("Cannot pass non-string to std::string")
      }
      if (stdStringIsUTF8 && valueIsOfTypeString) {
        length = lengthBytesUTF8(value)
      } else {
        length = value.length
      }
      var base = _malloc(4 + length + 1);
      var ptr = base + 4;

      writeToMemoryUsingShift(base, false, 2, length); // HEAPU32[base >> 2] = length;
      if (stdStringIsUTF8 && valueIsOfTypeString) {
        stringToUTF8(value, ptr, length + 1)
      } else {
        if (valueIsOfTypeString) {
          for (var i = 0; i < length; ++i) {
            var charCode = value.charCodeAt(i);
            if (charCode > 255) {
              _free(ptr);
              throwBindingError("String has UTF-16 code units that do not fit in 8 bits")
            }
            writeToMemoryUsingShift(ptr + i, false, 0, charCode); // HEAPU8[ptr + i] = charCode
          }
        } else {
          for (var i = 0; i < length; ++i) {
            writeToMemoryUsingShift(ptr + i, false, 0, value[i]); //HEAPU8[ptr + i] = value[i]
          }
        }
      }
      if (destructors !== null) {
        destructors.push(_free, base)
      }
      return base; */
    },
    'argPackAdvance': 8n,
    'readValueFromPointer': simpleReadValueFromPointer64,
    destructorFunction: function (ptr) { _free(ptr); },
  });
}

globalThis.__embind_register_std_string = __embind_register_std_string;


var UTF16Decoder = (function () {
  try {
    return typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
  } catch (e) {
    return undefined;
  }
})();
function UTF16ToString(ptr, maxBytesToRead) {
  assert(ptr % 2 == 0, 'Pointer passed to UTF16ToString must be aligned to two bytes!');
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on
  // null terminator by itself.
  // Also, use the length info to avoid running tiny strings through
  // TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  var maxIdx = idx + maxBytesToRead / 2;
  // If maxBytesToRead is not passed explicitly, it will be undefined, and this
  // will always evaluate to true. This saves on code size.
  while (!(idx >= maxIdx) && HEAPU16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder)
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));

  // Fallback: decode without UTF16Decoder
  var str = '';

  // If maxBytesToRead is not passed explicitly, it will be undefined, and the
  // for-loop's condition will always evaluate to true. The loop is then
  // terminated on the first null char.
  for (var i = 0; !(i >= maxBytesToRead / 2); ++i) {
    var codeUnit = HEAP16[(((ptr) + (i * 2)) >> 1)];
    if (codeUnit == 0) break;
    // fromCharCode constructs a character from a UTF-16 code unit, so we can
    // pass the UTF16 string right through.
    str += String.fromCharCode(codeUnit);
  }

  return str;
}

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 2 == 0, 'Pointer passed to stringToUTF16 must be aligned to two bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length * 2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr) >> 1)] = codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr) >> 1)] = 0;
  return outPtr - startPtr;
}

function lengthBytesUTF16(str) {
  return str.length * 2;
}

function UTF32ToString(ptr, maxBytesToRead) {
  assert(ptr % 4 == 0, 'Pointer passed to UTF32ToString must be aligned to four bytes!');
  var i = 0;

  var str = '';
  // If maxBytesToRead is not passed explicitly, it will be undefined, and this
  // will always evaluate to true. This saves on code size.
  while (!(i >= maxBytesToRead / 4)) {
    var utf32 = HEAP32[(((ptr) + (i * 4)) >> 2)];
    if (utf32 == 0) break;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
  return str;
}

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 4 == 0, 'Pointer passed to stringToUTF32 must be aligned to four bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr) >> 2)] = codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr) >> 2)] = 0;
  return outPtr - startPtr;
}

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}
function __embind_register_std_wstring(rawType, charSize, name) {
  name = readLatin1String(name);
  registerType(rawType, {
    name: name,
    // The C++ BindingType turns the jsi string into the C++ string and back (wire.h), as it does for std::string.
    'fromWireType': function (value) {
      return value;
    },
    'toWireType': function (destructors, value) {
      if (!(typeof value == 'string')) {
        throwBindingError('Cannot pass non-string to C++ string type ' + name);
      }
      return value;
    },
    'argPackAdvance': 8n,
    'readValueFromPointer': simpleReadValueFromPointer,
    destructorFunction: function (ptr) { _free(ptr); },
  });
}

globalThis.__embind_register_std_wstring = __embind_register_std_wstring;

function HandleAllocator() {
  this.allocated = [undefined];
  this.freelist = [];
  this.get = function (id) {
    // console.log('HandleAllocator get', id);
    return this.allocated[Number(id)];
  };
  this.allocate = function (handle) {
    var id = this.freelist.pop() || this.allocated.length;
    // console.log('HandleAllocator allocate', id, JSON.stringify(handle));
    this.allocated[id] = handle;
    return BigInt(id);
  };
  this.free = function (id) {
    const id2 = Number(id);
    // console.log('HandleAllocator free', id);
    // Set the slot to `undefined` rather than using `delete` here since
    // apparently arrays with holes in them can be less efficient.
    if (typeof id2 === 'number' && isFinite(id2)) {
      this.allocated[id2] = undefined;
      this.freelist.push(id2);
    }
  };
}
var emval_handles = new HandleAllocator();;
function __emval_decref(handle) {
  // console.log('__emval_decref');
  if (handle >= emval_handles.reserved && 0 === --emval_handles.get(handle).refcount) {
    emval_handles.free(handle);
  }
  // console.log('__emval_decref2');
}
globalThis.__emval_decref = __emval_decref;



function count_emval_handles() {
  var count = 0;
  for (var i = emval_handles.reserved; i < emval_handles.allocated.length; ++i) {
    if (emval_handles.allocated[i] !== undefined) {
      ++count;
    }
  }
  return count;
}

function init_emval() {
  // reserve some special values. These never get de-allocated.
  // The HandleAllocator takes care of reserving zero.
  emval_handles.allocated.push(
    { value: undefined },
    { value: null },
    { value: true },
    { value: false },
  );
  emval_handles.reserved = emval_handles.allocated.length
  Module['count_emval_handles'] = count_emval_handles;
}
var Emval = {
  toValue: (handle) => {
    if (!handle || !emval_handles.get(handle)) {
      throwBindingError('Cannot use deleted val. handle = ' + handle);
    }
    return emval_handles.get(handle).value;
  }, toHandle: (value) => {
    // console.log('Emval toHandle', value);
    switch (value) {
      case undefined: return 1n;
      case null: return 2n;
      case true: return 3n;
      case false: return 4n;
      default: {
        const r = emval_handles.allocate({ refcount: 1, value: value });
        // console.log('Emval toHandle default: ', r);
        return r;
      }
    }
  }
};



function __embind_register_emval(rawType, name) {
  name = readLatin1String(name);
  registerType(rawType, {
    name: name,
    'fromWireType': function (handle) {
      // console.log('emval fromWireType1', registeredTypes[rawType], this.name, handle);
      var rv = Emval.toValue(handle);
      // console.log('emval fromWireType2', rv);
      __emval_decref(handle);
      // console.log('emval fromWireType 2');
      return rv;
    },
    'toWireType': function (destructors, value) {
      // console.log('emval toWireType');
      return Emval.toHandle(value);
    },
    'argPackAdvance': 8n,
    'readValueFromPointer': simpleReadValueFromPointer,
    destructorFunction: null, // This type does not need a destructor

    // TODO: do we need a deleteObject here?  write a test where
    // emval is passed into JS via an interface
  });
}

globalThis.__embind_register_emval = __embind_register_emval;

// crossbind JSON-value hooks (embind-rust serde_json::Value): handle-based on purpose - the
// emval string plumbing reads wasm-heap pointers, which the native runtime has none of.
function __crossbind_json_to_handle(text) {
  return Emval.toHandle(JSON.parse(text));
}
globalThis.__crossbind_json_to_handle = __crossbind_json_to_handle;

function __crossbind_handle_to_json(handle) {
  const s = JSON.stringify(Emval.toValue(handle));
  __emval_decref(handle);
  return s === undefined ? 'null' : s;
}
globalThis.__crossbind_handle_to_json = __crossbind_handle_to_json;

// crossbind live-value hooks (embind-rust JsValue/JsFunction): handle-based like the JSON pair;
// strings travel as jsi strings, handles as the table's BigInts.
function __crossbind_v_get(h, key) {
  return Emval.toHandle(Emval.toValue(h)[key]);
}
globalThis.__crossbind_v_get = __crossbind_v_get;

function __crossbind_v_set(h, key, v) {
  Emval.toValue(h)[key] = Emval.toValue(v);
}
globalThis.__crossbind_v_set = __crossbind_v_set;

function __crossbind_v_from_num(v) {
  return Emval.toHandle(v);
}
globalThis.__crossbind_v_from_num = __crossbind_v_from_num;

function __crossbind_v_from_bool(v) {
  return Emval.toHandle(!!v);
}
globalThis.__crossbind_v_from_bool = __crossbind_v_from_bool;

function __crossbind_v_from_str(s) {
  return Emval.toHandle(s);
}
globalThis.__crossbind_v_from_str = __crossbind_v_from_str;

function __crossbind_v_kind(h) {
  const v = Emval.toValue(h);
  if (v === null || v === undefined) return 0;
  const t = typeof v;
  if (t === 'boolean') return 1;
  if (t === 'number') return 2;
  if (t === 'string') return 3;
  if (t === 'function') return 4;
  return 5;
}
globalThis.__crossbind_v_kind = __crossbind_v_kind;

function __crossbind_v_as_num(h) {
  return Number(Emval.toValue(h));
}
globalThis.__crossbind_v_as_num = __crossbind_v_as_num;

function __crossbind_v_as_bool(h) {
  return Emval.toValue(h) ? 1 : 0;
}
globalThis.__crossbind_v_as_bool = __crossbind_v_as_bool;

function __crossbind_v_as_str(h) {
  return String(Emval.toValue(h));
}
globalThis.__crossbind_v_as_str = __crossbind_v_as_str;

function __crossbind_v_call(f, args) {
  const fn = Emval.toValue(f);
  return Emval.toHandle(fn(...args.map((a) => Emval.toValue(a))));
}
globalThis.__crossbind_v_call = __crossbind_v_call;

function __embind_register_memory_view(rawType, dataTypeIndex, name) {
  var typeMapping = [
    Int8Array,
    Uint8Array,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
  ];

  var TA = typeMapping[dataTypeIndex];

  function decodeMemoryView(handle) {
    handle = handle >>> 2;
    var heap = HEAPU32;
    var size = heap[handle]; // in elements
    var data = heap[handle + 1]; // byte offset into emscripten heap
    return new TA(heap.buffer, data, size);
  }

  name = readLatin1String(name);
  registerType(rawType, {
    name: name,
    'fromWireType': decodeMemoryView,
    'argPackAdvance': 8n,
    'readValueFromPointer': decodeMemoryView,
  }, {
    ignoreDuplicateRegistrations: true,
  });
}
globalThis.__embind_register_memory_view = __embind_register_memory_view;

function runDestructors(destructors) {
  while (destructors.length) {
    var ptr = destructors.pop();
    var del = destructors.pop();
    del(ptr);
  }
}


function newFunc(constructor, argumentList) {
  if (!(constructor instanceof Function)) {
    throw new TypeError(`new_ called with constructor type ${typeof (constructor)} which is not a function`);
  }
  /*
   * Previously, the following line was just:
   *   function dummy() {};
   * Unfortunately, Chrome was preserving 'dummy' as the object's name, even
   * though at creation, the 'dummy' has the correct constructor name.  Thus,
   * objects created with IMVU.new would show up in the debugger as 'dummy',
   * which isn't very helpful.  Using IMVU.createNamedFunction addresses the
   * issue.  Doublely-unfortunately, there's no way to write a test for this
   * behavior.  -NRD 2013.02.22
   */
  var dummy = createNamedFunction(constructor.name || 'unknownFunctionName', function () { });
  dummy.prototype = constructor.prototype;
  var obj = new dummy;

  var r = constructor.apply(obj, argumentList);
  return (r instanceof Object) ? r : obj;
}
function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc, /** boolean= */ isAsync) {
  // console.log('craftInvokerFunction', humanName, argTypes);
  // humanName: a human-readable string name for the function to be generated.
  // argTypes: An array that contains the embind type objects for all types in the function signature.
  //    argTypes[0] is the type object for the function return value.
  //    argTypes[1] is the type object for function this object/class type, or null if not crafting an invoker for a class method.
  //    argTypes[2...] are the actual function parameters.
  // classType: The embind type object for the class to be bound, or null if this is not a method of a class.
  // cppInvokerFunc: JS Function object to the C++-side function that interops into C++ code.
  // cppTargetFunc: Function pointer (an integer to FUNCTION_TABLE) to the target C++ function the cppInvokerFunc will end up calling.
  // isAsync: Optional. If true, returns an async function. Async bindings are only supported with JSPI.
  var argCount = argTypes.length;

  if (argCount < 2) {
    throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
  }

  assert(!isAsync, 'Async bindings are only supported with JSPI.');

  var isClassMethodFunc = (argTypes[1] !== null && classType !== null);

  // Free functions with signature "void function()" do not need an invoker that marshalls between wire types.
  // TODO: This omits argument count check - enable only at -O3 or similar.
  //    if (ENABLE_UNSAFE_OPTS && argCount == 2 && argTypes[0].name == "void" && !isClassMethodFunc) {
  //       return FUNCTION_TABLE[fn];
  //    }

  // Determine if we need to use a dynamic stack to store the destructors for the function parameters.
  // TODO: Remove this completely once all function invokers are being dynamically generated.
  var needsDestructorStack = false;

  for (var i = 1; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here.
    if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) { // The type does not define a destructor function - must use dynamic stack
      needsDestructorStack = true;
      break;
    }
  }

  var returns = (argTypes[0].name !== "void");

  var argsList = "";
  var argsListWired = "";
  for (var i = 0; i < argCount - 2; ++i) {
    argsList += (i !== 0 ? ", " : "") + "arg" + i;
    argsListWired += (i !== 0 ? ", " : "") + "arg" + i + "Wired";
  }

  var invokerFnBody =
    "return function " + makeLegalFunctionName(humanName) + "(" + argsList + ") {\n" +
    "if (arguments.length !== " + (argCount - 2) + ") {\n" +
    "throwBindingError('function " + humanName + " called with ' + arguments.length + ' arguments, expected " + (argCount - 2) + " args!');\n" +
    "}\n";

  if (needsDestructorStack) {
    invokerFnBody += "var destructors = [];\n";
  }

  var dtorStack = needsDestructorStack ? "destructors" : "null";
  var args1 = ["throwBindingError", "invoker", "fn", "runDestructors", "retType", "classParam"];
  var args2 = [throwBindingError, cppInvokerFunc, cppTargetFunc, runDestructors, argTypes[0], argTypes[1]];

  if (isClassMethodFunc) {
    invokerFnBody += "var thisWired = classParam.toWireType(" + dtorStack + ", this);\n";
  }

  for (var i = 0; i < argCount - 2; ++i) {
    invokerFnBody += "var arg" + i + "Wired = argType" + i + ".toWireType(" + dtorStack + ", arg" + i + "); // " + argTypes[i + 2].name + "\n";
    args1.push("argType" + i);
    args2.push(argTypes[i + 2]);
  }

  if (isClassMethodFunc) {
    argsListWired = "thisWired" + (argsListWired.length > 0 ? ", " : "") + argsListWired;
  }

  invokerFnBody +=
    (returns || isAsync ? "var rv = " : "") + "invoker(fn" + (argsListWired.length > 0 ? ", " : "") + argsListWired + ");\n";

  if (needsDestructorStack) {
    invokerFnBody += "runDestructors(destructors);\n";
  } else {
    for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here. Also skip class type if not a method.
      var paramName = (i === 1 ? "thisWired" : ("arg" + (i - 2) + "Wired"));
      if (argTypes[i].destructorFunction !== null) {
        invokerFnBody += paramName + "_dtor(" + paramName + "); // " + argTypes[i].name + "\n";
        args1.push(paramName + "_dtor");
        args2.push(argTypes[i].destructorFunction);
      }
    }
  }

  if (returns) {
    invokerFnBody += "var ret = retType.fromWireType(rv);\n" +
      "return ret;\n";
  } else {
  }

  invokerFnBody += "}\n";

  args1.push(invokerFnBody);
  //console.log('newFunc 1', args1);
  //console.log('newFunc 2', args2);

  return newFunc(Function, args1).apply(null, args2);
  /* return (...az) => {
    console.log('craftInvokerFunction2', humanName, az);
    const y = newFunc(Function, args1).apply(null, args2);
    const k = y(...az);
    console.log('craftInvokerFunction21', humanName, k, az);
    return k;
  } */
}

function ensureOverloadTable(proto, methodName, humanName) {
  if (undefined === proto[methodName].overloadTable) {
    var prevFunc = proto[methodName];
    // Inject an overload resolver function that routes to the appropriate overload based on the number of arguments.
    proto[methodName] = function () {
      // TODO This check can be removed in -O3 level "unsafe" optimizations.
      if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
        throwBindingError(`Function '${humanName}' called with an invalid number of arguments (${arguments.length}) - expects one of (${proto[methodName].overloadTable})!`);
      }
      return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
    };
    // Move the previous function into the overload table.
    proto[methodName].overloadTable = [];
    proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
  }
}

/** @param {number=} numArguments */
function exposePublicSymbol(name, value, numArguments) {
  if (Module.hasOwnProperty(name)) {
    if (undefined === numArguments || (undefined !== Module[name].overloadTable && undefined !== Module[name].overloadTable[numArguments])) {
      throwBindingError(`Cannot register public name '${name}' twice`);
    }

    // We are exposing a function with the same name as an existing function. Create an overload table and a function selector
    // that routes between the two.
    ensureOverloadTable(Module, name, name);
    if (Module.hasOwnProperty(numArguments)) {
      throwBindingError(`Cannot register multiple overloads of a function with the same number of arguments (${numArguments})!`);
    }
    // Add the new function into the overload table.
    Module[name].overloadTable[numArguments] = value;
  }
  else {
    Module[name] = value;
    if (undefined !== numArguments) {
      Module[name].numArguments = numArguments;
    }
  }
}

function heap32VectorToArray(count, firstElement) {
  return firstElement;
  /* var array = [];
  for (var i = 0; i < count; i++) {
      // TODO(https://github.com/emscripten-core/emscripten/issues/17310):
      // Find a way to hoist the `>> 2` or `>> 3` out of this loop.
      array.push(Number(HEAPU64[(((firstElement)+(i * 8))>>3)]));
  }
  return array; */
}


/** @param {number=} numArguments */
function replacePublicSymbol(name, value, numArguments) {
  if (!Module.hasOwnProperty(name)) {
    throwInternalError('Replacing nonexistant public symbol');
  }
  // If there's an overload table for this symbol, replace the symbol in the overload table instead.
  if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
    Module[name].overloadTable[numArguments] = value;
  }
  else {
    Module[name] = value;
    Module[name].argCount = numArguments;
  }
}



function getDynCaller(signature, rawFunction, slice) {
  return (...args) => {
    //console.log('getDynCallerReturn', signature, rawFunction, args.length, ...args);
    if (slice) {
      args = args.slice(1);
    }
    return rawFunction(...args);
  };
}

function getWasmTableEntry(rawFunction) { return (a, b, c) => { console.log('getWasmTableEntry', rawFunction, a, b, c); }; }

function embind__requireFunction(signature, rawFunction, slice = false) {
  signature = readLatin1String(signature);

  function makeDynCaller() {
    if (true) {
      return getDynCaller(signature, rawFunction, slice);
    }
    return getWasmTableEntry(rawFunction);
  }

  var fp = makeDynCaller();
  if (typeof fp != "function") {
    throwBindingError(`unknown function pointer with signature ${signature}: ${rawFunction}`);
  }
  return fp;
}



var UnboundTypeError = undefined;


function ___getTypeName() { }

function getTypeName(type) {
  var ptr = ___getTypeName(type);
  var rv = readLatin1String(ptr);
  _free(ptr);
  return rv;
}
function throwUnboundTypeError(message, types) {
  var unboundTypes = [];
  var seen = {};
  function visit(type) {
    if (seen[type]) {
      return;
    }
    if (registeredTypes[type]) {
      return;
    }
    if (typeDependencies[type]) {
      typeDependencies[type].forEach(visit);
      return;
    }
    unboundTypes.push(type);
    seen[type] = true;
  }
  types.forEach(visit);

  throw new UnboundTypeError(message + ': ' + unboundTypes.map(getTypeName).join([', ']));
}

function __embind_register_function(name, argCount, rawArgTypesAddr, signature, rawInvoker, fn, isAsync) {
  // const argCount = Number(argCount);
  // console.log('function', name, argCount, rawArgTypesAddr, signature, rawInvoker, fn, isAsync);
  var argTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
  name = readLatin1String(name);
  // console.log('a1');
  rawInvoker = embind__requireFunction(signature, rawInvoker, true);
  // console.log('a2');
  exposePublicSymbol(name, function () {
    throwUnboundTypeError(`Cannot call ${name} due to unbound types`, argTypes);
  }, argCount - 1);
  // console.log('a3');
  whenDependentTypesAreResolved([], argTypes, function (argTypes) {
    // console.log('a4', argTypes);
    var invokerArgsArray = [argTypes[0] /* return value */, null /* no class 'this'*/].concat(argTypes.slice(1) /* actual params */);
    // console.log('a5');
    replacePublicSymbol(name, craftInvokerFunction(name, invokerArgsArray, null /* no class 'this'*/, rawInvoker, fn, isAsync), argCount - 1);
    // console.log('a6');
    return [];
  });
  // console.log('a7');
}

globalThis.__embind_register_function = __embind_register_function;

var tupleRegistrations = {};


function __embind_register_value_array(
  rawType,
  name,
  constructorSignature,
  rawConstructor,
  destructorSignature,
  rawDestructor
) {
  tupleRegistrations[rawType] = {
    name: readLatin1String(name),
    rawConstructor: embind__requireFunction(constructorSignature, rawConstructor),
    rawDestructor: embind__requireFunction(destructorSignature, rawDestructor),
    elements: [],
  };
}

globalThis.__embind_register_value_array = __embind_register_value_array;

function __embind_register_value_array_element(
  rawTupleType,
  getterReturnType,
  getterSignature,
  getter,
  getterContext,
  setterArgumentType,
  setterSignature,
  setter,
  setterContext
) {
  tupleRegistrations[rawTupleType].elements.push({
    getterReturnType: getterReturnType,
    getter: embind__requireFunction(getterSignature, getter),
    getterContext: getterContext,
    setterArgumentType: setterArgumentType,
    setter: embind__requireFunction(setterSignature, setter),
    setterContext: setterContext,
  });
}

globalThis.__embind_register_value_array_element = __embind_register_value_array_element;


function __embind_finalize_value_array(rawTupleType) {
  var reg = tupleRegistrations[rawTupleType];
  delete tupleRegistrations[rawTupleType];
  var elements = reg.elements;
  var elementsLength = elements.length;
  var elementTypes = elements.map(function (elt) { return elt.getterReturnType; }).
    concat(elements.map(function (elt) { return elt.setterArgumentType; }));

  var rawConstructor = reg.rawConstructor;
  var rawDestructor = reg.rawDestructor;

  whenDependentTypesAreResolved([rawTupleType], elementTypes, function (elementTypes) {
    elements.forEach((elt, i) => {
      var getterReturnType = elementTypes[i];
      var getter = elt.getter;
      var getterContext = elt.getterContext;
      var setterArgumentType = elementTypes[i + elementsLength];
      var setter = elt.setter;
      var setterContext = elt.setterContext;
      elt.read = (ptr) => {
        //console.log('elt.read ', ptr);
        const a = getter(getterContext, ptr);
        //console.log('elt.read2 ', ptr, a);
        //console.log('elt.read3 ', ptr, a, getterReturnType['fromWireType'](a));
        return getterReturnType['fromWireType'](a);
      };
      elt.write = (ptr, o) => {
        //console.log('elt.write ', ptr, o);
        var destructors = [];
        setter(setterContext, ptr, setterArgumentType['toWireType'](destructors, o));
        runDestructors(destructors);
      };
    });

    return [{
      name: reg.name,
      'fromWireType': function (ptr) {
        //console.log('__embind_finalize_value_array fromWireType', reg.name, ptr);
        var rv = new Array(elementsLength);
        for (var i = 0; i < elementsLength; ++i) {
          rv[i] = elements[i].read(ptr);
        }
        rawDestructor(ptr);
        return rv;
      },
      'toWireType': function (destructors, o) {
        if (elementsLength !== o.length) {
          throw new TypeError(`Incorrect number of tuple elements for ${reg.name}: expected=${elementsLength}, actual=${o.length}`);
        }
        var ptr = rawConstructor();
        //console.log('__embind_finalize_value_array toWireType', reg.name, ptr);
        for (var i = 0; i < elementsLength; ++i) {
          elements[i].write(ptr, o[i]);
        }
        if (destructors !== null) {
          destructors.push(rawDestructor, ptr);
        }
        return ptr;
      },
      'argPackAdvance': 8n,
      'readValueFromPointer': simpleReadValueFromPointer,
      destructorFunction: rawDestructor,
    }];
  });
}

globalThis.__embind_finalize_value_array = __embind_finalize_value_array;

var structRegistrations = {};


function __embind_register_value_object(
  rawType,
  name,
  constructorSignature,
  rawConstructor,
  destructorSignature,
  rawDestructor
) {
  structRegistrations[rawType] = {
    name: readLatin1String(name),
    rawConstructor: embind__requireFunction(constructorSignature, rawConstructor),
    rawDestructor: embind__requireFunction(destructorSignature, rawDestructor),
    fields: [],
  };
}

globalThis.__embind_register_value_object = __embind_register_value_object;


function __embind_register_value_object_field(
  structType,
  fieldName,
  getterReturnType,
  getterSignature,
  getter,
  getterContext,
  setterArgumentType,
  setterSignature,
  setter,
  setterContext
) {
  structRegistrations[structType].fields.push({
    fieldName: readLatin1String(fieldName),
    getterReturnType: getterReturnType,
    getter: embind__requireFunction(getterSignature, getter),
    getterContext: getterContext,
    setterArgumentType: setterArgumentType,
    setter: embind__requireFunction(setterSignature, setter),
    setterContext: setterContext,
  });
}

globalThis.__embind_register_value_object_field = __embind_register_value_object_field;


function __embind_finalize_value_object(structType) {
  var reg = structRegistrations[structType];
  delete structRegistrations[structType];

  var rawConstructor = reg.rawConstructor;
  var rawDestructor = reg.rawDestructor;
  var fieldRecords = reg.fields;
  var fieldTypes = fieldRecords.map((field) => field.getterReturnType).
    concat(fieldRecords.map((field) => field.setterArgumentType));
  whenDependentTypesAreResolved([structType], fieldTypes, (fieldTypes) => {
    var fields = {};
    fieldRecords.forEach((field, i) => {
      var fieldName = field.fieldName;
      var getterReturnType = fieldTypes[i];
      var getter = field.getter;
      var getterContext = field.getterContext;
      var setterArgumentType = fieldTypes[i + fieldRecords.length];
      var setter = field.setter;
      var setterContext = field.setterContext;
      fields[fieldName] = {
        read: (ptr) => {
          return getterReturnType['fromWireType'](
            getter(getterContext, ptr));
        },
        write: (ptr, o) => {
          var destructors = [];
          setter(setterContext, ptr, setterArgumentType['toWireType'](destructors, o));
          runDestructors(destructors);
        }
      };
    });

    return [{
      name: reg.name,
      'fromWireType': function (ptr) {
        //console.log('fromWireType __embind_finalize_value_object');
        var rv = {};
        for (var i in fields) {
          rv[i] = fields[i].read(ptr);
        }
        rawDestructor(ptr);
        return rv;
      },
      'toWireType': function (destructors, o) {
        //console.log('toWireType __embind_finalize_value_object');
        // todo: Here we have an opportunity for -O3 level "unsafe" optimizations:
        // assume all fields are present without checking.
        for (var fieldName in fields) {
          if (!(fieldName in o)) {
            throw new TypeError(`Missing field: "${fieldName}"`);
          }
        }
        var ptr = rawConstructor();
        for (fieldName in fields) {
          fields[fieldName].write(ptr, o[fieldName]);
        }
        if (destructors !== null) {
          destructors.push(rawDestructor, ptr);
        }
        return ptr;
      },
      'argPackAdvance': 8n,
      'readValueFromPointer': simpleReadValueFromPointer,
      destructorFunction: rawDestructor,
    }];
  });
}

globalThis.__embind_finalize_value_object = __embind_finalize_value_object;


function ClassHandle_isAliasOf(other) {
  // console.log('ClassHandle_isAliasOf');
  if (!(this instanceof ClassHandle)) {
    return false;
  }
  if (!(other instanceof ClassHandle)) {
    return false;
  }

  var leftClass = this.$$.ptrType.registeredClass;
  var left = this.$$.ptr;
  var rightClass = other.$$.ptrType.registeredClass;
  var right = other.$$.ptr;

  while (leftClass.baseClass) {
    left = leftClass.upcast(left);
    leftClass = leftClass.baseClass;
  }

  while (rightClass.baseClass) {
    right = rightClass.upcast(right);
    rightClass = rightClass.baseClass;
  }

  return leftClass === rightClass && left === right;
}

function shallowCopyInternalPointer(o) {
  return {
    count: o.count,
    deleteScheduled: o.deleteScheduled,
    preservePointerOnDelete: o.preservePointerOnDelete,
    ptr: o.ptr,
    ptrType: o.ptrType,
    smartPtr: o.smartPtr,
    smartPtrType: o.smartPtrType,
  };
}

function throwInstanceAlreadyDeleted(obj) {
  function getInstanceTypeName(handle) {
    return handle.$$.ptrType.registeredClass.name;
  }
  throwBindingError(getInstanceTypeName(obj) + ' instance already deleted');
}

var finalizationRegistry = false;

function detachFinalizer(handle) { }

function runDestructor($$) {
  if ($$.smartPtr) {
    $$.smartPtrType.rawDestructor($$.smartPtr);
  } else {
    $$.ptrType.registeredClass.rawDestructor($$.ptr);
  }
}
function releaseClassHandle($$) {
  $$.count.value -= 1;
  var toDelete = 0 === $$.count.value;
  if (toDelete) {
    runDestructor($$);
  }
}

function downcastPointer(ptr, ptrClass, desiredClass) {
  if (ptrClass === desiredClass) {
    return ptr;
  }
  if (undefined === desiredClass.baseClass) {
    return null; // no conversion
  }

  var rv = downcastPointer(ptr, ptrClass, desiredClass.baseClass);
  if (rv === null) {
    return null;
  }
  return desiredClass.downcast(rv);
}

var registeredPointers = {};

function getInheritedInstanceCount() {
  return Object.keys(registeredInstances).length;
}

function getLiveInheritedInstances() {
  var rv = [];
  for (var k in registeredInstances) {
    if (registeredInstances.hasOwnProperty(k)) {
      rv.push(registeredInstances[k]);
    }
  }
  return rv;
}

var deletionQueue = [];
function flushPendingDeletes() {
  while (deletionQueue.length) {
    var obj = deletionQueue.pop();
    obj.$$.deleteScheduled = false;
    obj['delete']();
  }
}

var delayFunction = undefined;


function setDelayFunction(fn) {
  delayFunction = fn;
  if (deletionQueue.length && delayFunction) {
    delayFunction(flushPendingDeletes);
  }
}
function init_embind() {
  Module['getInheritedInstanceCount'] = getInheritedInstanceCount;
  Module['getLiveInheritedInstances'] = getLiveInheritedInstances;
  Module['flushPendingDeletes'] = flushPendingDeletes;
  Module['setDelayFunction'] = setDelayFunction;
}
var registeredInstances = {};

function getBasestPointer(class_, ptr) {
  // console.log('getBasestPointer');
  if (ptr === undefined) {
    throwBindingError('ptr should not be undefined');
  }
  while (class_.baseClass) {
    ptr = class_.upcast(ptr);
    class_ = class_.baseClass;
  }
  return ptr;
}
function getInheritedInstance(class_, ptr) {
  ptr = getBasestPointer(class_, ptr);
  return registeredInstances[ptr];
}


function makeClassHandle(prototype, record) {
  //console.log('makeClassHandle', prototype, record);
  if (!record.ptrType || !record.ptr) {
    throwInternalError('makeClassHandle requires ptr and ptrType');
  }
  var hasSmartPtrType = !!record.smartPtrType;
  var hasSmartPtr = !!record.smartPtr;
  if (hasSmartPtrType !== hasSmartPtr) {
    throwInternalError('Both smartPtrType and smartPtr must be specified');
  }
  record.count = { value: 1 };
  return attachFinalizer(Object.create(prototype, {
    $$: {
      value: record,
    },
  }));
}

var MAX_INT53 = 9007199254740992;

var MIN_INT53 = -9007199254740992;
function bigintToI53Checked(num) {
  return (num < MIN_INT53 || num > MAX_INT53) ? NaN : Number(num);
}
function RegisteredPointer_fromWireType(ptr) {
  //console.log('RegisteredPointer_fromWireType', ptr);
  // ptr is a raw pointer (or a raw smartpointer)
  // ptr = bigintToI53Checked(ptr);
  // console.log('RegisteredPointer_fromWireType 2', ptr);
  // assert(Number.isSafeInteger(ptr));

  // rawPointer is a maybe-null raw pointer
  var rawPointer = this.getPointee(ptr);
  //console.log('RegisteredPointer_fromWireType - rawPointer: ', rawPointer);

  if (!rawPointer) {
    this.destructor(ptr);
    return null;
  }

  var registeredInstance = getInheritedInstance(this.registeredClass, rawPointer);
  //console.log('RegisteredPointer_fromWireType - registeredInstance: ', registeredInstance);
  if (undefined !== registeredInstance) {
    // JS object has been neutered, time to repopulate it
    if (0 === registeredInstance.$$.count.value) {
      registeredInstance.$$.ptr = rawPointer;
      registeredInstance.$$.smartPtr = ptr;
      return registeredInstance['clone']();
    } else {
      // else, just increment reference count on existing object
      // it already has a reference to the smart pointer
      var rv = registeredInstance['clone']();
      this.destructor(ptr);
      return rv;
    }
  }

  function makeDefaultHandle() {
    if (this.isSmartPointer) {
      return makeClassHandle(this.registeredClass.instancePrototype, {
        ptrType: this.pointeeType,
        ptr: rawPointer,
        smartPtrType: this,
        smartPtr: ptr,
      });
    } else {
      return makeClassHandle(this.registeredClass.instancePrototype, {
        ptrType: this,
        ptr: ptr,
      });
    }
  }

  var actualType = this.registeredClass.getActualType(rawPointer);
  var registeredPointerRecord = registeredPointers[actualType];
  //console.log('RegisteredPointer_fromWireType - actualType: ', actualType);
  //console.log('RegisteredPointer_fromWireType - registeredPointerRecord: ', registeredPointerRecord);
  if (!registeredPointerRecord) {
    return makeDefaultHandle.call(this);
  }

  var toType;
  if (this.isConst) {
    toType = registeredPointerRecord.constPointerType;
  } else {
    toType = registeredPointerRecord.pointerType;
  }
  //console.log('RegisteredPointer_fromWireType - toType: ', toType, this.isConst);
  var dp = downcastPointer(
    rawPointer,
    this.registeredClass,
    toType.registeredClass);
  //console.log('RegisteredPointer_fromWireType - downcastPointer: ', dp);
  //console.log('RegisteredPointer_fromWireType - isSmartPointer: ', this.isSmartPointer);
  if (dp === null) {
    return makeDefaultHandle.call(this);
  }
  if (this.isSmartPointer) {
    return makeClassHandle(toType.registeredClass.instancePrototype, {
      ptrType: toType,
      ptr: dp,
      smartPtrType: this,
      smartPtr: ptr,
    });
  } else {
    return makeClassHandle(toType.registeredClass.instancePrototype, {
      ptrType: toType,
      ptr: dp,
    });
  }
}
function attachFinalizer(handle) {
  //console.log('attachFinalizer', handle);
  if ('undefined' === typeof FinalizationRegistry) {
    attachFinalizer = (handle) => handle;
    return handle;
  }
  // If the running environment has a FinalizationRegistry (see
  // https://github.com/tc39/proposal-weakrefs), then attach finalizers
  // for class handles.  We check for the presence of FinalizationRegistry
  // at run-time, not build-time.
  finalizationRegistry = new FinalizationRegistry((info) => {
    console.warn(info.leakWarning.stack.replace(/^Error: /, ''));
    releaseClassHandle(info.$$);
  });
  attachFinalizer = (handle) => {
    var $$ = handle.$$;
    var hasSmartPtr = !!$$.smartPtr;
    if (hasSmartPtr) {
      // We should not call the destructor on raw pointers in case other code expects the pointee to live
      var info = { $$: $$ };
      // Create a warning as an Error instance in advance so that we can store
      // the current stacktrace and point to it when / if a leak is detected.
      // This is more useful than the empty stacktrace of `FinalizationRegistry`
      // callback.
      var cls = $$.ptrType.registeredClass;
      info.leakWarning = new Error(`Embind found a leaked C++ instance ${cls.name} <${ptrToString($$.ptr)}>.\n` +
        "We'll free it automatically in this case, but this functionality is not reliable across various environments.\n" +
        "Make sure to invoke .delete() manually once you're done with the instance instead.\n" +
        "Originally allocated"); // `.stack` will add "at ..." after this sentence
      if ('captureStackTrace' in Error) {
        Error.captureStackTrace(info.leakWarning, RegisteredPointer_fromWireType);
      }
      finalizationRegistry.register(handle, info, handle);
    }
    return handle;
  };
  detachFinalizer = (handle) => finalizationRegistry.unregister(handle);
  return attachFinalizer(handle);
}
function ClassHandle_clone() {
  if (!this.$$.ptr) {
    throwInstanceAlreadyDeleted(this);
  }

  if (this.$$.preservePointerOnDelete) {
    this.$$.count.value += 1;
    return this;
  } else {
    var clone = attachFinalizer(Object.create(Object.getPrototypeOf(this), {
      $$: {
        value: shallowCopyInternalPointer(this.$$),
      }
    }));

    clone.$$.count.value += 1;
    clone.$$.deleteScheduled = false;
    return clone;
  }
}




function ClassHandle_delete() {
  if (!this.$$.ptr) {
    throwInstanceAlreadyDeleted(this);
  }

  if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
    throwBindingError('Object already scheduled for deletion');
  }

  detachFinalizer(this);
  releaseClassHandle(this.$$);

  if (!this.$$.preservePointerOnDelete) {
    this.$$.smartPtr = undefined;
    this.$$.ptr = undefined;
  }
}

function ClassHandle_isDeleted() {
  return !this.$$.ptr;
}



function ClassHandle_deleteLater() {
  if (!this.$$.ptr) {
    throwInstanceAlreadyDeleted(this);
  }
  if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
    throwBindingError('Object already scheduled for deletion');
  }
  deletionQueue.push(this);
  if (deletionQueue.length === 1 && delayFunction) {
    delayFunction(flushPendingDeletes);
  }
  this.$$.deleteScheduled = true;
  return this;
}
function init_ClassHandle() {
  ClassHandle.prototype['isAliasOf'] = ClassHandle_isAliasOf;
  ClassHandle.prototype['clone'] = ClassHandle_clone;
  ClassHandle.prototype['delete'] = ClassHandle_delete;
  ClassHandle.prototype['isDeleted'] = ClassHandle_isDeleted;
  ClassHandle.prototype['deleteLater'] = ClassHandle_deleteLater;
}
function ClassHandle() {
}






/** @constructor */
function RegisteredClass(name,
  constructor,
  instancePrototype,
  rawDestructor,
  baseClass,
  getActualType,
  upcast,
  downcast) {
  this.name = name;
  this.constructor = constructor;
  this.instancePrototype = instancePrototype;
  this.rawDestructor = rawDestructor;
  this.baseClass = baseClass;
  this.getActualType = getActualType;
  this.upcast = upcast;
  this.downcast = downcast;
  this.pureVirtualFunctions = [];
}


function upcastPointer(ptr, ptrClass, desiredClass) {
  // console.log('upcastPointer');
  while (ptrClass !== desiredClass) {
    if (!ptrClass.upcast) {
      throwBindingError(`Expected null or instance of ${desiredClass.name}, got an instance of ${ptrClass.name}`);
    }
    ptr = ptrClass.upcast(ptr);
    ptrClass = ptrClass.baseClass;
  }
  return ptr;
}
function constNoSmartPtrRawPointerToWireType(destructors, handle) {
  // console.log('constNoSmartPtrRawPointerToWireType');
  if (handle === null) {
    if (this.isReference) {
      throwBindingError('null is not a valid ' + this.name);
    }
    return 0;
  }

  if (!handle.$$) {
    throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
  }
  if (!handle.$$.ptr) {
    throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
  }
  var handleClass = handle.$$.ptrType.registeredClass;
  var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
  return ptr;
}


function genericPointerToWireType(destructors, handle) {
  // console.log('genericPointerToWireType');
  var ptr;
  if (handle === null) {
    if (this.isReference) {
      throwBindingError('null is not a valid ' + this.name);
    }

    if (this.isSmartPointer) {
      ptr = this.rawConstructor();
      if (destructors !== null) {
        destructors.push(this.rawDestructor, ptr);
      }
      return ptr;
    } else {
      return 0;
    }
  }

  if (!handle.$$) {
    throwBindingError(`Cannot pass "${embindRepr(handle)}" as a ${this.name}`);
  }
  if (!handle.$$.ptr) {
    throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
  }
  if (!this.isConst && handle.$$.ptrType.isConst) {
    throwBindingError(`Cannot convert argument of type ${(handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name)} to parameter type ${this.name}`);
  }
  var handleClass = handle.$$.ptrType.registeredClass;
  ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);

  if (this.isSmartPointer) {
    // TODO: this is not strictly true
    // We could support BY_EMVAL conversions from raw pointers to smart pointers
    // because the smart pointer can hold a reference to the handle
    if (undefined === handle.$$.smartPtr) {
      throwBindingError('Passing raw pointer to smart pointer is illegal');
    }

    switch (this.sharingPolicy) {
      case 0: // NONE
      case 0n:
        // no upcasting
        if (handle.$$.smartPtrType === this) {
          ptr = handle.$$.smartPtr;
        } else {
          throwBindingError(`Cannot convert argument of type ${(handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name)} to parameter type ${this.name}`);
        }
        break;

      case 1: // INTRUSIVE
      case 1n:
        ptr = handle.$$.smartPtr;
        break;

      case 2: // BY_EMVAL
      case 2n:
        if (handle.$$.smartPtrType === this) {
          ptr = handle.$$.smartPtr;
        } else {
          var clonedHandle = handle['clone']();
          const tt = Emval.toHandle(function () {
            clonedHandle['delete']();
          });
          //console.log('this.rawShare(', ptr, tt);
          ptr = this.rawShare(
            ptr,
            tt
          );
          //console.log('this.rawShare = ', ptr);
          if (destructors !== null) {
            destructors.push(this.rawDestructor, ptr);
          }
        }
        break;

      default:
        throwBindingError('Unsupporting sharing policy');
    }
  }
  return ptr;
}


function nonConstNoSmartPtrRawPointerToWireType(destructors, handle) {
  // console.log('nonConstNoSmartPtrRawPointerToWireType');
  if (handle === null) {
    if (this.isReference) {
      throwBindingError('null is not a valid ' + this.name);
    }
    return 0;
  }
  //console.log('nonConstNoSmartPtrRawPointerToWireType 1', handle.$$, handle.smartPtr);

  if (!handle.$$) {
    throwBindingError(`Cannot pass  "${embindRepr(handle)}" as a ${this.name}`);
  }
  //console.log('nonConstNoSmartPtrRawPointerToWireType 2');
  if (!handle.$$.ptr) {
    throwBindingError(`Cannot pass deleted object as a pointer of type ${this.name}`);
  }
  //console.log('nonConstNoSmartPtrRawPointerToWireType 3');
  if (handle.$$.ptrType.isConst) {
    throwBindingError(`Cannot convert argument of type ${handle.$$.ptrType.name} to parameter type ${this.name}`);
  }
  //console.log('nonConstNoSmartPtrRawPointerToWireType 4');
  var handleClass = handle.$$.ptrType.registeredClass;
  var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
  //console.log('nonConstNoSmartPtrRawPointerToWireType 5');
  return ptr;
}


function RegisteredPointer_getPointee(ptr) {
  //console.log('RegisteredPointer_getPointee', ptr, this.rawGetPointee);
  if (this.rawGetPointee) {
    ptr = this.rawGetPointee(ptr);
  }
  return ptr;
}

function RegisteredPointer_destructor(ptr) {
  if (this.rawDestructor) {
    this.rawDestructor(ptr);
  }
}

function RegisteredPointer_deleteObject(handle) {
  if (handle !== null) {
    handle['delete']();
  }
}

function init_RegisteredPointer() {
  RegisteredPointer.prototype.getPointee = RegisteredPointer_getPointee;
  RegisteredPointer.prototype.destructor = RegisteredPointer_destructor;
  RegisteredPointer.prototype['argPackAdvance'] = 8n;
  RegisteredPointer.prototype['readValueFromPointer'] = simpleReadValueFromPointer64;
  RegisteredPointer.prototype['deleteObject'] = RegisteredPointer_deleteObject;
  RegisteredPointer.prototype['fromWireType'] = RegisteredPointer_fromWireType;
}
/** @constructor
    @param {*=} pointeeType,
    @param {*=} sharingPolicy,
    @param {*=} rawGetPointee,
    @param {*=} rawConstructor,
    @param {*=} rawShare,
    @param {*=} rawDestructor,
     */
function RegisteredPointer(
  name,
  registeredClass,
  isReference,
  isConst,

  // smart pointer properties
  isSmartPointer,
  pointeeType,
  sharingPolicy,
  rawGetPointee,
  rawConstructor,
  rawShare,
  rawDestructor
) {
  this.name = name;
  this.registeredClass = registeredClass;
  this.isReference = isReference;
  this.isConst = isConst;

  // smart pointer properties
  this.isSmartPointer = isSmartPointer;
  this.pointeeType = pointeeType;
  this.sharingPolicy = sharingPolicy;
  this.rawGetPointee = rawGetPointee;
  this.rawConstructor = rawConstructor;
  this.rawShare = rawShare;
  this.rawDestructor = rawDestructor;

  if (!isSmartPointer && registeredClass.baseClass === undefined) {
    if (isConst) {
      this['toWireType'] = constNoSmartPtrRawPointerToWireType;
      this.destructorFunction = null;
    } else {
      this['toWireType'] = nonConstNoSmartPtrRawPointerToWireType;
      this.destructorFunction = null;
    }
  } else {
    this['toWireType'] = genericPointerToWireType;
    // Here we must leave this.destructorFunction undefined, since whether genericPointerToWireType returns
    // a pointer that needs to be freed up is runtime-dependent, and cannot be evaluated at registration time.
    // TODO: Create an alternative mechanism that allows removing the use of var destructors = []; array in
    //       craftInvokerFunction altogether.
  }
}




function __embind_register_class(rawType,
  rawPointerType,
  rawConstPointerType,
  baseClassRawType,
  getActualTypeSignature,
  getActualType,
  upcastSignature,
  upcast,
  downcastSignature,
  downcast,
  name,
  destructorSignature,
  rawDestructor) {
  /* console.log('__embind_register_class', rawType,
    rawPointerType,
    rawConstPointerType,
    baseClassRawType,
    getActualTypeSignature,
    getActualType,
    upcastSignature,
    upcast,
    downcastSignature,
    downcast,
    name,
    destructorSignature,
    rawDestructor); */
  name = readLatin1String(name);
  getActualType = embind__requireFunction(getActualTypeSignature, getActualType);
  if (upcast) {
    upcast = embind__requireFunction(upcastSignature, upcast);
    // upcast = (...a) => {console.log('----------------------------->', a); };
  }
  if (downcast) {
    downcast = embind__requireFunction(downcastSignature, downcast);
  }
  rawDestructor = embind__requireFunction(destructorSignature, rawDestructor);
  var legalFunctionName = makeLegalFunctionName(name);

  exposePublicSymbol(legalFunctionName, function () {
    // this code cannot run if baseClassRawType is zero
    throwUnboundTypeError(`Cannot construct ${name} due to unbound types`, [baseClassRawType]);
  });

  whenDependentTypesAreResolved(
    [rawType, rawPointerType, rawConstPointerType],
    baseClassRawType ? [baseClassRawType] : [],
    function (base) {
      base = base[0];

      var baseClass;
      var basePrototype;
      if (baseClassRawType) {
        baseClass = base.registeredClass;
        basePrototype = baseClass.instancePrototype;
      } else {
        basePrototype = ClassHandle.prototype;
      }
      //console.log('__embind_register_class -> ', name, baseClassRawType, baseClass, basePrototype, ClassHandle);

      var constructor = createNamedFunction(legalFunctionName, function () {
        if (Object.getPrototypeOf(this) !== instancePrototype) {
          throw new BindingError("Use 'new' to construct " + name);
        }
        if (undefined === registeredClass.constructor_body) {
          throw new BindingError(name + " has no accessible constructor");
        }
        var body = registeredClass.constructor_body[arguments.length];
        if (undefined === body) {
          throw new BindingError(`Tried to invoke ctor of ${name} with invalid number of parameters (${arguments.length}) - expected (${Object.keys(registeredClass.constructor_body).toString()}) parameters instead!`);
        }
        return body.apply(this, arguments);
      });

      var instancePrototype = Object.create(basePrototype, {
        constructor: { value: constructor },
      });

      //console.log('__embind_register_class -> instancePrototype: ', name, Object.keys(basePrototype), instancePrototype.constructor);

      constructor.prototype = instancePrototype;

      var registeredClass = new RegisteredClass(name,
        constructor,
        instancePrototype,
        rawDestructor,
        baseClass,
        getActualType,
        upcast,
        downcast);

      if (registeredClass.baseClass) {
        // Keep track of class hierarchy. Used to allow sub-classes to inherit class functions.
        if (registeredClass.baseClass.__derivedClasses === undefined) {
          registeredClass.baseClass.__derivedClasses = [];
        }

        registeredClass.baseClass.__derivedClasses.push(registeredClass);
      }

      var referenceConverter = new RegisteredPointer(name,
        registeredClass,
        true,
        false,
        false);

      var pointerConverter = new RegisteredPointer(name + '*',
        registeredClass,
        false,
        false,
        false);

      var constPointerConverter = new RegisteredPointer(name + ' const*',
        registeredClass,
        false,
        true,
        false);

      registeredPointers[rawType] = {
        pointerType: pointerConverter,
        constPointerType: constPointerConverter
      };

      replacePublicSymbol(legalFunctionName, constructor);

      return [referenceConverter, pointerConverter, constPointerConverter];
    }
  );
}

globalThis.__embind_register_class = __embind_register_class;





function __embind_register_class_constructor(
  rawClassType,
  argCount,
  rawArgTypesAddr,
  invokerSignature,
  invoker,
  rawConstructor
) {
  /* console.log('__embind_register_class_constructor', rawClassType,
    argCount,
    rawArgTypesAddr,
    invokerSignature,
    invoker,
    rawConstructor); */
  assert(argCount > 0);
  var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
  invoker = embind__requireFunction(invokerSignature, invoker, true);
  var args = [rawConstructor];
  var destructors = [];

  whenDependentTypesAreResolved([], [rawClassType], function (classType) {
    classType = classType[0];
    var humanName = 'constructor ' + classType.name;

    if (undefined === classType.registeredClass.constructor_body) {
      classType.registeredClass.constructor_body = [];
    }
    if (undefined !== classType.registeredClass.constructor_body[argCount - 1]) {
      throw new BindingError(`Cannot register multiple constructors with identical number of parameters (${argCount - 1}) for class '${classType.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);
    }
    classType.registeredClass.constructor_body[argCount - 1] = () => {
      throwUnboundTypeError(`Cannot construct ${classType.name} due to unbound types`, rawArgTypes);
    };

    whenDependentTypesAreResolved([], rawArgTypes, function (argTypes) {
      // Insert empty slot for context type (argTypes[1]).
      argTypes.splice(1, 0, null);
      classType.registeredClass.constructor_body[argCount - 1] = craftInvokerFunction(humanName, argTypes, null, invoker, rawConstructor);
      return [];
    });
    return [];
  });
}

globalThis.__embind_register_class_constructor = __embind_register_class_constructor;





function __embind_register_class_function(rawClassType,
  methodName,
  argCount,
  rawArgTypesAddr, // [ReturnType, ThisType, Args...]
  invokerSignature,
  rawInvoker,
  context,
  isPureVirtual,
  isAsync) {
  // console.log('__embind_register_class_function', methodName, argCount);
  var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
  methodName = readLatin1String(methodName);
  rawInvoker = embind__requireFunction(invokerSignature, rawInvoker, true);

  whenDependentTypesAreResolved([], [rawClassType], function (classType) {
    //console.log(methodName, argCount);
    classType = classType[0];
    var humanName = classType.name + '.' + methodName;

    if (methodName.startsWith("@@")) {
      methodName = Symbol[methodName.substring(2)];
    }

    if (isPureVirtual) {
      classType.registeredClass.pureVirtualFunctions.push(methodName);
    }

    function unboundTypesHandler() {
      //console.log(`Cannot call2 ${humanName} due to unbound types`, rawArgTypes, rawArgTypes.map(a => registeredTypes[a]));
      throwUnboundTypeError(`Cannot call2 ${humanName} due to unbound types`, rawArgTypes);
    }

    var proto = classType.registeredClass.instancePrototype;
    var method = proto[methodName];
    if (undefined === method || (undefined === method.overloadTable && method.className !== classType.name && method.argCount === argCount - 2)) {
      // This is the first overload to be registered, OR we are replacing a
      // function in the base class with a function in the derived class.
      unboundTypesHandler.argCount = argCount - 2;
      unboundTypesHandler.className = classType.name;
      proto[methodName] = unboundTypesHandler;
    } else {
      // There was an existing function with the same name registered. Set up
      // a function overload routing table.
      ensureOverloadTable(proto, methodName, humanName);
      proto[methodName].overloadTable[argCount - 2] = unboundTypesHandler;
    }

    whenDependentTypesAreResolved([], rawArgTypes, function (argTypes) {
      //console.log(methodName);
      var memberFunction = craftInvokerFunction(humanName, argTypes, classType, rawInvoker, context, isAsync);

      // Replace the initial unbound-handler-stub function with the appropriate member function, now that all types
      // are resolved. If multiple overloads are registered for this function, the function goes into an overload table.
      if (undefined === proto[methodName].overloadTable) {
        // Set argCount in case an overload is registered later
        memberFunction.argCount = argCount - 2;
        proto[methodName] = memberFunction;
      } else {
        proto[methodName].overloadTable[argCount - 2] = memberFunction;
      }

      return [];
    });
    return [];
  });
}

globalThis.__embind_register_class_function = __embind_register_class_function;






function validateThis(this_, classType, humanName) {
  if (!(this_ instanceof Object)) {
    throwBindingError(humanName + ' with invalid "this": ' + this_);
  }
  if (!(this_ instanceof classType.registeredClass.constructor)) {
    throwBindingError(humanName + ' incompatible with "this" of type ' + this_.constructor.name);
  }
  if (!this_.$$.ptr) {
    throwBindingError(`cannot call emscripten binding method ${humanName} on deleted object`);
  }
  // console.log('validateThis');

  // todo: kill this
  return upcastPointer(this_.$$.ptr,
    this_.$$.ptrType.registeredClass,
    classType.registeredClass);
}
function __embind_register_class_property(classType,
  fieldName,
  getterReturnType,
  getterSignature,
  getter,
  getterContext,
  setterArgumentType,
  setterSignature,
  setter,
  setterContext) {
  fieldName = readLatin1String(fieldName);
  getter = embind__requireFunction(getterSignature, getter);

  whenDependentTypesAreResolved([], [classType], function (classType) {
    classType = classType[0];
    var humanName = classType.name + '.' + fieldName;
    var desc = {
      get: function () {
        throwUnboundTypeError(`Cannot access ${humanName} due to unbound types`, [getterReturnType, setterArgumentType]);
      },
      enumerable: true,
      configurable: true
    };
    if (setter && setterContext) {
      desc.set = () => {
        throwUnboundTypeError(`Cannot access ${humanName} due to unbound types`, [getterReturnType, setterArgumentType]);
      };
    } else {
      desc.set = (v) => {
        throwBindingError(humanName + ' is a read-only property');
      };
    }

    Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);

    whenDependentTypesAreResolved(
      [],
      (setter && setterContext ? [getterReturnType, setterArgumentType] : [getterReturnType]),
      function (types) {
        var getterReturnType = types[0];
        var desc = {
          get: function () {
            // console.log('get -> ', this.$$.ptr);
            var ptr = validateThis(this, classType, humanName + ' getter');
            return getterReturnType['fromWireType'](getter(getterContext, ptr));
          },
          enumerable: true
        };

        if (setter && setterContext) {
          setter = embind__requireFunction(setterSignature, setter);
          var setterArgumentType = types[1];
          desc.set = function (v) {
            // console.log('set -> ', this.$$.ptr);
            var ptr = validateThis(this, classType, humanName + ' setter');
            var destructors = [];
            setter(setterContext, ptr, setterArgumentType['toWireType'](destructors, v));
            runDestructors(destructors);
          };
        }

        // console.log('__embind_register_class_property', fieldName, desc);

        Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
        return [];
      });

    return [];
  });
}

globalThis.__embind_register_class_property = __embind_register_class_property;





function __embind_register_class_class_function(rawClassType,
  methodName,
  argCount,
  rawArgTypesAddr,
  invokerSignature,
  rawInvoker,
  fn,
  isAsync) {
  var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
  methodName = readLatin1String(methodName);
  rawInvoker = embind__requireFunction(invokerSignature, rawInvoker, true);
  whenDependentTypesAreResolved([], [rawClassType], function (classType) {
    classType = classType[0];
    var humanName = classType.name + '.' + methodName;

    function unboundTypesHandler() {
      throwUnboundTypeError(`Cannot call ${humanName} due to unbound types`, rawArgTypes);
    }

    if (methodName.startsWith("@@")) {
      methodName = Symbol[methodName.substring(2)];
    }

    var proto = classType.registeredClass.constructor;
    if (undefined === proto[methodName]) {
      // This is the first function to be registered with this name.
      unboundTypesHandler.argCount = argCount - 1;
      proto[methodName] = unboundTypesHandler;
    } else {
      // There was an existing function with the same name registered. Set up
      // a function overload routing table.
      ensureOverloadTable(proto, methodName, humanName);
      proto[methodName].overloadTable[argCount - 1] = unboundTypesHandler;
    }

    whenDependentTypesAreResolved([], rawArgTypes, function (argTypes) {
      // Replace the initial unbound-types-handler stub with the proper
      // function. If multiple overloads are registered, the function handlers
      // go into an overload table.
      var invokerArgsArray = [argTypes[0] /* return value */, null /* no class 'this'*/].concat(argTypes.slice(1) /* actual params */);
      var func = craftInvokerFunction(humanName, invokerArgsArray, null /* no class 'this'*/, rawInvoker, fn, isAsync);
      if (undefined === proto[methodName].overloadTable) {
        func.argCount = argCount - 1;
        proto[methodName] = func;
      } else {
        proto[methodName].overloadTable[argCount - 1] = func;
      }

      if (classType.registeredClass.__derivedClasses) {
        for (const derivedClass of classType.registeredClass.__derivedClasses) {
          if (!derivedClass.constructor.hasOwnProperty(methodName)) {
            // TODO: Add support for overloads
            derivedClass.constructor[methodName] = func;
          }
        }
      }

      return [];
    });
    return [];
  });
}

globalThis.__embind_register_class_class_function = __embind_register_class_class_function;





function __embind_register_class_class_property(rawClassType,
  fieldName,
  rawFieldType,
  rawFieldPtr,
  getterSignature,
  getter,
  setterSignature,
  setter) {
  fieldName = readLatin1String(fieldName);
  getter = embind__requireFunction(getterSignature, getter);

  whenDependentTypesAreResolved([], [rawClassType], function (classType) {
    classType = classType[0];
    var humanName = classType.name + '.' + fieldName;
    var desc = {
      get: function () {
        throwUnboundTypeError(`Cannot access ${humanName} due to unbound types`, [rawFieldType]);
      },
      enumerable: true,
      configurable: true
    };
    if (setter && setterSignature !== "") {
      desc.set = () => {
        throwUnboundTypeError(`Cannot access ${humanName} due to unbound types`, [rawFieldType]);
      };
    } else {
      desc.set = (v) => {
        throwBindingError(`${humanName} is a read-only property`);
      };
    }

    Object.defineProperty(classType.registeredClass.constructor, fieldName, desc);

    whenDependentTypesAreResolved([], [rawFieldType], function (fieldType) {
      fieldType = fieldType[0];
      var desc = {
        get: function () {
          return fieldType['fromWireType'](getter(rawFieldPtr));
        },
        enumerable: true
      };

      if (setter && setterSignature !== "") {
        setter = embind__requireFunction(setterSignature, setter);
        desc.set = (v) => {
          var destructors = [];
          setter(rawFieldPtr, fieldType['toWireType'](destructors, v));
          runDestructors(destructors);
        };
      }

      Object.defineProperty(classType.registeredClass.constructor, fieldName, desc);
      return [];
    });

    return [];
  });
}

globalThis.__embind_register_class_class_property = __embind_register_class_class_property;

var PureVirtualError = undefined;




function registerInheritedInstance(class_, ptr, instance) {
  ptr = getBasestPointer(class_, ptr);
  if (registeredInstances.hasOwnProperty(ptr)) {
    throwBindingError('Tried to register registered instance: ' + ptr);
  } else {
    registeredInstances[ptr] = instance;
  }
}



function requireRegisteredType(rawType, humanName) {
  //console.log('requireRegisteredType', rawType, humanName);
  var impl = registeredTypes[rawType];
  //console.log('requireRegisteredType value: ', impl);
  if (undefined === impl) {
    throwBindingError(humanName + " has unknown type " + getTypeName(rawType));
  }
  return impl;
}




function unregisterInheritedInstance(class_, ptr) {
  ptr = getBasestPointer(class_, ptr);
  if (registeredInstances.hasOwnProperty(ptr)) {
    delete registeredInstances[ptr];
  } else {
    throwBindingError('Tried to unregister unregistered instance: ' + ptr);
  }
}


function __embind_create_inheriting_constructor(constructorName, wrapperType, properties) {
  constructorName = readLatin1String(constructorName);
  wrapperType = requireRegisteredType(wrapperType, 'wrapper');
  properties = Emval.toValue(properties);

  var arraySlice = [].slice;

  var registeredClass = wrapperType.registeredClass;
  var wrapperPrototype = registeredClass.instancePrototype;
  var baseClass = registeredClass.baseClass;
  var baseClassPrototype = baseClass.instancePrototype;
  var baseConstructor = registeredClass.baseClass.constructor;
  var ctor = createNamedFunction(constructorName, function () {
    registeredClass.baseClass.pureVirtualFunctions.forEach(function (name) {
      if (this[name] === baseClassPrototype[name]) {
        throw new PureVirtualError(`Pure virtual function ${name} must be implemented in JavaScript`);
      }
    }.bind(this));

    Object.defineProperty(this, '__parent', {
      value: wrapperPrototype
    });
    this["__construct"].apply(this, arraySlice.call(arguments));
  });

  // It's a little nasty that we're modifying the wrapper prototype here.

  wrapperPrototype["__construct"] = function __construct() {
    if (this === wrapperPrototype) {
      throwBindingError("Pass correct 'this' to __construct");
    }

    var inner = baseConstructor["implement"].apply(
      undefined,
      [this].concat(arraySlice.call(arguments)));
    detachFinalizer(inner);
    var $$ = inner.$$;
    inner["notifyOnDestruction"]();
    $$.preservePointerOnDelete = true;
    Object.defineProperties(this, {
      $$: {
        value: $$
      }
    });
    attachFinalizer(this);
    registerInheritedInstance(registeredClass, $$.ptr, this);
  };

  wrapperPrototype["__destruct"] = function __destruct() {
    if (this === wrapperPrototype) {
      throwBindingError("Pass correct 'this' to __destruct");
    }

    detachFinalizer(this);
    unregisterInheritedInstance(registeredClass, this.$$.ptr);
  };

  ctor.prototype = Object.create(wrapperPrototype);
  for (var p in properties) {
    ctor.prototype[p] = properties[p];
  }
  return Emval.toHandle(ctor);
}

globalThis.__embind_create_inheriting_constructor = __embind_create_inheriting_constructor;


function __embind_register_smart_ptr(rawType,
  rawPointeeType,
  name,
  sharingPolicy,
  getPointeeSignature,
  rawGetPointee,
  constructorSignature,
  rawConstructor,
  shareSignature,
  rawShare,
  destructorSignature,
  rawDestructor) {
  /* console.log('__embind_register_smart_ptr', rawType,
    rawPointeeType,
    name,
    sharingPolicy,
    getPointeeSignature,
    rawGetPointee,
    constructorSignature,
    rawConstructor,
    shareSignature,
    rawShare,
    destructorSignature,
    rawDestructor); */
  name = readLatin1String(name);
  rawGetPointee = embind__requireFunction(getPointeeSignature, rawGetPointee);
  rawConstructor = embind__requireFunction(constructorSignature, rawConstructor);
  rawShare = embind__requireFunction(shareSignature, rawShare);
  rawDestructor = embind__requireFunction(destructorSignature, rawDestructor);

  whenDependentTypesAreResolved([rawType], [rawPointeeType], function (pointeeType) {
    pointeeType = pointeeType[0];

    var registeredPointer = new RegisteredPointer(name,
      pointeeType.registeredClass,
      false,
      false,
      // smart pointer properties
      true,
      pointeeType,
      sharingPolicy,
      rawGetPointee,
      rawConstructor,
      rawShare,
      rawDestructor);
    return [registeredPointer];
  });
}

globalThis.__embind_register_smart_ptr = __embind_register_smart_ptr;



function enumReadValueFromPointer(name, shift, signed) {
  //console.log('enumReadValueFromPointer');
  return (pointer) => {
    return this['fromWireType'](readFromMemoryUsingShift(pointer, signed, shift));
  }
}


function __embind_register_enum(rawType, name, size, isSigned) {
  var shift = getShiftFromSize(size);
  name = readLatin1String(name);

  function ctor() { }
  ctor.values = {};

  registerType(rawType, {
    name: name,
    constructor: ctor,
    'fromWireType': function (c) {
      //console.log('__embind_register_enum, fromWireType', ctor, c);
      return this.constructor.values[c];
    },
    'toWireType': function (destructors, c) {
      //console.log('__embind_register_enum, toWireType', ctor, c.value);
      return c.value;
    },
    'argPackAdvance': 8n,
    'readValueFromPointer': enumReadValueFromPointer(name, shift, isSigned),
    destructorFunction: null,
  });
  exposePublicSymbol(name, ctor);
}

globalThis.__embind_register_enum = __embind_register_enum;

function __embind_register_enum_value(rawEnumType, name, enumValue) {
  var enumType = requireRegisteredType(rawEnumType, 'enum');
  name = readLatin1String(name);

  var Enum = enumType.constructor;

  var Value = Object.create(enumType.constructor.prototype, {
    value: { value: enumValue },
    constructor: { value: createNamedFunction(enumType.name + '_' + name, function () { }) },
  });
  Enum.values[enumValue] = Value;
  Enum[name] = Value;
}
globalThis.__embind_register_enum_value = __embind_register_enum_value;

function __embind_register_constant(name, type, value) {
  name = readLatin1String(name);
  //console.log('-------------- const ---------', name, type, value);
  whenDependentTypesAreResolved([], [type], function (type) {
    type = type[0];
    //console.log('-------------- const ---------', name, type, value);
    Module[name] = type['fromWireType'](value);
    return [];
  });
}

globalThis.__embind_register_constant = __embind_register_constant;

var emval_symbols = {};

function __emval_register_symbol(address) {
  emval_symbols[address] = readLatin1String(address);
}
globalThis.__emval_register_symbol = __emval_register_symbol;

function __emval_incref(handle) {
  // console.log('__emval_incref');
  if (handle > 4) {
    emval_handles.get(handle).refcount += 1;
  }
}
globalThis.__emval_incref = __emval_incref;




function __emval_run_destructors(handle) {
  // console.log('__emval_run_destructors');
  var destructors = Emval.toValue(handle);
  runDestructors(destructors);
  __emval_decref(handle);
}
globalThis.__emval_run_destructors = __emval_run_destructors;


function __emval_new_array() {
  // console.log('__emval_new_array');
  return Emval.toHandle([]);
}
globalThis.__emval_new_array = __emval_new_array;

function __emval_new_array_from_memory_view(view) {
  // console.log('__emval_new_array_from_memory_view');
  view = Emval.toValue(view);
  // using for..loop is faster than Array.from
  var a = new Array(view.length);
  for (var i = 0; i < view.length; i++) a[i] = view[i];
  return Emval.toHandle(a);
}
globalThis.__emval_new_array_from_memory_view = __emval_new_array_from_memory_view;

function __emval_new_object() {
  // console.log('__emval_new_object');
  return Emval.toHandle({});
}
globalThis.__emval_new_object = __emval_new_object;


function getStringOrSymbol(address) {
  var symbol = emval_symbols[address];
  if (symbol === undefined) {
    return readLatin1String(address);
  }
  return symbol;
}

function __emval_new_cstring(v) {
  // console.log('__emval_new_cstring');
  return Emval.toHandle(getStringOrSymbol(v));
}
globalThis.__emval_new_cstring = __emval_new_cstring;


function __emval_new_u8string(v) {
  // console.log('__emval_new_u8string');
  return Emval.toHandle(UTF8ToString(v));
}
globalThis.__emval_new_u8string = __emval_new_u8string;

function __emval_new_u16string(v) {
  // console.log('__emval_new_u16string');
  return Emval.toHandle(UTF16ToString(v));
}
globalThis.__emval_new_u16string = __emval_new_u16string;

BigInt.prototype.toJSON = function () { return this.toString() }
function __emval_take_value(type, arg) {
  //console.log('__emval_take_value', JSON.stringify({type, arg}, null, 2));
  type = requireRegisteredType(type, '_emval_take_value');
  //console.log('************** 2:', JSON.stringify({type, arg}, null, 2));
  //console.log('************** 2.5:', type['readValueFromPointer']);
  var v = type['readValueFromPointer'](arg);
  //console.log('************** 3:', v);
  const f = Emval.toHandle(v);
  //console.log('************** 4:', f);
  return f;
}
globalThis.__emval_take_value = __emval_take_value;


function craftEmvalAllocator(argCount) {
  /*This function returns a new function that looks like this:
  function emval_allocator_3(constructor, argTypes, args) {
      var argType0 = requireRegisteredType(HEAP32[(argTypes >> 2)], "parameter 0");
      var arg0 = argType0['readValueFromPointer'](args);
      var argType1 = requireRegisteredType(HEAP32[(argTypes >> 2) + 1], "parameter 1");
      var arg1 = argType1['readValueFromPointer'](args + 8);
      var argType2 = requireRegisteredType(HEAP32[(argTypes >> 2) + 2], "parameter 2");
      var arg2 = argType2['readValueFromPointer'](args + 16);
      var obj = new constructor(arg0, arg1, arg2);
      return Emval.toHandle(obj);
  } */
  var argsList = "";
  for (var i = 0; i < argCount; ++i) {
    argsList += (i !== 0 ? ", " : "") + "arg" + i; // 'arg0, arg1, ..., argn'
  }

  var functionBody =
    "return function emval_allocator_" + argCount + "(constructor, argTypes, args) {\n";

  for (var i = 0; i < argCount; ++i) {
    functionBody +=
      "var argType" + i + " = requireRegisteredType(argTypes[" + i + "], 'parameter " + i + "');\n" +
      "var arg" + i + " = argType" + i + ".readValueFromPointer(args);\n" +
      "args += argType" + i + "['argPackAdvance'];\n";
  }
  functionBody +=
    "var obj = new constructor(" + argsList + ");\n" +
    "return valueToHandle(obj);\n" +
    "}\n";

  /*jshint evil:true*/
  return (new Function("requireRegisteredType", "Module", "valueToHandle", "readFromMemoryUsingShift", functionBody))(
    requireRegisteredType, Module, Emval.toHandle, readFromMemoryUsingShift);
}

var emval_newers = {};

function __emval_new(handle, argCount, argTypes, args) {
  argCount = Number(argCount);
  //console.log('__emval_new', handle, argCount, argTypes.length, argTypes, args);
  handle = Emval.toValue(handle);

  var newer = emval_newers[argCount];
  if (!newer) {
    newer = craftEmvalAllocator(argCount);
    emval_newers[argCount] = newer;
  }

  //console.log('__emval_new response2');
  const a = newer(handle, argTypes, args);;
  //console.log('__emval_new response: ', a);
  return a;
}
globalThis.__emval_new = __emval_new;


const globalIgnoreList = [
  'jsiArrayBuffer',
  'jsiArrayBuffer2',
  'jsiArrayBuffer3',
  'jsiArrayBuffer4',
  'window',
  'self',
  'DATA_VIEW',
  'Module',
  'nativeRuntimeScheduler',
];

function emval_get_global() {
  if (typeof globalThis == 'object') {
    const global = {};
    Object.keys(globalThis).filter(key => !key.startsWith('_') && !globalIgnoreList.includes(key)).forEach(key => {
      global[key] = globalThis[key];
    });

    return global;
  }
  return (function () {
    return Function;
  })()('return this')();
}
function __emval_get_global(name) {
  if (name === '') {
    return Emval.toHandle(emval_get_global());
  } else {
    //console.log(`1__emval_get_global(${name})`, globalThis[name]);
    name = getStringOrSymbol(name);
    return Emval.toHandle(globalThis[name]);
  }
}
globalThis.__emval_get_global = __emval_get_global;


function __emval_get_module_property(name) {
  // console.log('__emval_get_module_property');
  name = getStringOrSymbol(name);
  return Emval.toHandle(Module[name]);
}
globalThis.__emval_get_module_property = __emval_get_module_property;

function __emval_get_property(handle, key) {
  //console.log('__emval_get_property', handle, key);
  handle = Emval.toValue(handle);
  key = Emval.toValue(key);
  //console.log('__emval_get_property2', handle, key, handle[key]);
  return Emval.toHandle(handle[key]);
}
globalThis.__emval_get_property = __emval_get_property;

function __emval_set_property(handle, key, value) {
  // console.log('__emval_set_property');
  handle = Emval.toValue(handle);
  key = Emval.toValue(key);
  value = Emval.toValue(value);
  handle[key] = value;
}
globalThis.__emval_set_property = __emval_set_property;


function __emval_as(handle, returnType, destructorsRef) {
  //console.log('__emval_as');
  handle = Emval.toValue(handle);
  //console.log('__emval_as 2');
  returnType = requireRegisteredType(returnType, 'emval::as');
  //console.log('__emval_as 3');
  var destructors = [];
  var rd = Emval.toHandle(destructors);
  //console.log('__emval_as 4', Number(rd));
  writeToMemoryUsingShift(destructorsRef, false, 3, rd);
  const output = returnType['toWireType'](destructors, handle);
  //console.log('__emval_as 5', Number(output));
  return output;
}
globalThis.__emval_as = __emval_as;


function __emval_as_int64(handle, returnType) {
  // console.log('__emval_as_int64');
  handle = Emval.toValue(handle);
  returnType = requireRegisteredType(returnType, 'emval::as');
  return returnType['toWireType'](null, handle);
}
globalThis.__emval_as_int64 = __emval_as_int64;


function __emval_as_uint64(handle, returnType) {
  // console.log('__emval_as_uint64');
  handle = Emval.toValue(handle);
  returnType = requireRegisteredType(returnType, 'emval::as');
  return returnType['toWireType'](null, handle);
}
globalThis.__emval_as_uint64 = __emval_as_uint64;

function __emval_equals(first, second) {
  // console.log('__emval_equals');
  first = Emval.toValue(first);
  second = Emval.toValue(second);
  return first == second;
}
globalThis.__emval_equals = __emval_equals;

function __emval_strictly_equals(first, second) {
  // console.log('__emval_strictly_equals');
  first = Emval.toValue(first);
  second = Emval.toValue(second);
  return first === second;
}
globalThis.__emval_strictly_equals = __emval_strictly_equals;

function __emval_greater_than(first, second) {
  // console.log('__emval_greater_than');
  first = Emval.toValue(first);
  second = Emval.toValue(second);
  return first > second;
}
globalThis.__emval_greater_than = __emval_greater_than;

function __emval_less_than(first, second) {
  // console.log('__emval_less_than');
  first = Emval.toValue(first);
  second = Emval.toValue(second);
  return first < second;
}
globalThis.__emval_less_than = __emval_less_than;

function __emval_not(object) {
  // console.log('__emval_not');
  object = Emval.toValue(object);
  return !object;
}
globalThis.__emval_not = __emval_not;

function emval_lookupTypes(argCount, argTypes) {
  //console.log('emval_lookupTypes', argCount, argTypes);
  var a = new Array(argCount);
  for (var i = 0; i < argCount; ++i) {
    const memValue = argTypes[i];
    a[i] = requireRegisteredType(memValue, "parameter " + i);
  }
  return a;
}

function __emval_call(handle, argCount, argTypes, argv) {
  //console.log('__emval_call', handle, argCount, argTypes, argv);
  handle = Emval.toValue(handle);
  var types = emval_lookupTypes(argCount, argTypes);
  //console.log('ooooo', types);
  var args = new Array(argCount);
  for (var i = 0; i < argCount; ++i) {
    var type = types[i];
    args[i] = type['readValueFromPointer'](argv);
    //console.log(args[i]);
    argv += type['argPackAdvance'];
  }
  //console.log('ooooo3');
  var rv = handle.apply(undefined, args);
  //console.log('ooooo2');
  return Emval.toHandle(rv);
}
globalThis.__emval_call = __emval_call;

var emval_methodCallers = [];
function emval_addMethodCaller(caller) {
  var id = emval_methodCallers.length;
  emval_methodCallers.push(caller);
  return BigInt(id);
}



var emval_registeredMethods = [];

function __emval_get_method_caller(argCount, argTypes) {
  argCount = Number(argCount);
  //console.log('__emval_get_method_caller', argCount, argTypes);
  var types = emval_lookupTypes(argCount, argTypes);
  var retType = types[0];
  var signatureName = retType.name + "_$" + types.slice(1).map(function (t) { return t.name; }).join("_") + "$";
  var returnId = emval_registeredMethods[signatureName];
  if (returnId !== undefined) {
    return returnId;
  }

  var params = ["retType"];
  var args = [retType];

  var argsList = ""; // 'arg0, arg1, arg2, ... , argN'
  for (var i = 0; i < argCount - 1; ++i) {
    argsList += (i !== 0 ? ", " : "") + "arg" + i;
    params.push("argType" + i);
    args.push(types[1 + i]);
  }
  var functionName = makeLegalFunctionName("methodCaller_" + signatureName);
  var functionBody =
    "return function " + functionName + "(handle, name, destructors, args) {\n";
  var offset = 0n;
  for (var i = 0; i < argCount - 1; ++i) {
    functionBody +=
      "    var arg" + i + " = argType" + i + ".readValueFromPointer(args" + (offset ? ("+" + offset + "n") : "") + ");\n";
    offset += types[i + 1]['argPackAdvance'];
  }
  functionBody +=
    "    var rv = handle[name](" + argsList + ");\n";
  for (var i = 0; i < argCount - 1; ++i) {
    if (types[i + 1]['deleteObject']) {
      functionBody +=
        "    argType" + i + ".deleteObject(arg" + i + ");\n";
    }
  }
  if (!retType.isVoid) {
    functionBody +=
      "    return retType.toWireType(destructors, rv, true);\n";
  }
  functionBody +=
    "};\n";
  params.push(functionBody);
  var invokerFunction = newFunc(Function, params).apply(null, args);
  returnId = emval_addMethodCaller(invokerFunction);
  emval_registeredMethods[signatureName] = returnId;
  return returnId;
}
globalThis.__emval_get_method_caller = __emval_get_method_caller;

function emval_allocateDestructors(destructorsRef) {
  //console.log('emval_allocateDestructors');
  var destructors = [];
  writeToMemoryUsingShift(destructorsRef, false, 3, Emval.toHandle(destructors));
  //console.log('emval_allocateDestructors 2');
  return destructors;
}



function __emval_call_method(caller, handle, methodName, destructorsRef, args) {
  //console.log('__emval_call_method');
  caller = emval_methodCallers[caller];
  handle = Emval.toValue(handle);
  methodName = getStringOrSymbol(methodName);
  return caller(handle, methodName, emval_allocateDestructors(destructorsRef), args);
}
globalThis.__emval_call_method = __emval_call_method;




function __emval_call_void_method(caller, handle, methodName, args) {
  //console.log('__emval_call_void_method');
  caller = emval_methodCallers[caller];
  handle = Emval.toValue(handle);
  methodName = getStringOrSymbol(methodName);
  caller(handle, methodName, null, args);
}
globalThis.__emval_call_void_method = __emval_call_void_method;

function __emval_typeof(handle) {
  // console.log('__emval_typeof');
  handle = Emval.toValue(handle);
  return Emval.toHandle(typeof handle);
}
globalThis.__emval_typeof = __emval_typeof;

function __emval_instanceof(object, constructor) {
  // console.log('__emval_instanceof');
  object = Emval.toValue(object);
  constructor = Emval.toValue(constructor);
  return object instanceof constructor;
}
globalThis.__emval_instanceof = __emval_instanceof;

function __emval_is_number(handle) {
  // console.log('__emval_is_number');
  handle = Emval.toValue(handle);
  return typeof handle == 'number';
}
globalThis.__emval_is_number = __emval_is_number;

function __emval_is_string(handle) {
  // console.log('__emval_is_string');
  handle = Emval.toValue(handle);
  return typeof handle == 'string';
}
globalThis.__emval_is_string = __emval_is_string;

function __emval_in(item, object) {
  // console.log('__emval_in');
  item = Emval.toValue(item);
  object = Emval.toValue(object);
  return item in object;
}
globalThis.__emval_in = __emval_in;

function __emval_delete(object, property) {
  // console.log('__emval_delete');
  object = Emval.toValue(object);
  property = Emval.toValue(property);
  return delete object[property];
}
globalThis.__emval_delete = __emval_delete;

function __emval_throw(object) {
  // console.log('__emval_throw');
  object = Emval.toValue(object);
  throw object;
}
globalThis.__emval_throw = __emval_throw;

function _callRuntimeCallbacks(callbacks) {
  while (callbacks.length > 0) {
    // Pass the module as the first argument.
    callbacks.shift()(Module);
  }
}
embind_init_charCodes();
BindingError = Module['BindingError'] = extendError(Error, 'BindingError');;
InternalError = Module['InternalError'] = extendError(Error, 'InternalError');;
init_emval();;
UnboundTypeError = Module['UnboundTypeError'] = extendError(Error, 'UnboundTypeError');;
init_ClassHandle();
init_embind();;
init_RegisteredPointer();

PureVirtualError = Module['PureVirtualError'] = extendError(Error, 'PureVirtualError');;
// EMSCRIPTEN_END_FUNCS

// include: postamble.js
/**
 * @license
 * Copyright 2010 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

// === Auto-generated postamble setup entry stuff ===

var missingLibrarySymbols = [
  'callRuntimeCallbacks',
  'ExitStatus',
  'exitJS',
  'handleException',
  'reallyNegative',
  'unSign',
  'strLen',
  'reSign',
  'formatString',
  'intArrayFromString',
  'intArrayToString',
  'AsciiToString',
  'stringToAscii',
  'stringToNewUTF8',
  'stringToUTF8OnStack',
  'writeArrayToMemory',
  'writeI53ToI64',
  'writeI53ToI64Clamped',
  'writeI53ToI64Signaling',
  'writeI53ToU64Clamped',
  'writeI53ToU64Signaling',
  'readI53FromI64',
  'readI53FromU64',
  'convertI32PairToI53',
  'convertI32PairToI53Checked',
  'convertU32PairToI53'
];
missingLibrarySymbols.forEach(missingLibrarySymbol)

var unexportedSymbols = [
  'run',
  'addOnPreRun',
  'addOnInit',
  'addOnPreMain',
  'addOnExit',
  'addOnPostRun',
  'addRunDependency',
  'removeRunDependency',
  'FS_createFolder',
  'FS_createPath',
  'FS_createDataFile',
  'FS_createLazyFile',
  'FS_createLink',
  'FS_createDevice',
  'FS_unlink',
  'out',
  'err',
  'callMain',
  'abort',
  'keepRuntimeAlive',
  'wasmMemory',
  'stackAlloc',
  'stackSave',
  'stackRestore',
  'getTempRet0',
  'setTempRet0',
  'UTF8Decoder',
  'UTF8ArrayToString',
  'UTF8ToString',
  'stringToUTF8Array',
  'stringToUTF8',
  'lengthBytesUTF8',
  'UTF16Decoder',
  'UTF16ToString',
  'stringToUTF16',
  'lengthBytesUTF16',
  'UTF32ToString',
  'stringToUTF32',
  'lengthBytesUTF32',
  'MAX_INT53',
  'MIN_INT53',
  'bigintToI53Checked',
  'getDynCaller',
  'getWasmTableEntry',
  'HandleAllocator',
  'InternalError',
  'BindingError',
  'UnboundTypeError',
  'PureVirtualError',
  'init_embind',
  'throwInternalError',
  'throwBindingError',
  'throwUnboundTypeError',
  'ensureOverloadTable',
  'exposePublicSymbol',
  'replacePublicSymbol',
  'extendError',
  'createNamedFunction',
  'embindRepr',
  'registeredInstances',
  'getBasestPointer',
  'registerInheritedInstance',
  'unregisterInheritedInstance',
  'getInheritedInstance',
  'getInheritedInstanceCount',
  'getLiveInheritedInstances',
  'registeredTypes',
  'awaitingDependencies',
  'typeDependencies',
  'registeredPointers',
  'registerType',
  'whenDependentTypesAreResolved',
  'embind_charCodes',
  'embind_init_charCodes',
  'readLatin1String',
  'getTypeName',
  'heap32VectorToArray',
  'requireRegisteredType',
  'getShiftFromSize',
  'integerReadValueFromPointer',
  'enumReadValueFromPointer',
  'floatReadValueFromPointer',
  'simpleReadValueFromPointer',
  'runDestructors',
  'newFunc',
  'craftInvokerFunction',
  'embind__requireFunction',
  'tupleRegistrations',
  'structRegistrations',
  'genericPointerToWireType',
  'constNoSmartPtrRawPointerToWireType',
  'nonConstNoSmartPtrRawPointerToWireType',
  'init_RegisteredPointer',
  'RegisteredPointer',
  'RegisteredPointer_getPointee',
  'RegisteredPointer_destructor',
  'RegisteredPointer_deleteObject',
  'RegisteredPointer_fromWireType',
  'runDestructor',
  'releaseClassHandle',
  'finalizationRegistry',
  'detachFinalizer_deps',
  'detachFinalizer',
  'attachFinalizer',
  'makeClassHandle',
  'init_ClassHandle',
  'ClassHandle',
  'ClassHandle_isAliasOf',
  'throwInstanceAlreadyDeleted',
  'ClassHandle_clone',
  'ClassHandle_delete',
  'deletionQueue',
  'ClassHandle_isDeleted',
  'ClassHandle_deleteLater',
  'flushPendingDeletes',
  'delayFunction',
  'setDelayFunction',
  'RegisteredClass',
  'shallowCopyInternalPointer',
  'downcastPointer',
  'upcastPointer',
  'validateThis',
  'char_0',
  'char_9',
  'makeLegalFunctionName',
  'emval_handles',
  'emval_symbols',
  'init_emval',
  'count_emval_handles',
  'getStringOrSymbol',
  'Emval',
  'emval_newers',
  'craftEmvalAllocator',
  'emval_get_global',
  'emval_lookupTypes',
  'emval_allocateDestructors',
  'emval_methodCallers',
  'emval_addMethodCaller',
  'emval_registeredMethods',
];
unexportedSymbols.forEach(unexportedRuntimeSymbol);



var calledRun;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
};

function run(args = arguments_) {

  if (runDependencies > 0) {
    return;
  }

  preRun();

  // a preRun added a dependency, run will be called later
  if (runDependencies > 0) {
    return;
  }

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;
    Module['calledRun'] = true;

    if (ABORT) return;

    initRuntime();

    assert(!Module['_main'], 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');

    postRun();
  }

  {
    doRun();
  }
}

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var oldOut = out;
  var oldErr = err;
  var has = false;
  out = err = (x) => {
    has = true;
  }
  try { // it doesn't matter if it fails
  } catch (e) { }
  out = oldOut;
  err = oldErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the FAQ), or make sure to emit a newline when you printf etc.');
  }
}

run();

// end include: postamble.js
//FORWARDED_DATA:{"librarySymbols":["__embind_register_void","readLatin1String","embind_charCodes","embind_init_charCodes","registerType","awaitingDependencies","registeredTypes","typeDependencies","throwBindingError","BindingError","extendError","createNamedFunction","makeLegalFunctionName","char_0","char_9","whenDependentTypesAreResolved","throwInternalError","InternalError","__embind_register_bool","getShiftFromSize","__embind_register_integer","embindRepr","integerReadValueFromPointer","__embind_register_bigint","__embind_register_float","floatReadValueFromPointer","__embind_register_std_string","simpleReadValueFromPointer","stringToUTF8","stringToUTF8Array","lengthBytesUTF8","_malloc","_free","UTF8ToString","UTF8ArrayToString","UTF8Decoder","__embind_register_std_wstring","UTF16ToString","UTF16Decoder","stringToUTF16","lengthBytesUTF16","UTF32ToString","stringToUTF32","lengthBytesUTF32","__embind_register_emval","__emval_decref","emval_handles","HandleAllocator","Emval","init_emval","count_emval_handles","__embind_register_memory_view","__embind_register_function","craftInvokerFunction","runDestructors","newFunc","exposePublicSymbol","ensureOverloadTable","heap32VectorToArray","replacePublicSymbol","embind__requireFunction","getDynCaller","getWasmTableEntry","throwUnboundTypeError","UnboundTypeError","getTypeName","___getTypeName","__embind_register_value_array","tupleRegistrations","__embind_register_value_array_element","__embind_finalize_value_array","__embind_register_value_object","structRegistrations","__embind_register_value_object_field","__embind_finalize_value_object","__embind_register_class","ClassHandle","init_ClassHandle","ClassHandle_isAliasOf","ClassHandle_clone","shallowCopyInternalPointer","throwInstanceAlreadyDeleted","attachFinalizer","finalizationRegistry","detachFinalizer","releaseClassHandle","runDestructor","RegisteredPointer_fromWireType","downcastPointer","registeredPointers","getInheritedInstance","registeredInstances","init_embind","getInheritedInstanceCount","getLiveInheritedInstances","flushPendingDeletes","deletionQueue","setDelayFunction","delayFunction","getBasestPointer","makeClassHandle","bigintToI53Checked","MAX_INT53","MIN_INT53","ClassHandle_delete","ClassHandle_isDeleted","ClassHandle_deleteLater","RegisteredClass","RegisteredPointer","constNoSmartPtrRawPointerToWireType","upcastPointer","genericPointerToWireType","nonConstNoSmartPtrRawPointerToWireType","init_RegisteredPointer","RegisteredPointer_getPointee","RegisteredPointer_destructor","RegisteredPointer_deleteObject","__embind_register_class_constructor","__embind_register_class_function","__embind_register_class_property","validateThis","__embind_register_class_class_function","__embind_register_class_class_property","__embind_create_inheriting_constructor","PureVirtualError","registerInheritedInstance","requireRegisteredType","unregisterInheritedInstance","__embind_register_smart_ptr","__embind_register_enum","enumReadValueFromPointer","__embind_register_enum_value","__embind_register_constant","__emval_register_symbol","emval_symbols","__emval_incref","__emval_run_destructors","__emval_new_array","__emval_new_array_from_memory_view","__emval_new_object","__emval_new_cstring","getStringOrSymbol","__emval_new_u8string","__emval_new_u16string","__emval_take_value","__emval_new","craftEmvalAllocator","emval_newers","__emval_get_global","emval_get_global","__emval_get_module_property","__emval_get_property","__emval_set_property","__emval_as","__emval_as_int64","__emval_as_uint64","__emval_equals","__emval_strictly_equals","__emval_greater_than","__emval_less_than","__emval_not","__emval_call","emval_lookupTypes","__emval_get_method_caller","emval_addMethodCaller","emval_methodCallers","emval_registeredMethods","__emval_call_method","emval_allocateDestructors","__emval_call_void_method","__emval_typeof","__emval_instanceof","__emval_is_number","__emval_is_string","__emval_in","__emval_delete","__emval_throw"],"warnings":false,"asyncFuncs":[],"ATINITS":"","ATMAINS":"","ATEXITS":""}

globalThis.Module['ASSERTIONS'] = true;
export default globalThis.Module;

function toArray(vector) {
  const output = [];
  for (let i = 0; i < vector.size(); i += 1) {
    output.push(vector.get(i));
  }
  return output;
}

function toVector(VectorClass, array = []) {
  const vector = new VectorClass();
  array.forEach((item) => {
    vector.push_back(item);
  });
  return vector;
}

globalThis.Module.toArray = toArray;
globalThis.Module.toVector = toVector;
