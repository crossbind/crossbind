import { rejecting } from '../expect.mjs';

// Rust numeric types (conformance-rust/src/lib.rs, numbers section). i32/i64/u64/f64/bool are
// the documented set, and so are the narrower integers, f32, usize/isize and char; i128 is not
// carried (embind has no 128-bit type).

export function rustNumberChecks({ add, todo, skip }, s) {
    const rejects = rejecting(add);
    add('rs:num:i32', () => s.confRsI32Echo(-42), -42);
    add('rs:num:i64BigInt', () => s.confRsI64Echo(-9007199254740993n), -9007199254740993n);
    add('rs:num:u64BigInt', () => s.confRsU64Echo(18446744073709551615n), 18446744073709551615n);
    add('rs:num:u64Max', () => s.confRsU64Max(), 18446744073709551615n);
    add('rs:num:i64TakesNumber', () => s.confRsI64Echo(-42), -42n);
    // 2**53 is the first integer JS cannot count past exactly: a silent rounding instead of a throw
    // would hand C++ a different number than the caller wrote.
    rejects('rs:num:i64RejectsUnsafeNumber', () => s.confRsI64Echo(2 ** 53), /BigInt|safe integer|outside/);
    rejects('rs:num:i64RejectsFraction', () => s.confRsI64Echo(1.5), /BigInt|safe integer|outside|integer/);
    add('rs:num:f64', () => s.confRsF64Half(5), 2.5);
    add('rs:num:nan', async () => Number.isNaN(await s.confRsF64Nan()), true);
    add('rs:num:infinity', async () => (await s.confRsF64Inf()) === Infinity, true);
    add('rs:num:bool', () => s.confRsBoolNot(true), false);
    add('rs:num:unitReturn', async () => (await s.confRsUnit(1)) ?? null, null);
    add('rs:num:i8', () => s.confRsI8Echo(-128), -128);
    add('rs:num:i16', () => s.confRsI16Echo(-32768), -32768);
    add('rs:num:u8', () => s.confRsU8Echo(255), 255);
    add('rs:num:u16', () => s.confRsU16Echo(65535), 65535);
    add('rs:num:u32', () => s.confRsU32Echo(4000000000), 4000000000);
    add('rs:num:f32', () => s.confRsF32Echo(0.5), 0.5);
    // usize/isize are pointer-wide: a number on wasm (32 bits), a BigInt on the 64-bit native
    // runtime. Both spellings of the same value pass; see rs:napi:usizeOut.
    add('rs:num:usize', async () => { const v = await s.confRsUsizeEcho(123); return typeof v === 'bigint' ? v === 123n : v === 123; }, true);
    add('rs:num:isize', async () => { const v = await s.confRsIsizeEcho(-123); return typeof v === 'bigint' ? v === -123n : v === -123; }, true);
    // Not carried: embind has no 128-bit type, so a value would have to be split into BigInt
    // words on both sides. napi-rs pays that cost in its own layer.
    skip('rs:num:i128', 'embind has no 128-bit integer type');
    add('rs:num:char', () => s.confRsCharNext('a'), 'b');
}
