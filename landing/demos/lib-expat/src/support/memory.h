#pragma once

// The size of the module's linear memory. WebAssembly memory only grows, so the same value before
// and after a run means the run needed no more memory than was already there.
namespace memory {

inline double linearBytes() {
#if defined(__wasm__)
    return static_cast<double>(__builtin_wasm_memory_size(0)) * 65536.0;
#else
    return 0;
#endif
}

}  // namespace memory
