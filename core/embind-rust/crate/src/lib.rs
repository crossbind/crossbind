//! embind-rs: a Rust producer for the emscripten embind registration protocol (spike).
//! Consumers are untouched: libembind.js on web, jsi-embind on mobile read the same calls.
use std::any::TypeId;
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CString};
use std::sync::{Mutex, OnceLock};

extern "C" {
    fn crossbind_embind_register_class(
        cls: *const c_void, ptr_ty: *const c_void, const_ptr_ty: *const c_void, base: *const c_void,
        gat_sig: *const c_char, get_actual_type: usize,
        upcast_sig: *const c_char, upcast: usize,
        downcast_sig: *const c_char, downcast: usize,
        name: *const c_char, dtor_sig: *const c_char, dtor: usize,
    );
    fn crossbind_embind_register_class_constructor(
        cls: *const c_void, argc: u32, arg_types: *const *const c_void,
        sig: *const c_char, invoker: usize, ctor: usize,
    );
    fn crossbind_embind_register_class_function(
        cls: *const c_void, name: *const c_char, argc: u32, arg_types: *const *const c_void,
        sig: *const c_char, invoker: usize, ctx: usize,
        is_pure_virtual: u32, is_async: bool, is_nonnull_return: bool,
    );
    fn crossbind_embind_register_class_class_function(
        cls: *const c_void, name: *const c_char, argc: u32, arg_types: *const *const c_void,
        sig: *const c_char, invoker: usize, method: usize,
        is_async: bool, is_nonnull_return: bool,
    );
    fn crossbind_embind_register_smart_ptr(
        ptr_ty: *const c_void, pointee_ty: *const c_void, name: *const c_char, sharing_policy: i32,
        gp_sig: *const c_char, get_pointee: usize,
        ctor_sig: *const c_char, constructor: usize,
        share_sig: *const c_char, share: usize,
        dtor_sig: *const c_char, destructor: usize,
    );
    fn crossbind_embind_register_enum(enum_ty: *const c_void, name: *const c_char, size: usize, is_signed: bool, policy: i32);
    fn crossbind_embind_register_enum_value(enum_ty: *const c_void, name: *const c_char, value: i32);
    fn crossbind_embind_register_constant(name: *const c_char, ty: *const c_void, value: f64);
    fn crossbind_embind_register_class_property(
        cls: *const c_void, name: *const c_char,
        getter_ty: *const c_void, getter_sig: *const c_char, getter: usize, getter_ctx: *mut c_void,
        setter_ty: *const c_void, setter_sig: *const c_char, setter: usize, setter_ctx: *mut c_void,
    );
    fn crossbind_embind_register_value_object(
        struct_ty: *const c_void, name: *const c_char,
        ctor_sig: *const c_char, ctor: usize, dtor_sig: *const c_char, dtor: usize,
    );
    fn crossbind_embind_register_value_object_field(
        struct_ty: *const c_void, name: *const c_char,
        getter_ret: *const c_void, getter_sig: *const c_char, getter: usize, getter_ctx: usize,
        setter_arg: *const c_void, setter_sig: *const c_char, setter: usize, setter_ctx: usize,
    );
    fn crossbind_embind_finalize_value_object(struct_ty: *const c_void);
    // Registers an init function with the host's binding-init list. The host runs it at the
    // right time: immediately on web, after the JSI runtime is installed on mobile.
    fn crossbind_embind_register_bindings(init: extern "C" fn());
    fn crossbind_embind_register_function(
        name: *const c_char, argc: u32, arg_types: *const *const c_void,
        sig: *const c_char, invoker: usize, function: usize,
        is_async: bool, is_nonnull_return: bool,
    );
    fn crossbind_tid_int() -> *const c_void;
    fn crossbind_tid_double() -> *const c_void;
    fn crossbind_tid_bool() -> *const c_void;
    fn crossbind_tid_void() -> *const c_void;
    fn crossbind_tid_std_string() -> *const c_void;
    fn free(ptr: *mut u8);
    fn crossbind_tid_int64() -> *const c_void;
    fn crossbind_tid_uint64() -> *const c_void;
    fn crossbind_tid_int8() -> *const c_void;
    fn crossbind_tid_int16() -> *const c_void;
    fn crossbind_tid_uint8() -> *const c_void;
    fn crossbind_tid_uint16() -> *const c_void;
    fn crossbind_tid_uint32() -> *const c_void;
    fn crossbind_tid_float() -> *const c_void;
    fn crossbind_embind_register_optional(optional_ty: *const c_void, inner_ty: *const c_void);
    fn crossbind_tid_optional_int() -> *const c_void;
    fn crossbind_tid_optional_double() -> *const c_void;
    fn crossbind_tid_optional_bool() -> *const c_void;
    fn crossbind_tid_optional_string() -> *const c_void;
    fn malloc(size: usize) -> *mut u8;
    // Adapter-owned error escape ([u32 len][bytes] wire): web throws a JS Error immediately,
    // native stores the message and throws after the invoker returns.
    fn crossbind_embind_raise_error(wire_msg: *mut u8);
    fn crossbind_embind_raise_error_coded(msg: *mut u8, code: *mut u8);
}

// Optional wire helpers exist only on wasm (native optionals are nullable heap cells the jsi
// adapter converts itself). The opt_* readers consume the incoming handle's reference.
#[cfg(target_family = "wasm")]
extern "C" {
    fn crossbind_emval_take_value(inner_ty: *const c_void, argv: *const c_void) -> usize;
    fn crossbind_emval_null() -> usize;
    fn crossbind_emval_opt_i32(handle: usize, out: *mut i32) -> i32;
    fn crossbind_emval_opt_f64(handle: usize, out: *mut f64) -> i32;
    fn crossbind_emval_opt_bool(handle: usize, out: *mut u8) -> i32;
    fn crossbind_emval_opt_string(handle: usize, out: *mut *mut u8) -> i32;
}

// embind holds pointers to the registration data (typeids, argType arrays, signature strings)
// for the lifetime of the program, so they must be 'static. Instead of scattering `Box::leak`,
// one arena owns them: the containers move on growth but the heap buffers they point at stay
// put, so the pointers handed out remain valid for as long as the arena (i.e. the process).
struct Registry {
    cstrings: Vec<CString>,
    tids: Vec<Box<u8>>,
    argtypes: Vec<Box<[*const c_void]>>,
    class_tid: HashMap<TypeId, *const c_void>,
    class_ptr_tid: HashMap<TypeId, *const c_void>,
    owned_ptr_tid: HashMap<TypeId, *const c_void>,
    shared_ptr_tid: HashMap<TypeId, *const c_void>,
}
// Raw pointers are not Send/Sync; the arena is only ever touched under its Mutex.
unsafe impl Send for Registry {}

fn registry() -> &'static Mutex<Registry> {
    static REG: OnceLock<Mutex<Registry>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(Registry {
        cstrings: Vec::new(), tids: Vec::new(), argtypes: Vec::new(), class_tid: HashMap::new(),
        class_ptr_tid: HashMap::new(),
        owned_ptr_tid: HashMap::new(),
        shared_ptr_tid: HashMap::new(),
    }))
}

impl Registry {
    fn cstr(&mut self, s: &str) -> *const c_char {
        let c = CString::new(s).expect("no interior NUL in binding name");
        let ptr = c.as_ptr();
        self.cstrings.push(c);
        ptr
    }
    fn tid(&mut self) -> *const c_void {
        let b = Box::new(0u8);
        let ptr = &*b as *const u8 as *const c_void;
        self.tids.push(b);
        ptr
    }
    fn argtypes(&mut self, v: Vec<*const c_void>) -> *const *const c_void {
        let boxed = v.into_boxed_slice();
        let ptr = boxed.as_ptr();
        self.argtypes.push(boxed);
        ptr
    }
}

#[doc(hidden)]
pub fn __register_bindings(init: extern "C" fn()) {
    unsafe { crossbind_embind_register_bindings(init); }
}

/// Registers the bindings with the host - the Rust equivalent of C++'s `EMSCRIPTEN_BINDINGS`.
/// A platform init-array constructor hands the binding function to the host's init list, which
/// runs it at the right time (immediately on web; after the JSI runtime is installed on mobile).
/// No C++ trigger is needed. The consumer staticlib must be whole-archived so the constructor is
/// pulled into the link.
#[macro_export]
macro_rules! bindings {
    ($($body:tt)*) => {
        const _: () = {
            extern "C" fn __crossbind_embind_init() {
                // Run at most once: the init-array constructor can be pulled in more than once
                // (force_load + a normal link of the same archive), which would otherwise register
                // every public name twice and abort in embind.
                use ::core::sync::atomic::{AtomicBool, Ordering};
                static DONE: AtomicBool = AtomicBool::new(false);
                if DONE.swap(true, Ordering::SeqCst) { return; }
                $($body)*
            }
            extern "C" fn __crossbind_embind_ctor() {
                $crate::__register_bindings(__crossbind_embind_init);
            }
            #[used]
            #[cfg_attr(target_vendor = "apple", link_section = "__DATA,__mod_init_func")]
            #[cfg_attr(not(target_vendor = "apple"), link_section = ".init_array")]
            static __CROSSBIND_EMBIND_CTOR: extern "C" fn() = __crossbind_embind_ctor;
        };
    };
}

/// Types that cross the bridge: wire representation + signature letter + embind typeid.
pub trait WireType: 'static {
    type Wire;
    const SIG: char;
    fn tid() -> *const c_void;
    fn from_wire(w: Self::Wire) -> Self;
    fn to_wire(self) -> Self::Wire;
}

impl WireType for i32 {
    type Wire = i32;
    const SIG: char = 'i';
    fn tid() -> *const c_void { unsafe { crossbind_tid_int() } }
    fn from_wire(w: i32) -> i32 { w }
    fn to_wire(self) -> i32 { self }
}

// On wasm the invoker is dyncalled by embind-js, so its C signature must carry a real f64.
#[cfg(target_family = "wasm")]
impl WireType for f64 {
    type Wire = f64;
    const SIG: char = 'd';
    fn tid() -> *const c_void { unsafe { crossbind_tid_double() } }
    fn from_wire(w: f64) -> f64 { w }
    fn to_wire(self) -> f64 { self }
}

// On native the invoker is called only by the host adapter, whose bounded dispatch is
// integer-slot based: a real f64 parameter would land in FP registers and read garbage.
// Carry the double as its bit pattern in a u64 instead - the adapter converts number<->bits,
// so the invoker's C signature stays fully integer-class and every ABI dispatches correctly.
#[cfg(not(target_family = "wasm"))]
impl WireType for f64 {
    type Wire = u64;
    const SIG: char = 'd';
    fn tid() -> *const c_void { unsafe { crossbind_tid_double() } }
    fn from_wire(w: u64) -> f64 { f64::from_bits(w) }
    fn to_wire(self) -> u64 { self.to_bits() }
}

// i64/u64 cross as JS BigInt: 'j'/'u' slots are 64-bit integer-class in the invoker's C
// signature, so the native bounded dispatch stays valid; on wasm the dynCall char is 'j'
// for both (the web adapter maps 'u' -> 'j', signedness lives in the registered typeid).
impl WireType for i64 {
    type Wire = i64;
    const SIG: char = 'j';
    fn tid() -> *const c_void { unsafe { crossbind_tid_int64() } }
    fn from_wire(w: i64) -> i64 { w }
    fn to_wire(self) -> i64 { self }
}

impl WireType for u64 {
    type Wire = u64;
    const SIG: char = 'u';
    fn tid() -> *const c_void { unsafe { crossbind_tid_uint64() } }
    fn from_wire(w: u64) -> u64 { w }
    fn to_wire(self) -> u64 { self }
}

// bool crosses as an int-sized wire (0/1), the way emscripten's ABI passes it.
// The narrower integers ride the int slot with their own type ids, so the host converter keeps
// each one's range check instead of silently wrapping a value the Rust type cannot hold.
macro_rules! int_wire {
    ($( $ty:ty, $tid:ident ; )*) => {
        $(
            impl WireType for $ty {
                type Wire = i32;
                const SIG: char = 'i';
                fn tid() -> *const c_void { unsafe { $tid() } }
                fn from_wire(w: i32) -> $ty { w as $ty }
                fn to_wire(self) -> i32 { self as i32 }
            }
        )*
    };
}

int_wire! {
    i8, crossbind_tid_int8;
    i16, crossbind_tid_int16;
    u8, crossbind_tid_uint8;
    u16, crossbind_tid_uint16;
    u32, crossbind_tid_uint32;
}

// f32 crosses through the double slot: JS has one number type, so the value widens on the way
// out and narrows on the way in - the Rust signature is what asks for single precision.
#[cfg(target_family = "wasm")]
impl WireType for f32 {
    type Wire = f64;
    const SIG: char = 'd';
    fn tid() -> *const c_void { unsafe { crossbind_tid_float() } }
    fn from_wire(w: f64) -> f32 { w as f32 }
    fn to_wire(self) -> f64 { self as f64 }
}

#[cfg(not(target_family = "wasm"))]
impl WireType for f32 {
    type Wire = u64;
    const SIG: char = 'd';
    fn tid() -> *const c_void { unsafe { crossbind_tid_float() } }
    fn from_wire(w: u64) -> f32 { f64::from_bits(w) as f32 }
    fn to_wire(self) -> u64 { (self as f64).to_bits() }
}

// usize/isize are 32-bit on wasm and 64-bit everywhere else, so each platform rides the slot
// that carries its full range: a number on wasm, a BigInt on native.
#[cfg(target_pointer_width = "32")]
impl WireType for usize {
    type Wire = i32;
    const SIG: char = 'i';
    fn tid() -> *const c_void { unsafe { crossbind_tid_uint32() } }
    fn from_wire(w: i32) -> usize { w as usize }
    fn to_wire(self) -> i32 { self as i32 }
}

#[cfg(target_pointer_width = "32")]
impl WireType for isize {
    type Wire = i32;
    const SIG: char = 'i';
    fn tid() -> *const c_void { unsafe { crossbind_tid_int() } }
    fn from_wire(w: i32) -> isize { w as isize }
    fn to_wire(self) -> i32 { self as i32 }
}

#[cfg(not(target_pointer_width = "32"))]
impl WireType for usize {
    type Wire = u64;
    const SIG: char = 'u';
    fn tid() -> *const c_void { unsafe { crossbind_tid_uint64() } }
    fn from_wire(w: u64) -> usize { w as usize }
    fn to_wire(self) -> u64 { self as u64 }
}

#[cfg(not(target_pointer_width = "32"))]
impl WireType for isize {
    type Wire = i64;
    const SIG: char = 'j';
    fn tid() -> *const c_void { unsafe { crossbind_tid_int64() } }
    fn from_wire(w: i64) -> isize { w as isize }
    fn to_wire(self) -> i64 { self as i64 }
}

// char crosses as a one-character string, the way JS spells a character; an incoming string
// yields its first character (an empty one is U+FFFD, the replacement character).
impl WireType for char {
    type Wire = <String as WireType>::Wire;
    const SIG: char = 's';
    fn tid() -> *const c_void { <String as WireType>::tid() }
    fn from_wire(w: Self::Wire) -> char { String::from_wire(w).chars().next().unwrap_or('\u{fffd}') }
    fn to_wire(self) -> Self::Wire { self.to_string().to_wire() }
}

impl WireType for bool {
    type Wire = i32;
    const SIG: char = 'i';
    fn tid() -> *const c_void { unsafe { crossbind_tid_bool() } }
    fn from_wire(w: i32) -> bool { w != 0 }
    fn to_wire(self) -> i32 { self as i32 }
}

// The void return type: methods that mutate without producing a value.
impl WireType for () {
    type Wire = ();
    const SIG: char = 'v';
    fn tid() -> *const c_void { unsafe { crossbind_tid_void() } }
    fn from_wire(_: ()) {}
    fn to_wire(self) {}
}

/// std::string wire: [u32 len][bytes] (malloc'd). The consumer frees on return, and also
/// frees an incoming argument after the call - Rust only COPIES, never owns the wire buffer.
impl WireType for String {
    type Wire = *mut u8;
    // 's' (not 'p'): embind-jsi passes std::string as a jsi::String, not a raw pointer, so the host
    // adapter must marshal it - the Rust side still sees the `[u32 len][bytes]` wire below.
    const SIG: char = 's';
    fn tid() -> *const c_void { unsafe { crossbind_tid_std_string() } }
    fn from_wire(w: *mut u8) -> String {
        unsafe {
            let len = *(w as *const u32) as usize;
            let bytes = std::slice::from_raw_parts(w.add(4), len);
            String::from_utf8_lossy(bytes).into_owned()
        }
    }
    fn to_wire(self) -> *mut u8 {
        unsafe {
            let bytes = self.as_bytes();
            let base = malloc(4 + bytes.len());
            *(base as *mut u32) = bytes.len() as u32;
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), base.add(4), bytes.len());
            base
        }
    }
}

/// Option<T> both ways: on wasm the wire is an EM_VAL handle (None = null; incoming
/// undefined/null both read as None); on native it is a nullable heap cell (0 = None) the jsi
/// adapter converts, tagged 'I'/'D'/'B'/'S'. Incoming cells stay adapter-owned (read, no free).
macro_rules! option_wire {
    ($( $inner:ty, $opt_tid:ident, $native_sig:literal ; )*) => {
        $(
            #[cfg(target_family = "wasm")]
            impl WireType for Option<$inner> {
                type Wire = usize;
                const SIG: char = 'i';
                fn tid() -> *const c_void { unsafe { $opt_tid() } }
                fn from_wire(w: usize) -> Self { <$inner as EmvalOptRead>::emval_opt_read(w) }
                fn to_wire(self) -> usize {
                    match self {
                        None => unsafe { crossbind_emval_null() },
                        Some(v) => v.emval_take(),
                    }
                }
            }
            #[cfg(not(target_family = "wasm"))]
            impl WireType for Option<$inner> {
                type Wire = *mut u8;
                const SIG: char = $native_sig;
                fn tid() -> *const c_void { unsafe { $opt_tid() } }
                fn from_wire(w: *mut u8) -> Self {
                    if w.is_null() { None } else { Some(<$inner as OptionCellRead>::option_cell_read(w)) }
                }
                fn to_wire(self) -> *mut u8 {
                    match self {
                        None => std::ptr::null_mut(),
                        Some(v) => v.option_cell(),
                    }
                }
            }
        )*
    };
}
option_wire! {
    i32, crossbind_tid_optional_int, 'I';
    f64, crossbind_tid_optional_double, 'D';
    bool, crossbind_tid_optional_bool, 'B';
    String, crossbind_tid_optional_string, 'S';
}

// wasm Some-path: hand the inner's in-memory repr to _emval_take_value. JS copies the value
// synchronously, so stack temporaries suffice; the string wire is freed by embind itself.
#[cfg(target_family = "wasm")]
trait EmvalTake { fn emval_take(self) -> usize; }
#[cfg(target_family = "wasm")]
impl EmvalTake for i32 {
    fn emval_take(self) -> usize { unsafe { crossbind_emval_take_value(crossbind_tid_int(), &self as *const i32 as *const c_void) } }
}
#[cfg(target_family = "wasm")]
impl EmvalTake for f64 {
    fn emval_take(self) -> usize { unsafe { crossbind_emval_take_value(crossbind_tid_double(), &self as *const f64 as *const c_void) } }
}
#[cfg(target_family = "wasm")]
impl EmvalTake for bool {
    fn emval_take(self) -> usize {
        let b: u8 = self as u8;
        unsafe { crossbind_emval_take_value(crossbind_tid_bool(), &b as *const u8 as *const c_void) }
    }
}
#[cfg(target_family = "wasm")]
impl EmvalTake for String {
    fn emval_take(self) -> usize {
        let w = self.to_wire();
        unsafe { crossbind_emval_take_value(crossbind_tid_std_string(), &w as *const *mut u8 as *const c_void) }
    }
}

// wasm incoming: the opt_* reader consumes the handle and yields the native repr (1) or
// nothing (0, for undefined/null). The string reader hands over a producer-owned wire buffer.
#[cfg(target_family = "wasm")]
trait EmvalOptRead: Sized { fn emval_opt_read(handle: usize) -> Option<Self>; }
#[cfg(target_family = "wasm")]
impl EmvalOptRead for i32 {
    fn emval_opt_read(h: usize) -> Option<i32> {
        let mut v: i32 = 0;
        if unsafe { crossbind_emval_opt_i32(h, &mut v) } != 0 { Some(v) } else { None }
    }
}
#[cfg(target_family = "wasm")]
impl EmvalOptRead for f64 {
    fn emval_opt_read(h: usize) -> Option<f64> {
        let mut v: f64 = 0.0;
        if unsafe { crossbind_emval_opt_f64(h, &mut v) } != 0 { Some(v) } else { None }
    }
}
#[cfg(target_family = "wasm")]
impl EmvalOptRead for bool {
    fn emval_opt_read(h: usize) -> Option<bool> {
        let mut v: u8 = 0;
        if unsafe { crossbind_emval_opt_bool(h, &mut v) } != 0 { Some(v != 0) } else { None }
    }
}
#[cfg(target_family = "wasm")]
impl EmvalOptRead for String {
    fn emval_opt_read(h: usize) -> Option<String> {
        let mut w: *mut u8 = std::ptr::null_mut();
        if unsafe { crossbind_emval_opt_string(h, &mut w) } == 0 { return None; }
        let s = String::from_wire(w);
        unsafe { free(w); }
        Some(s)
    }
}

// Native incoming: read the adapter-owned cell (the adapter frees it after the call).
#[cfg(not(target_family = "wasm"))]
trait OptionCellRead: Sized { fn option_cell_read(cell: *mut u8) -> Self; }
#[cfg(not(target_family = "wasm"))]
impl OptionCellRead for i32 {
    fn option_cell_read(cell: *mut u8) -> i32 { unsafe { *(cell as *const i32) } }
}
#[cfg(not(target_family = "wasm"))]
impl OptionCellRead for f64 {
    fn option_cell_read(cell: *mut u8) -> f64 { unsafe { *(cell as *const f64) } }
}
#[cfg(not(target_family = "wasm"))]
impl OptionCellRead for bool {
    fn option_cell_read(cell: *mut u8) -> bool { unsafe { *cell != 0 } }
}
#[cfg(not(target_family = "wasm"))]
impl OptionCellRead for String {
    fn option_cell_read(cell: *mut u8) -> String { String::from_wire(cell) }
}

// Native Some-path: one malloc'd cell per kind; the jsi adapter reads and frees it.
#[cfg(not(target_family = "wasm"))]
trait OptionCell { fn option_cell(self) -> *mut u8; }
#[cfg(not(target_family = "wasm"))]
impl OptionCell for i32 {
    fn option_cell(self) -> *mut u8 { unsafe { let p = malloc(4); *(p as *mut i32) = self; p } }
}
#[cfg(not(target_family = "wasm"))]
impl OptionCell for f64 {
    fn option_cell(self) -> *mut u8 { unsafe { let p = malloc(8); *(p as *mut f64) = self; p } }
}
#[cfg(not(target_family = "wasm"))]
impl OptionCell for bool {
    fn option_cell(self) -> *mut u8 { unsafe { let p = malloc(1); *p = self as u8; p } }
}
#[cfg(not(target_family = "wasm"))]
impl OptionCell for String {
    fn option_cell(self) -> *mut u8 { self.to_wire() }
}

/// Registers std::optional<T> for the inners a bridge actually returns (adapter-idempotent).
pub fn register_optional_i32() { unsafe { crossbind_embind_register_optional(crossbind_tid_optional_int(), crossbind_tid_int()); } }
pub fn register_optional_f64() { unsafe { crossbind_embind_register_optional(crossbind_tid_optional_double(), crossbind_tid_double()); } }
pub fn register_optional_bool() { unsafe { crossbind_embind_register_optional(crossbind_tid_optional_bool(), crossbind_tid_bool()); } }
pub fn register_optional_string() { unsafe { crossbind_embind_register_optional(crossbind_tid_optional_string(), crossbind_tid_std_string()); } }

/// A module-level constant: the value crosses once at registration, so JS reads a plain value
/// instead of calling a getter. Only the wire kinds a double carries exactly are offered.
pub trait ConstantValue: WireType {
    fn as_constant(self) -> f64;
}
impl ConstantValue for i32 { fn as_constant(self) -> f64 { self as f64 } }
impl ConstantValue for f64 { fn as_constant(self) -> f64 { self } }
impl ConstantValue for bool { fn as_constant(self) -> f64 { if self { 1.0 } else { 0.0 } } }

/// A string constant: the double the ABI carries is the emval handle of a JS string, which the
/// emval type reads straight back. The handle is released on purpose - the constant owns it for
/// the life of the module.
pub fn constant_str(name: &str, value: &str) {
    let handle = JsValue::from_str(value).release();
    let name_ptr = { registry().lock().unwrap().cstr(name) };
    unsafe { crossbind_embind_register_constant(name_ptr, crossbind_tid_emval(), handle as f64) };
}

pub fn constant<T: ConstantValue>(name: &str, value: T) {
    let name_ptr = { registry().lock().unwrap().cstr(name) };
    unsafe { crossbind_embind_register_constant(name_ptr, T::tid(), value.as_constant()) };
}

/// Post-raise sentinel returns: only native ever observes them (the adapter throws right after
/// the invoker returns); on web `crossbind_embind_raise_error` throws into JS and never comes back.
pub trait ErrSentinel {
    fn err_sentinel() -> Self;
}
impl ErrSentinel for i32 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for i64 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for u64 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for f64 { fn err_sentinel() -> Self { 0.0 } }
impl ErrSentinel for bool { fn err_sentinel() -> Self { false } }
impl ErrSentinel for () { fn err_sentinel() -> Self {} }
impl ErrSentinel for String { fn err_sentinel() -> Self { String::new() } }
impl<T> ErrSentinel for *mut T { fn err_sentinel() -> Self { std::ptr::null_mut() } }
// A fallible optional (`Result<Option<T>, E>`) raises and then returns None.
impl<T> ErrSentinel for Option<T> { fn err_sentinel() -> Self { None } }
// The narrower integers and the pointer-wide ones share the zero sentinel.
impl ErrSentinel for i8 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for i16 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for u8 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for u16 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for u32 { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for f32 { fn err_sentinel() -> Self { 0.0 } }
impl ErrSentinel for usize { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for isize { fn err_sentinel() -> Self { 0 } }
impl ErrSentinel for char { fn err_sentinel() -> Self { '\u{fffd}' } }

/// Routes a shim's `Err` to JS as an exception, then returns a dead sentinel value.
/// Runs a binding body so that a Rust panic reaches JS as an exception instead of tearing the
/// process down. The panic still means a bug: state is whatever the panic left behind, the same
/// caveat napi-rs documents for its own catch_unwind.
///
/// Two runtimes, two mechanisms. Native targets unwind, so the panic is caught here. The wasm
/// target's std aborts instead of unwinding, so a panic hook raises the error from inside the
/// panic itself - the JS throw leaves the call before the abort can run.
pub fn guard<R: ErrSentinel>(body: impl FnOnce() -> R) -> R {
    install_panic_hook();
    #[cfg(target_family = "wasm")]
    {
        body()
    }
    #[cfg(not(target_family = "wasm"))]
    {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(body)) {
            Ok(value) => value,
            Err(payload) => raise_err(panic_text(&payload)),
        }
    }
}

fn install_panic_hook() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let text = match info.payload().downcast_ref::<&str>() {
                Some(text) => (*text).to_string(),
                None => match info.payload().downcast_ref::<String>() {
                    Some(text) => text.clone(),
                    None => String::from("panicked"),
                },
            };
            let text = match info.location() {
                Some(at) => format!("{text} (panicked at {}:{})", at.file(), at.line()),
                None => text,
            };
            // wasm: this throws into JS and the call never comes back, so the abort below the
            // hook is skipped. Native: the adapter parks the message and throws once the
            // invoker returns, so unwinding still reaches the catch in `guard`.
            #[cfg(target_family = "wasm")]
            unsafe { crossbind_embind_raise_error(text.to_wire()) };
            #[cfg(not(target_family = "wasm"))]
            {
                let _ = &text;
                previous(info);
            }
        }));
    });
}

#[cfg(not(target_family = "wasm"))]
fn panic_text(payload: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() { return (*text).to_string(); }
    if let Some(text) = payload.downcast_ref::<String>() { return text.clone(); }
    String::from("panicked")
}

pub fn raise_err<W: ErrSentinel>(msg: String) -> W {
    unsafe { crossbind_embind_raise_error(msg.to_wire()); }
    W::err_sentinel()
}

/// The same escape carrying a machine-readable code, so JS can branch on `error.code` instead
/// of matching message text.
pub fn raise_err_coded<W: ErrSentinel>(msg: String, code: Option<String>) -> W {
    let code_wire = match code {
        Some(text) => text.to_wire(),
        None => core::ptr::null_mut(),
    };
    unsafe { crossbind_embind_raise_error_coded(msg.to_wire(), code_wire); }
    W::err_sentinel()
}

/// An error type that also implements `AsRef<str>` gives that string as the code, the way
/// napi-rs reads a code off its error enums. Everything else has no code: the two traits below
/// are picked apart by autoref, so no specialization feature is needed.
/// The fallback sits behind one more reference than the specialized impl, so method lookup finds
/// the coded one first when the bound holds and falls through to None when it does not.
pub trait CrossbindErrorCode { fn crossbind_code(&self) -> Option<String>; }
impl<E: AsRef<str>> CrossbindErrorCode for E {
    fn crossbind_code(&self) -> Option<String> { Some(self.as_ref().to_string()) }
}
pub trait CrossbindErrorCodeFallback { fn crossbind_code(&self) -> Option<String>; }
impl<E> CrossbindErrorCodeFallback for &E {
    fn crossbind_code(&self) -> Option<String> { None }
}

extern "C" fn property_getter<T: 'static, F: WireType>(ctx: usize, this: *mut T) -> <F as WireType>::Wire {
    let getter: fn(&mut T) -> F = unsafe { core::mem::transmute(ctx) };
    getter(unsafe { &mut *this }).to_wire()
}

extern "C" fn property_setter<T: 'static, F: WireType>(ctx: usize, this: *mut T, value: <F as WireType>::Wire) {
    let setter: fn(&mut T, F) = unsafe { core::mem::transmute(ctx) };
    setter(unsafe { &mut *this }, F::from_wire(value));
}

extern "C" fn dtor_thunk<T>(p: *mut T) {
    if !p.is_null() {
        drop(unsafe { Box::from_raw(p) });
    }
}

extern "C" fn get_actual_type_thunk<T: 'static>(_p: *const c_void) -> *const c_void {
    registry().lock().unwrap().class_tid[&TypeId::of::<T>()]
}

/// The registered typeid of an enum, for a user `WireType` impl's `tid()`. The enum must be
/// registered with `enum_::<E>(..)` before any binding that uses it.
pub fn enum_tid<E: 'static>() -> *const c_void {
    registry().lock().unwrap().class_tid[&TypeId::of::<E>()]
}

/// The registered typeid of a class, for reference-parameter wrappers (`&OtherClass` params).
/// The class must be registered before any binding that takes it - declare the struct earlier.
pub fn class_tid<T: 'static>() -> *const c_void {
    registry().lock().unwrap().class_tid.get(&TypeId::of::<T>()).copied()
        .expect("class parameter type must be registered before the binding that uses it")
}

/// The registered smart-pointer typeid of an OWNED class (`.smart_ptr(..)`), for a method or
/// function that returns a fresh instance by value.
pub fn owned_ptr_tid<T: 'static>() -> *const c_void {
    registry().lock().unwrap().owned_ptr_tid.get(&TypeId::of::<T>()).copied()
        .expect("a class that returns itself by value must register its smart pointer first")
}

/// The registered POINTER typeid of a class: a pointer parameter takes null (a reference does
/// not), which is how `Option<&Class>` spells None.
pub fn class_ptr_tid<T: 'static>() -> *const c_void {
    registry().lock().unwrap().class_ptr_tid.get(&TypeId::of::<T>()).copied()
        .expect("class parameter type must be registered before the binding that uses it")
}

/// The registered smart-pointer typeid of a SHARED class (`.smart_ptr_shared(..)`), for the
/// generated `Arc<T>` return/parameter wrappers.
pub fn shared_tid<T: 'static>() -> *const c_void {
    registry().lock().unwrap().shared_ptr_tid.get(&TypeId::of::<T>()).copied()
        .expect("Arc<T> bindings need the class registered with .smart_ptr_shared(..) first")
}

// Arc-as-intrusive smart pointer: the wire IS the Arc::into_raw pointer, every JS handle owns
// one strong count. share bumps the count (embind's INTRUSIVE path), the destructor drops one.
extern "C" fn arc_share_thunk<T>(p: *mut T) -> *mut T {
    if !p.is_null() {
        unsafe { std::sync::Arc::increment_strong_count(p as *const T) };
    }
    p
}

extern "C" fn arc_dtor_thunk<T>(p: *mut T) {
    if !p.is_null() {
        drop(unsafe { std::sync::Arc::from_raw(p as *const T) });
    }
}

// ---- live JS values (JsValue / JsFunction) ----
// An owned emval handle: the host keeps the real value in its handle table and this side only
// refcounts. Params arrive owned (Drop releases), returns hand the count to JS. Handles are
// thread-affine: use them only on the JS thread that produced them.
extern "C" {
    fn crossbind_tid_emval() -> *const c_void;
    fn crossbind_v_ref(h: usize);
    fn crossbind_v_unref(h: usize);
    fn crossbind_v_undef() -> usize;
    fn crossbind_v_from_f64(v: f64) -> usize;
    fn crossbind_v_from_bool(v: i32) -> usize;
    fn crossbind_v_from_str(w: *mut u8) -> usize;
    fn crossbind_v_get_prop(h: usize, key: *mut u8) -> usize;
    fn crossbind_v_set_prop(h: usize, key: *mut u8, v: usize);
    fn crossbind_v_kind(h: usize) -> i32;
    fn crossbind_v_as_f64(h: usize) -> f64;
    fn crossbind_v_as_bool(h: usize) -> i32;
    fn crossbind_v_as_str(h: usize) -> *mut u8;
    fn crossbind_v_call(f: usize, argc: u32, argv: *const usize) -> usize;
    fn crossbind_v_cb_err_take() -> *mut u8;
    fn crossbind_v_bytes_to_js(data: *const u8, len: u32) -> usize;
    fn crossbind_v_f64s_to_js(data: *const f64, len: u32) -> usize;
    fn crossbind_v_typed_len(h: usize) -> u32;
    fn crossbind_v_bytes_from_js(h: usize, out: *mut u8, len: u32);
    fn crossbind_v_f64s_from_js(h: usize, out: *mut f64, len: u32);
}

fn str_wire(s: &str) -> *mut u8 {
    unsafe {
        let bytes = s.as_bytes();
        let base = malloc(4 + bytes.len());
        *(base as *mut u32) = bytes.len() as u32;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), base.add(4), bytes.len());
        base
    }
}

fn wire_string(w: *mut u8) -> String {
    unsafe {
        let len = *(w as *const u32) as usize;
        let bytes = std::slice::from_raw_parts(w.add(4), len);
        let s = String::from_utf8_lossy(bytes).into_owned();
        free(w);
        s
    }
}

pub struct JsValue {
    handle: usize,
}

impl JsValue {
    fn own(handle: usize) -> Self {
        JsValue { handle }
    }
    fn release(self) -> usize {
        let h = self.handle;
        core::mem::forget(self);
        h
    }
    pub fn undefined() -> Self {
        JsValue::own(unsafe { crossbind_v_undef() })
    }
    pub fn from_f64(v: f64) -> Self {
        JsValue::own(unsafe { crossbind_v_from_f64(v) })
    }
    pub fn from_bool(v: bool) -> Self {
        JsValue::own(unsafe { crossbind_v_from_bool(v as i32) })
    }
    pub fn from_str(v: &str) -> Self {
        JsValue::own(unsafe { crossbind_v_from_str(str_wire(v)) })
    }
    pub fn get(&self, key: &str) -> JsValue {
        JsValue::own(unsafe { crossbind_v_get_prop(self.handle, str_wire(key)) })
    }
    pub fn set(&self, key: &str, value: &JsValue) {
        unsafe { crossbind_v_set_prop(self.handle, str_wire(key), value.handle) };
    }
    // 0 nullish, 1 bool, 2 number, 3 string, 4 function, 5 anything else.
    fn kind(&self) -> i32 {
        unsafe { crossbind_v_kind(self.handle) }
    }
    pub fn is_nullish(&self) -> bool {
        self.kind() == 0
    }
    pub fn as_f64(&self) -> Option<f64> {
        if self.kind() == 2 { Some(unsafe { crossbind_v_as_f64(self.handle) }) } else { None }
    }
    pub fn as_bool(&self) -> Option<bool> {
        if self.kind() == 1 { Some(unsafe { crossbind_v_as_bool(self.handle) } != 0) } else { None }
    }
    pub fn as_string(&self) -> Option<String> {
        if self.kind() == 3 { Some(wire_string(unsafe { crossbind_v_as_str(self.handle) })) } else { None }
    }
}

impl Clone for JsValue {
    fn clone(&self) -> Self {
        unsafe { crossbind_v_ref(self.handle) };
        JsValue { handle: self.handle }
    }
}

/// Typed arrays: a byte or double sequence crosses as the JS view of the same name, copied once
/// in each direction (a view into wasm memory would dangle when the heap grows).
pub struct JsBytes(pub Vec<u8>);

impl WireType for JsBytes {
    type Wire = usize;
    const SIG: char = 'i';
    fn tid() -> *const c_void { unsafe { crossbind_tid_emval() } }
    fn from_wire(w: usize) -> Self {
        let len = unsafe { crossbind_v_typed_len(w) } as usize;
        let mut data = vec![0u8; len];
        unsafe { crossbind_v_bytes_from_js(w, data.as_mut_ptr(), len as u32) };
        unsafe { crossbind_v_unref(w) };
        JsBytes(data)
    }
    fn to_wire(self) -> usize {
        unsafe { crossbind_v_bytes_to_js(self.0.as_ptr(), self.0.len() as u32) }
    }
}

pub struct JsF64s(pub Vec<f64>);

impl WireType for JsF64s {
    type Wire = usize;
    const SIG: char = 'i';
    fn tid() -> *const c_void { unsafe { crossbind_tid_emval() } }
    fn from_wire(w: usize) -> Self {
        let len = unsafe { crossbind_v_typed_len(w) } as usize;
        let mut data = vec![0.0f64; len];
        unsafe { crossbind_v_f64s_from_js(w, data.as_mut_ptr(), len as u32) };
        unsafe { crossbind_v_unref(w) };
        JsF64s(data)
    }
    fn to_wire(self) -> usize {
        unsafe { crossbind_v_f64s_to_js(self.0.as_ptr(), self.0.len() as u32) }
    }
}

impl ErrSentinel for JsBytes { fn err_sentinel() -> Self { JsBytes(Vec::new()) } }
impl ErrSentinel for JsF64s { fn err_sentinel() -> Self { JsF64s(Vec::new()) } }

impl Drop for JsValue {
    fn drop(&mut self) {
        unsafe { crossbind_v_unref(self.handle) };
    }
}

/// A callable JS value; a JS throw inside the callback surfaces as `Err(message)`.
pub struct JsFunction {
    value: JsValue,
}

impl JsFunction {
    fn call_n(&self, args: &[usize]) -> Result<JsValue, String> {
        let h = unsafe { crossbind_v_call(self.value.handle, args.len() as u32, args.as_ptr()) };
        if h == 0 {
            let w = unsafe { crossbind_v_cb_err_take() };
            return Err(if w.is_null() { String::from("callback failed") } else { wire_string(w) });
        }
        Ok(JsValue::own(h))
    }
    pub fn call0(&self) -> Result<JsValue, String> {
        self.call_n(&[])
    }
    pub fn call1(&self, a0: &JsValue) -> Result<JsValue, String> {
        self.call_n(&[a0.handle])
    }
    pub fn call2(&self, a0: &JsValue, a1: &JsValue) -> Result<JsValue, String> {
        self.call_n(&[a0.handle, a1.handle])
    }
}

// The emval handle slot: i32 table index on wasm dynCall, BigInt-marshalled pointer slot on
// the native bounded dispatch (same split as the generated JSON wire).
impl WireType for JsValue {
    type Wire = usize;
    #[cfg(target_family = "wasm")]
    const SIG: char = 'i';
    #[cfg(not(target_family = "wasm"))]
    const SIG: char = 'p';
    fn tid() -> *const c_void {
        unsafe { crossbind_tid_emval() }
    }
    fn from_wire(w: usize) -> Self {
        JsValue::own(w)
    }
    fn to_wire(self) -> usize {
        self.release()
    }
}

impl WireType for JsFunction {
    type Wire = usize;
    #[cfg(target_family = "wasm")]
    const SIG: char = 'i';
    #[cfg(not(target_family = "wasm"))]
    const SIG: char = 'p';
    fn tid() -> *const c_void {
        unsafe { crossbind_tid_emval() }
    }
    fn from_wire(w: usize) -> Self {
        JsFunction { value: JsValue::own(w) }
    }
    fn to_wire(self) -> usize {
        self.value.release()
    }
}

impl ErrSentinel for JsValue {
    fn err_sentinel() -> Self {
        JsValue::undefined()
    }
}

// Host test builds (plain `cargo test` on a package that depends on embind-rs) have no adapter
// to satisfy the emval hooks; this dev-only feature links panicking stand-ins instead. Never
// enable it for a real bridge build - the adapter provides the genuine symbols there.
#[cfg(all(feature = "host-stubs", not(target_family = "wasm")))]
mod host_stubs {
    #[no_mangle] extern "C" fn crossbind_v_ref(_h: usize) {}
    #[no_mangle] extern "C" fn crossbind_v_unref(_h: usize) {}
    #[no_mangle] extern "C" fn crossbind_v_undef() -> usize { panic!("emval hooks need a crossbind host") }
    #[no_mangle] extern "C" fn crossbind_v_from_f64(_v: f64) -> usize { panic!("emval hooks need a crossbind host") }
    #[no_mangle] extern "C" fn crossbind_v_from_bool(_v: i32) -> usize { panic!("emval hooks need a crossbind host") }
    #[no_mangle] extern "C" fn crossbind_v_from_str(_w: *mut u8) -> usize { panic!("emval hooks need a crossbind host") }
    #[no_mangle] extern "C" fn crossbind_v_get_prop(_h: usize, _k: *mut u8) -> usize { panic!("emval hooks need a crossbind host") }
    #[no_mangle] extern "C" fn crossbind_v_set_prop(_h: usize, _k: *mut u8, _v: usize) {}
    #[no_mangle] extern "C" fn crossbind_v_kind(_h: usize) -> i32 { 0 }
    #[no_mangle] extern "C" fn crossbind_v_as_f64(_h: usize) -> f64 { 0.0 }
    #[no_mangle] extern "C" fn crossbind_v_as_bool(_h: usize) -> i32 { 0 }
    #[no_mangle] extern "C" fn crossbind_v_as_str(_h: usize) -> *mut u8 { core::ptr::null_mut() }
    #[no_mangle] extern "C" fn crossbind_v_call(_f: usize, _c: u32, _a: *const usize) -> usize { 0 }
    #[no_mangle] extern "C" fn crossbind_v_cb_err_take() -> *mut u8 { core::ptr::null_mut() }
    #[no_mangle] extern "C" fn crossbind_tid_emval() -> *const core::ffi::c_void { core::ptr::null() }
}

pub struct EnumBuilder<E: 'static> {
    ty: *const c_void,
    _e: std::marker::PhantomData<E>,
}

/// Registers a C-like enum (i32 discriminants). Follow with `.value(name, discriminant)`.
pub fn enum_<E: 'static>(name: &str) -> EnumBuilder<E> {
    let (ty, name_ptr);
    {
        let mut r = registry().lock().unwrap();
        ty = r.tid();
        name_ptr = r.cstr(name);
        r.class_tid.insert(TypeId::of::<E>(), ty);
    }
    unsafe { crossbind_embind_register_enum(ty, name_ptr, 4, true, 0); }
    EnumBuilder { ty, _e: std::marker::PhantomData }
}

impl<E: 'static> EnumBuilder<E> {
    pub fn value(self, name: &str, discriminant: i32) -> Self {
        let name_ptr = registry().lock().unwrap().cstr(name);
        unsafe { crossbind_embind_register_enum_value(self.ty, name_ptr, discriminant); }
        self
    }
}

/// The registered typeid of a value object, for a user `WireType` impl's `tid()`.
pub fn value_object_tid<T: 'static>() -> *const c_void {
    registry().lock().unwrap().class_tid[&TypeId::of::<T>()]
}

extern "C" fn value_ctor<T: Default>() -> *mut T {
    Box::into_raw(Box::new(T::default()))
}
extern "C" fn field_getter<F: WireType + Copy>(offset: usize, s: *const u8) -> <F as WireType>::Wire {
    unsafe { (*(s.add(offset) as *const F)).to_wire() }
}
extern "C" fn field_setter<F: WireType>(offset: usize, s: *mut u8, v: <F as WireType>::Wire) {
    unsafe { *(s.add(offset) as *mut F) = F::from_wire(v); }
}

pub struct ValueObjectBuilder<T: 'static> {
    ty: *const c_void,
    _t: std::marker::PhantomData<T>,
}

/// Registers a by-value data struct (a plain `{field: ...}` object in JS). Add fields with
/// `.field::<F>(name, offset_of!(T, field))`, then call `.finalize()`. `T` must be `Default`.
pub fn value_object_<T: Default + 'static>(name: &str) -> ValueObjectBuilder<T> {
    let (ty, name_ptr, ctor_sig, dtor_sig);
    {
        let mut r = registry().lock().unwrap();
        ty = r.tid();
        name_ptr = r.cstr(name);
        ctor_sig = r.cstr("p");
        dtor_sig = r.cstr("vp");
        r.class_tid.insert(TypeId::of::<T>(), ty);
    }
    unsafe {
        crossbind_embind_register_value_object(
            ty, name_ptr, ctor_sig, value_ctor::<T> as *const () as usize, dtor_sig, dtor_thunk::<T> as *const () as usize,
        );
    }
    ValueObjectBuilder { ty, _t: std::marker::PhantomData }
}

impl<T: 'static> ValueObjectBuilder<T> {
    pub fn field<F: WireType + Copy>(self, name: &str, offset: usize) -> Self {
        let (name_ptr, getter_sig, setter_sig);
        {
            let mut r = registry().lock().unwrap();
            name_ptr = r.cstr(name);
            getter_sig = r.cstr(&format!("{}pp", F::SIG));
            setter_sig = r.cstr(&format!("vpp{}", F::SIG));
        }
        unsafe {
            crossbind_embind_register_value_object_field(
                self.ty, name_ptr,
                F::tid(), getter_sig, field_getter::<F> as *const () as usize, offset,
                F::tid(), setter_sig, field_setter::<F> as *const () as usize, offset,
            );
        }
        self
    }

    pub fn finalize(self) {
        unsafe { crossbind_embind_finalize_value_object(self.ty); }
    }
}

pub struct ClassBuilder<T: 'static> {
    cls: *const c_void,
    ptr_ty: *const c_void,
    smart_ptr_ty: Option<*const c_void>,
    _t: std::marker::PhantomData<T>,
}

// Identity thunks for the smart pointer: our "smart pointer value" IS the raw Box'd pointee,
// so getPointee/construct/share are identity and the destructor drops the Box. Registered with
// sharing_policy NONE, so share is never actually called and the pointee stays uniquely owned
// (making `&mut *this` in method invokers sound).
extern "C" fn smart_identity(p: *mut c_void) -> *mut c_void { p }

pub fn class_<T: 'static>(name: &str) -> ClassBuilder<T> {
    let (cls, ptr_ty, const_ptr_ty, gat, name_ptr, dtor_sig);
    {
        let mut r = registry().lock().unwrap();
        cls = r.tid();
        ptr_ty = r.tid();
        const_ptr_ty = r.tid();
        gat = r.cstr("pp");
        name_ptr = r.cstr(name);
        dtor_sig = r.cstr("vp");
        r.class_tid.insert(TypeId::of::<T>(), cls);
        r.class_ptr_tid.insert(TypeId::of::<T>(), ptr_ty);
    }
    unsafe {
        crossbind_embind_register_class(
            cls, ptr_ty, const_ptr_ty, std::ptr::null(),
            gat, get_actual_type_thunk::<T> as *const () as usize,
            std::ptr::null(), 0,
            std::ptr::null(), 0,
            name_ptr, dtor_sig, dtor_thunk::<T> as *const () as usize,
        );
    }
    ClassBuilder { cls, ptr_ty, smart_ptr_ty: None, _t: std::marker::PhantomData }
}

impl<T: 'static> ClassBuilder<T> {
    /// A field that reads and writes as a JS property. The getter and setter are plain shim
    /// functions over the instance, so a private field can be exposed through accessors too.
    pub fn property<F: WireType>(self, name: &str, getter: fn(&mut T) -> F, setter: fn(&mut T, F)) -> Self {
        let (name_ptr, getter_sig, setter_sig);
        {
            let mut r = registry().lock().unwrap();
            name_ptr = r.cstr(name);
            getter_sig = r.cstr(&format!("{}pp", F::SIG));
            setter_sig = r.cstr(&format!("vpp{}", F::SIG));
        }
        unsafe {
            crossbind_embind_register_class_property(
                self.cls, name_ptr,
                F::tid(), getter_sig, property_getter::<T, F> as *const () as usize, getter as *mut c_void,
                F::tid(), setter_sig, property_setter::<T, F> as *const () as usize, setter as *mut c_void,
            );
        }
        self
    }

    /// Registers a smart-pointer type for this class so factory functions can return an
    /// object that JS owns and frees on delete(). Call before `.createN`.
    pub fn smart_ptr(mut self, name: &str) -> Self {
        let (ptr_ty, name_ptr, gp_sig, ctor_sig, share_sig, dtor_sig);
        {
            let mut r = registry().lock().unwrap();
            ptr_ty = r.tid();
            name_ptr = r.cstr(name);
            gp_sig = r.cstr("pp");
            ctor_sig = r.cstr("pp");
            share_sig = r.cstr("pp");
            dtor_sig = r.cstr("vp");
        }
        unsafe {
            crossbind_embind_register_smart_ptr(
                ptr_ty, self.cls, name_ptr, 0, // sharing_policy::NONE
                gp_sig, smart_identity as *const () as usize,
                ctor_sig, smart_identity as *const () as usize,
                share_sig, smart_identity as *const () as usize,
                dtor_sig, dtor_thunk::<T> as *const () as usize,
            );
        }
        self.smart_ptr_ty = Some(ptr_ty);
        registry().lock().unwrap().owned_ptr_tid.insert(TypeId::of::<T>(), ptr_ty);
        self
    }

    /// Shared-ownership variant (`Arc<T>` surfaces): same identity wire, but registered with
    /// embind's INTRUSIVE sharing - share bumps the Arc strong count and delete() drops one,
    /// so several JS handles may co-own one Rust object. Every producing path of such a class
    /// must allocate via Arc (constructor_arcN / create_arcN / Arc-allocating _ptr shims).
    pub fn smart_ptr_shared(mut self, name: &str) -> Self {
        let (ptr_ty, name_ptr, gp_sig, ctor_sig, share_sig, dtor_sig);
        {
            let mut r = registry().lock().unwrap();
            ptr_ty = r.tid();
            name_ptr = r.cstr(name);
            gp_sig = r.cstr("pp");
            ctor_sig = r.cstr("pp");
            share_sig = r.cstr("pp");
            dtor_sig = r.cstr("vp");
            r.shared_ptr_tid.insert(TypeId::of::<T>(), ptr_ty);
        }
        unsafe {
            crossbind_embind_register_smart_ptr(
                ptr_ty, self.cls, name_ptr, 1, // sharing_policy::INTRUSIVE
                gp_sig, smart_identity as *const () as usize,
                ctor_sig, smart_identity as *const () as usize,
                share_sig, arc_share_thunk::<T> as *const () as usize,
                dtor_sig, arc_dtor_thunk::<T> as *const () as usize,
            );
        }
        self.smart_ptr_ty = Some(ptr_ty);
        self
    }
}

// embind models a vector as a class with size/get/push_back methods, so this is pure
// composition over class_/constructor0/function1 - no new registration ABI.
fn vec_new<T: 'static>() -> Vec<T> { Vec::new() }
fn vec_size<T: 'static>(v: &mut Vec<T>) -> i32 { v.len() as i32 }
fn vec_get<T: Copy + 'static>(v: &mut Vec<T>, i: i32) -> T { v[i as usize] }
fn vec_push<T: 'static>(v: &mut Vec<T>, x: T) { v.push(x); }   // void return

/// Registers `Vec<T>` as a JS class named `name` with `size()`, `get(i)`, `push_back(v)`.
pub fn register_vector<T: WireType + Copy>(name: &str) {
    class_::<Vec<T>>(name)
        .constructor0(vec_new::<T>)
        .function0("size", vec_size::<T>)
        .function1("get", vec_get::<T>)
        .function1("push_back", vec_push::<T>);
}

// N-arity static factories: a class function that returns the smart-pointer-owned object.
macro_rules! factories {
    ($( $method:ident / $invoker:ident : $($arg:ident),* ; )*) => {
        $(
            extern "C" fn $invoker<T: 'static $(, $arg: WireType)*>(
                method: usize $(, $arg: <$arg as WireType>::Wire)*
            ) -> *mut T {
                let f: fn($($arg),*) -> T = unsafe { core::mem::transmute(method) };
                Box::into_raw(Box::new(f($(<$arg as WireType>::from_wire($arg)),*)))
            }
        )*
        impl<T: 'static> ClassBuilder<T> {
            $(
                pub fn $method<$($arg: WireType),*>(self, name: &str, f: fn($($arg),*) -> T) -> Self {
                    let ret = self.smart_ptr_ty.expect("call .smart_ptr(name) before a factory");
                    let mut sig = String::from("pp");
                    let mut args = vec![ret];
                    $( sig.push(<$arg as WireType>::SIG); args.push(<$arg as WireType>::tid()); )*
                    let (argc, arg_ptr, name_ptr, sig_ptr);
                    {
                        let mut r = registry().lock().unwrap();
                        argc = args.len() as u32;
                        arg_ptr = r.argtypes(args);
                        name_ptr = r.cstr(name);
                        sig_ptr = r.cstr(&sig);
                    }
                    unsafe {
                        crossbind_embind_register_class_class_function(
                            self.cls, name_ptr, argc, arg_ptr, sig_ptr,
                            $invoker::<T $(, $arg)*> as *const () as usize, f as *const () as usize, false, false,
                        );
                    }
                    self
                }
            )*
        }
    };
}
factories! {
    create0 / factory_invoker0 : ;
    create1 / factory_invoker1 : A0;
    create2 / factory_invoker2 : A0, A1;
    create3 / factory_invoker3 : A0, A1, A2;
    create4 / factory_invoker4 : A0, A1, A2, A3;
    create5 / factory_invoker5 : A0, A1, A2, A3, A4;
    create6 / factory_invoker6 : A0, A1, A2, A3, A4, A5;
}

// Arc-allocating factories for shared classes: identical registration shape, but the object
// is stored as an Arc::into_raw pointer so delete()/share stay strong-count based.
macro_rules! arc_factories {
    ($( $method:ident / $invoker:ident : $($arg:ident),* ; )*) => {
        $(
            extern "C" fn $invoker<T: 'static $(, $arg: WireType)*>(
                method: usize $(, $arg: <$arg as WireType>::Wire)*
            ) -> *mut T {
                let f: fn($($arg),*) -> std::sync::Arc<T> = unsafe { core::mem::transmute(method) };
                std::sync::Arc::into_raw(f($(<$arg as WireType>::from_wire($arg)),*)) as *mut T
            }
        )*
        impl<T: 'static> ClassBuilder<T> {
            $(
                pub fn $method<$($arg: WireType),*>(self, name: &str, f: fn($($arg),*) -> std::sync::Arc<T>) -> Self {
                    let ret = self.smart_ptr_ty.expect("call .smart_ptr_shared(name) before an arc factory");
                    let mut sig = String::from("pp");
                    let mut args = vec![ret];
                    $( sig.push(<$arg as WireType>::SIG); args.push(<$arg as WireType>::tid()); )*
                    let (argc, arg_ptr, name_ptr, sig_ptr);
                    {
                        let mut r = registry().lock().unwrap();
                        argc = args.len() as u32;
                        arg_ptr = r.argtypes(args);
                        name_ptr = r.cstr(name);
                        sig_ptr = r.cstr(&sig);
                    }
                    unsafe {
                        crossbind_embind_register_class_class_function(
                            self.cls, name_ptr, argc, arg_ptr, sig_ptr,
                            $invoker::<T $(, $arg)*> as *const () as usize, f as *const () as usize, false, false,
                        );
                    }
                    self
                }
            )*
        }
    };
}
arc_factories! {
    create_arc0 / arc_factory_invoker0 : ;
    create_arc1 / arc_factory_invoker1 : A0;
    create_arc2 / arc_factory_invoker2 : A0, A1;
}

// N-arity constructors: one monomorphized invoker + builder method per argument count.
macro_rules! constructors {
    ($( $method:ident / $invoker:ident : $($arg:ident),* ; )*) => {
        $(
            extern "C" fn $invoker<T: 'static $(, $arg: WireType)*>(
                ctor: usize $(, $arg: <$arg as WireType>::Wire)*
            ) -> *mut T {
                let f: fn($($arg),*) -> T = unsafe { core::mem::transmute(ctor) };
                Box::into_raw(Box::new(f($(<$arg as WireType>::from_wire($arg)),*)))
            }
        )*
        impl<T: 'static> ClassBuilder<T> {
            $(
                pub fn $method<$($arg: WireType),*>(self, f: fn($($arg),*) -> T) -> Self {
                    let mut sig = String::from("pp");
                    let mut args = vec![self.ptr_ty];
                    $( sig.push(<$arg as WireType>::SIG); args.push(<$arg as WireType>::tid()); )*
                    let (argc, arg_ptr, sig_ptr);
                    {
                        let mut r = registry().lock().unwrap();
                        argc = args.len() as u32;
                        arg_ptr = r.argtypes(args);
                        sig_ptr = r.cstr(&sig);
                    }
                    unsafe {
                        crossbind_embind_register_class_constructor(
                            self.cls, argc, arg_ptr, sig_ptr,
                            $invoker::<T $(, $arg)*> as *const () as usize, f as *const () as usize,
                        );
                    }
                    self
                }
            )*
        }
    };
}
constructors! {
    constructor0 / ctor_invoker0 : ;
    constructor1 / ctor_invoker1 : A0;
    constructor2 / ctor_invoker2 : A0, A1;
    constructor3 / ctor_invoker3 : A0, A1, A2;
    constructor4 / ctor_invoker4 : A0, A1, A2, A3;
    constructor5 / ctor_invoker5 : A0, A1, A2, A3, A4;
    constructor6 / ctor_invoker6 : A0, A1, A2, A3, A4, A5;
}

// Raw-pointer ctor variants for fallible `new`: the shim boxes the value itself (or raises and
// returns null), so `Result<Self, E>` rides the same registration ABI as a plain constructor.
macro_rules! constructors_ptr {
    ($( $method:ident / $invoker:ident : $($arg:ident),* ; )*) => {
        $(
            extern "C" fn $invoker<T: 'static $(, $arg: WireType)*>(
                ctor: usize $(, $arg: <$arg as WireType>::Wire)*
            ) -> *mut T {
                let f: fn($($arg),*) -> *mut T = unsafe { core::mem::transmute(ctor) };
                f($(<$arg as WireType>::from_wire($arg)),*)
            }
        )*
        impl<T: 'static> ClassBuilder<T> {
            $(
                pub fn $method<$($arg: WireType),*>(self, f: fn($($arg),*) -> *mut T) -> Self {
                    let mut sig = String::from("pp");
                    let mut args = vec![self.ptr_ty];
                    $( sig.push(<$arg as WireType>::SIG); args.push(<$arg as WireType>::tid()); )*
                    let (argc, arg_ptr, sig_ptr);
                    {
                        let mut r = registry().lock().unwrap();
                        argc = args.len() as u32;
                        arg_ptr = r.argtypes(args);
                        sig_ptr = r.cstr(&sig);
                    }
                    unsafe {
                        crossbind_embind_register_class_constructor(
                            self.cls, argc, arg_ptr, sig_ptr,
                            $invoker::<T $(, $arg)*> as *const () as usize, f as *const () as usize,
                        );
                    }
                    self
                }
            )*
        }
    };
}
constructors_ptr! {
    constructor_ptr0 / ctor_ptr_invoker0 : ;
    constructor_ptr1 / ctor_ptr_invoker1 : A0;
    constructor_ptr2 / ctor_ptr_invoker2 : A0, A1;
    constructor_ptr3 / ctor_ptr_invoker3 : A0, A1, A2;
    constructor_ptr4 / ctor_ptr_invoker4 : A0, A1, A2, A3;
    constructor_ptr5 / ctor_ptr_invoker5 : A0, A1, A2, A3, A4;
    constructor_ptr6 / ctor_ptr_invoker6 : A0, A1, A2, A3, A4, A5;
}

// Raw-pointer factory variants: `Result<Self, E>` raises on Err, `Option<Self>` returns null
// (the consumer maps a null smart pointer to JS null).
macro_rules! factories_ptr {
    ($( $method:ident / $invoker:ident : $($arg:ident),* ; )*) => {
        $(
            extern "C" fn $invoker<T: 'static $(, $arg: WireType)*>(
                method: usize $(, $arg: <$arg as WireType>::Wire)*
            ) -> *mut T {
                let f: fn($($arg),*) -> *mut T = unsafe { core::mem::transmute(method) };
                f($(<$arg as WireType>::from_wire($arg)),*)
            }
        )*
        impl<T: 'static> ClassBuilder<T> {
            $(
                pub fn $method<$($arg: WireType),*>(self, name: &str, f: fn($($arg),*) -> *mut T) -> Self {
                    let ret = self.smart_ptr_ty.expect("call .smart_ptr(name) before a factory");
                    let mut sig = String::from("pp");
                    let mut args = vec![ret];
                    $( sig.push(<$arg as WireType>::SIG); args.push(<$arg as WireType>::tid()); )*
                    let (argc, arg_ptr, name_ptr, sig_ptr);
                    {
                        let mut r = registry().lock().unwrap();
                        argc = args.len() as u32;
                        arg_ptr = r.argtypes(args);
                        name_ptr = r.cstr(name);
                        sig_ptr = r.cstr(&sig);
                    }
                    unsafe {
                        crossbind_embind_register_class_class_function(
                            self.cls, name_ptr, argc, arg_ptr, sig_ptr,
                            $invoker::<T $(, $arg)*> as *const () as usize, f as *const () as usize, false, false,
                        );
                    }
                    self
                }
            )*
        }
    };
}
factories_ptr! {
    create_ptr0 / factory_ptr_invoker0 : ;
    create_ptr1 / factory_ptr_invoker1 : A0;
    create_ptr2 / factory_ptr_invoker2 : A0, A1;
    create_ptr3 / factory_ptr_invoker3 : A0, A1, A2;
    create_ptr4 / factory_ptr_invoker4 : A0, A1, A2, A3;
    create_ptr5 / factory_ptr_invoker5 : A0, A1, A2, A3, A4;
    create_ptr6 / factory_ptr_invoker6 : A0, A1, A2, A3, A4, A5;
}

// N-arity instance methods.
macro_rules! functions {
    ($( $method:ident / $invoker:ident : $($arg:ident),* ; )*) => {
        $(
            extern "C" fn $invoker<T: 'static $(, $arg: WireType)*, R: WireType>(
                ctx: usize, this: *mut T $(, $arg: <$arg as WireType>::Wire)*
            ) -> <R as WireType>::Wire {
                let f: fn(&mut T $(, $arg)*) -> R = unsafe { core::mem::transmute(ctx) };
                f(unsafe { &mut *this } $(, <$arg as WireType>::from_wire($arg))*).to_wire()
            }
        )*
        impl<T: 'static> ClassBuilder<T> {
            $(
                pub fn $method<$($arg: WireType,)* R: WireType>(self, name: &str, f: fn(&mut T $(, $arg)*) -> R) -> Self {
                    let mut sig = String::new();
                    sig.push(R::SIG); sig.push('p'); sig.push('p');
                    let mut args = vec![R::tid(), self.ptr_ty];
                    $( sig.push(<$arg as WireType>::SIG); args.push(<$arg as WireType>::tid()); )*
                    let (argc, arg_ptr, name_ptr, sig_ptr);
                    {
                        let mut r = registry().lock().unwrap();
                        argc = args.len() as u32;
                        arg_ptr = r.argtypes(args);
                        name_ptr = r.cstr(name);
                        sig_ptr = r.cstr(&sig);
                    }
                    unsafe {
                        crossbind_embind_register_class_function(
                            self.cls, name_ptr, argc, arg_ptr, sig_ptr,
                            $invoker::<T $(, $arg)*, R> as *const () as usize, f as *const () as usize, 0, false, false,
                        );
                    }
                    self
                }
            )*
        }
    };
}
functions! {
    function0 / method_invoker0 : ;
    function1 / method_invoker1 : A0;
    function2 / method_invoker2 : A0, A1;
    function3 / method_invoker3 : A0, A1, A2;
    function4 / method_invoker4 : A0, A1, A2, A3;
    function5 / method_invoker5 : A0, A1, A2, A3, A4;
    function6 / method_invoker6 : A0, A1, A2, A3, A4, A5;
}

// N-arity FREE functions (`Module.name(..)` in JS, no class). embind slices the target off
// exactly like methods, so the adapter bakes + prepends the fn pointer; argTypes = [ret, args..].
macro_rules! free_functions {
    ($( $fname:ident / $invoker:ident : $($arg:ident),* ; )*) => {
        $(
            extern "C" fn $invoker<$($arg: WireType,)* R: WireType>(
                ctx: usize $(, $arg: <$arg as WireType>::Wire)*
            ) -> <R as WireType>::Wire {
                let f: fn($($arg),*) -> R = unsafe { core::mem::transmute(ctx) };
                f($(<$arg as WireType>::from_wire($arg)),*).to_wire()
            }
            pub fn $fname<$($arg: WireType,)* R: WireType>(name: &str, f: fn($($arg),*) -> R) {
                let mut sig = String::new();
                sig.push(R::SIG); sig.push('p');
                let mut args = vec![R::tid()];
                $( sig.push(<$arg as WireType>::SIG); args.push(<$arg as WireType>::tid()); )*
                let (argc, arg_ptr, name_ptr, sig_ptr);
                {
                    let mut r = registry().lock().unwrap();
                    argc = args.len() as u32;
                    arg_ptr = r.argtypes(args);
                    name_ptr = r.cstr(name);
                    sig_ptr = r.cstr(&sig);
                }
                unsafe {
                    crossbind_embind_register_function(
                        name_ptr, argc, arg_ptr, sig_ptr,
                        $invoker::<$($arg,)* R> as *const () as usize, f as *const () as usize, false, false,
                    );
                }
            }
        )*
    };
}
free_functions! {
    fn0 / free_invoker0 : ;
    fn1 / free_invoker1 : A0;
    fn2 / free_invoker2 : A0, A1;
    fn3 / free_invoker3 : A0, A1, A2;
    fn4 / free_invoker4 : A0, A1, A2, A3;
    fn5 / free_invoker5 : A0, A1, A2, A3, A4;
    fn6 / free_invoker6 : A0, A1, A2, A3, A4, A5;
}
