// crossbind-embind: host-independent FLAT registration C-ABI (the stable contract).
// The producer (embind-rs) binds only to this; each host adapter maps it to its own world.
#pragma once
#include <cstddef>
#include <cstdint>
extern "C" {
typedef const void* CrossbindTid;
typedef void* CrossbindFn;   // raw function pointer (a table index on wasm, a real address natively)

void crossbind_embind_register_class(
    CrossbindTid cls, CrossbindTid ptr_ty, CrossbindTid const_ptr_ty, CrossbindTid base,
    const char* gat_sig, CrossbindFn get_actual_type,
    const char* up_sig, CrossbindFn upcast, const char* down_sig, CrossbindFn downcast,
    const char* name, const char* dtor_sig, CrossbindFn dtor);
void crossbind_embind_register_class_constructor(
    CrossbindTid cls, unsigned argc, const CrossbindTid* arg_types,
    const char* sig, CrossbindFn invoker, CrossbindFn ctor);
void crossbind_embind_register_class_function(
    CrossbindTid cls, const char* name, unsigned argc, const CrossbindTid* arg_types,
    const char* sig, CrossbindFn invoker, void* ctx,
    unsigned is_pure_virtual, bool is_async, bool is_nonnull_return);
void crossbind_embind_register_class_class_function(
    CrossbindTid cls, const char* name, unsigned argc, const CrossbindTid* arg_types,
    const char* sig, CrossbindFn invoker, CrossbindFn method, bool is_async, bool is_nonnull_return);
void crossbind_embind_register_function(
    const char* name, unsigned argc, const CrossbindTid* arg_types,
    const char* sig, CrossbindFn invoker, CrossbindFn function, bool is_async, bool is_nonnull_return);
// Optional returns. Registration is idempotent per adapter (several bridge archives may ask).
// On wasm the wire is an EM_VAL handle (emval helpers live in the web adapter only); on
// native the jsi adapter converts a nullable heap cell itself.
void crossbind_embind_register_optional(CrossbindTid optional_ty, CrossbindTid inner_ty);
CrossbindTid crossbind_tid_optional_int(void);
CrossbindTid crossbind_tid_optional_double(void);
CrossbindTid crossbind_tid_optional_bool(void);
CrossbindTid crossbind_tid_optional_string(void);
void crossbind_embind_register_smart_ptr(
    CrossbindTid ptr_ty, CrossbindTid pointee_ty, const char* name, int sharing_policy,
    const char* gp_sig, CrossbindFn get_pointee, const char* ctor_sig, CrossbindFn constructor,
    const char* share_sig, CrossbindFn share, const char* dtor_sig, CrossbindFn destructor);
void crossbind_embind_register_enum(
    CrossbindTid enum_ty, const char* name, size_t size, bool is_signed, int policy_value);
void crossbind_embind_register_enum_value(CrossbindTid enum_ty, const char* value_name, int value);
void crossbind_embind_raise_error_coded(unsigned char* msg, unsigned char* code);
void crossbind_embind_register_constant(const char* name, const void* ty, double value);
void crossbind_embind_register_class_property(CrossbindTid cls, const char* name,
    CrossbindTid getter_ty, const char* getter_sig, CrossbindFn getter, void* getter_ctx,
    CrossbindTid setter_ty, const char* setter_sig, CrossbindFn setter, void* setter_ctx);
void crossbind_embind_register_value_object(
    CrossbindTid struct_ty, const char* name,
    const char* ctor_sig, CrossbindFn ctor, const char* dtor_sig, CrossbindFn dtor);
void crossbind_embind_register_value_object_field(
    CrossbindTid struct_ty, const char* field_name,
    CrossbindTid getter_ret, const char* getter_sig, CrossbindFn getter, void* getter_ctx,
    CrossbindTid setter_arg, const char* setter_sig, CrossbindFn setter, void* setter_ctx);
void crossbind_embind_finalize_value_object(CrossbindTid struct_ty);
// Registers a binding-init function; the host runs it when its runtime is ready.
void crossbind_embind_register_bindings(void (*init)());
}
