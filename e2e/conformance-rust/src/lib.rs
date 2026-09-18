//! Every Rust construct the conformance kit measures, as plain Rust: the bridge generator
//! reads this file. Names carry a ConfRs / conf_rs_ prefix because bindings share one embind
//! namespace with every linked package. Shapes the generator does not carry yet are here on
//! purpose: their checks are `todo` entries in spec/sections/rust and turn green once the
//! generator learns them.
use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---- numbers ----
pub fn conf_rs_i32_echo(v: i32) -> i32 { v }
pub fn conf_rs_i64_echo(v: i64) -> i64 { v }
pub fn conf_rs_u64_echo(v: u64) -> u64 { v }
pub fn conf_rs_u64_max() -> u64 { u64::MAX }
pub fn conf_rs_f64_half(v: f64) -> f64 { v / 2.0 }
pub fn conf_rs_f64_nan() -> f64 { f64::NAN }
pub fn conf_rs_f64_inf() -> f64 { f64::INFINITY }
pub fn conf_rs_bool_not(v: bool) -> bool { !v }
pub fn conf_rs_unit(v: i32) { let _ = v; }
pub fn conf_rs_i8_echo(v: i8) -> i8 { v }
pub fn conf_rs_i16_echo(v: i16) -> i16 { v }
pub fn conf_rs_u8_echo(v: u8) -> u8 { v }
pub fn conf_rs_u16_echo(v: u16) -> u16 { v }
pub fn conf_rs_u32_echo(v: u32) -> u32 { v }
pub fn conf_rs_f32_echo(v: f32) -> f32 { v }
pub fn conf_rs_usize_echo(v: usize) -> usize { v }
pub fn conf_rs_isize_echo(v: isize) -> isize { v }
pub fn conf_rs_i128_echo(v: i128) -> i128 { v }
pub fn conf_rs_char_next(c: char) -> char { char::from_u32(c as u32 + 1).unwrap_or(c) }

// ---- strings ----
pub fn conf_rs_str_len(s: &str) -> i32 { s.chars().count() as i32 }
pub fn conf_rs_string_ref_len(s: &String) -> i32 { s.len() as i32 }
pub fn conf_rs_string_owned(s: String) -> String { s.to_uppercase() }
pub fn conf_rs_string_reverse(s: &str) -> String { s.chars().rev().collect() }
pub fn conf_rs_string_opt(flag: bool) -> Option<String> { if flag { Some("some".to_string()) } else { None } }
pub fn conf_rs_string_opt_param(s: Option<String>) -> String { s.unwrap_or_else(|| "none".to_string()) }
pub fn conf_rs_str_opt_param(s: Option<&str>) -> i32 { s.map(|v| v.len() as i32).unwrap_or(-1) }
pub fn conf_rs_str_static() -> &'static str { "static" }
pub fn conf_rs_str_cow(s: &str) -> std::borrow::Cow<'static, str> { std::borrow::Cow::Owned(s.to_string()) }
pub fn conf_rs_bytes_sum(b: &[u8]) -> i32 { b.iter().map(|v| *v as i32).sum() }
pub fn conf_rs_bytes_make(n: i32) -> Vec<u8> { (0..n.max(0) as u8).collect() }

// ---- collections ----
pub fn conf_rs_ints_sum(v: Vec<i32>) -> i32 { v.iter().sum() }
pub fn conf_rs_ints_make(n: i32) -> Vec<i32> { (1..=n).collect() }
pub fn conf_rs_f64s_mean(v: Vec<f64>) -> f64 { if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 } }
pub fn conf_rs_bools_all(v: Vec<bool>) -> bool { v.iter().all(|b| *b) }
pub fn conf_rs_strings_join(v: Vec<String>) -> String { v.join("+") }
pub fn conf_rs_strings_make(n: i32) -> Vec<String> { (0..n).map(|i| format!("s{i}")).collect() }
pub fn conf_rs_points_len(v: Vec<ConfRsPoint>) -> i32 { v.len() as i32 }
pub fn conf_rs_slice_sum(v: &[i32]) -> i32 { v.iter().sum() }
pub fn conf_rs_array_sum(v: [i32; 3]) -> i32 { v.iter().sum() }
pub fn conf_rs_tuple_make(a: i32, b: &str) -> (i32, String) { (a, b.to_string()) }
pub fn conf_rs_map_count(m: HashMap<String, i32>) -> i32 { m.values().sum() }
pub fn conf_rs_map_make() -> HashMap<String, i32> { HashMap::from([("a".to_string(), 1), ("b".to_string(), 2)]) }
pub fn conf_rs_nested_sum(v: Vec<Vec<i32>>) -> i32 { v.iter().flatten().sum() }
pub fn conf_rs_ints_opt(flag: bool) -> Option<Vec<i32>> { if flag { Some(vec![1, 2]) } else { None } }

// ---- enums ----
#[repr(i32)]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ConfRsColor {
    Red = 1,
    Green = 2,
    Blue = 4,
}
pub fn conf_rs_color_code(c: ConfRsColor) -> i32 { c as i32 }
pub fn conf_rs_color_from(code: i32) -> ConfRsColor { match code { 1 => ConfRsColor::Red, 2 => ConfRsColor::Green, _ => ConfRsColor::Blue } }
pub fn conf_rs_color_opt(flag: bool) -> Option<ConfRsColor> { if flag { Some(ConfRsColor::Blue) } else { None } }
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ConfRsSmall {
    Low,
    High,
}
pub fn conf_rs_small_flip(s: ConfRsSmall) -> ConfRsSmall { match s { ConfRsSmall::Low => ConfRsSmall::High, ConfRsSmall::High => ConfRsSmall::Low } }
#[derive(Serialize, Deserialize)]
pub enum ConfRsShapeKind {
    Circle(f64),
    Rect { w: f64, h: f64 },
}
pub fn conf_rs_kind_area(k: ConfRsShapeKind) -> f64 { match k { ConfRsShapeKind::Circle(r) => 3.0 * r * r, ConfRsShapeKind::Rect { w, h } => w * h } }

// ---- structs: value objects and classes ----
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
pub struct ConfRsPoint {
    pub x: i32,
    pub y: f64,
}
pub fn conf_rs_point_make(x: i32, y: f64) -> ConfRsPoint { ConfRsPoint { x, y } }
pub fn conf_rs_point_sum(p: ConfRsPoint) -> f64 { p.x as f64 + p.y }
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct ConfRsSegment {
    pub a: ConfRsPoint,
    pub b: ConfRsPoint,
}
pub fn conf_rs_segment_len(s: ConfRsSegment) -> f64 { ((s.b.x - s.a.x) as f64).abs() + (s.b.y - s.a.y).abs() }
pub struct ConfRsPlain {
    pub name: String,
    pub count: i32,
}
pub fn conf_rs_plain_make(name: &str, count: i32) -> ConfRsPlain { ConfRsPlain { name: name.to_string(), count } }
pub fn conf_rs_plain_count(p: &ConfRsPlain) -> i32 { p.count }

pub struct ConfRsBox {
    value: i32,
    tags: Vec<String>,
}
impl ConfRsBox {
    pub fn new(value: i32) -> Self { ConfRsBox { value, tags: Vec::new() } }
    pub fn from_text(text: &str) -> Result<Self, std::num::ParseIntError> { Ok(ConfRsBox::new(text.trim().parse::<i32>()?)) }
    pub fn maybe(value: i32) -> Option<Self> { if value >= 0 { Some(ConfRsBox::new(value)) } else { None } }
    pub fn value(&self) -> i32 { self.value }
    pub fn add(&mut self, by: i32) -> i32 { self.value += by; self.value }
    pub fn tag(&mut self, tag: &str) -> i32 { self.tags.push(tag.to_string()); self.tags.len() as i32 }
    pub fn many(&self, a: i32, b: i32, c: i32, d: i32) -> i32 { self.value + a + b + c + d }
    pub fn too_many(&self, a: i32, b: i32, c: i32, d: i32, e: i32) -> i32 { self.value + a + b + c + d + e }
    pub fn into_value(self) -> i32 { self.value }
    pub fn twin(&self) -> ConfRsBox { ConfRsBox { value: self.value, tags: self.tags.clone() } }
    pub fn chain(&mut self, by: i32) -> &mut Self { self.value += by; self }
    pub fn describe(&self) -> String { format!("box:{}", self.value) }
    pub fn point(&self) -> ConfRsPoint { ConfRsPoint { x: self.value, y: 0.5 } }
    pub fn set_point(&mut self, p: ConfRsPoint) -> f64 { self.value = p.x; p.y }
    pub fn color(&self) -> ConfRsColor { if self.value > 0 { ConfRsColor::Green } else { ConfRsColor::Red } }
    pub fn other_value(&self, other: &ConfRsBox) -> i32 { self.value + other.value }
    pub fn json(&self, v: Value) -> Value { serde_json::json!({ "value": self.value, "input": v }) }
    pub fn label_ref(&self) -> &str { "ref" }
}
impl fmt::Display for ConfRsBox {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "ConfRsBox({})", self.value) }
}
pub struct ConfRsWide {
    total: i32,
}
impl ConfRsWide {
    pub fn new(a: i32, b: i32, c: i32, d: i32) -> Self { ConfRsWide { total: a + b + c + d } }
    pub fn total(&self) -> i32 { self.total }
}
#[derive(Default)]
pub struct ConfRsDefaulted {
    n: i32,
}
impl ConfRsDefaulted {
    pub fn n(&self) -> i32 { self.n }
}

// ---- traits and generics ----
pub trait ConfRsShape {
    fn area(&self) -> f64;
    fn name(&self) -> String { "shape".to_string() }
}
pub struct ConfRsCircle {
    r: f64,
}
impl ConfRsCircle {
    pub fn new(r: f64) -> Self { ConfRsCircle { r } }
    pub fn area_via_trait(&self) -> f64 { ConfRsShape::area(self) }
    pub fn name_via_default(&self) -> String { ConfRsShape::name(self) }
}
impl ConfRsShape for ConfRsCircle {
    fn area(&self) -> f64 { 3.0 * self.r * self.r }
}
pub fn conf_rs_dyn_area(s: &dyn ConfRsShape) -> f64 { s.area() }
pub fn conf_rs_boxed_shape(r: f64) -> Box<dyn ConfRsShape> { Box::new(ConfRsCircle { r }) }
pub fn conf_rs_generic_sum<T: Into<f64>>(a: T, b: T) -> f64 { a.into() + b.into() }
pub fn conf_rs_impl_iter(n: i32) -> impl Iterator<Item = i32> { 0..n }

// ---- errors ----
#[derive(Debug)]
pub struct ConfRsError {
    code: i32,
}
impl fmt::Display for ConfRsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "conf error {}", self.code) }
}
impl std::error::Error for ConfRsError {}
pub fn conf_rs_err_custom(fail: bool) -> Result<i32, ConfRsError> { if fail { Err(ConfRsError { code: 7 }) } else { Ok(1) } }
pub fn conf_rs_err_string(fail: bool) -> Result<String, String> { if fail { Err("text failed".to_string()) } else { Ok("text ok".to_string()) } }
pub fn conf_rs_err_unit(fail: bool) -> Result<(), String> { if fail { Err("unit failed".to_string()) } else { Ok(()) } }
pub fn conf_rs_err_boxed(fail: bool) -> Result<i32, Box<dyn std::error::Error>> { if fail { Err(Box::new(ConfRsError { code: 9 })) } else { Ok(2) } }
pub fn conf_rs_err_option(fail: bool) -> Result<Option<i32>, String> { if fail { Err("opt failed".to_string()) } else { Ok(Some(3)) } }
pub fn conf_rs_err_point(fail: bool) -> Result<ConfRsPoint, String> { if fail { Err("point failed".to_string()) } else { Ok(ConfRsPoint { x: 1, y: 1.5 }) } }

// ---- ownership ----
static DROPS: AtomicI32 = AtomicI32::new(0);
pub struct ConfRsTracked {
    id: i32,
}
impl ConfRsTracked {
    pub fn new(id: i32) -> Self { ConfRsTracked { id } }
    pub fn id(&self) -> i32 { self.id }
}
impl Drop for ConfRsTracked {
    fn drop(&mut self) { DROPS.fetch_add(1, Ordering::SeqCst); }
}
pub fn conf_rs_drop_count() -> i32 { DROPS.load(Ordering::SeqCst) }

pub struct ConfRsShared {
    label: String,
    hits: Mutex<i32>,
}
impl ConfRsShared {
    pub fn create(label: &str) -> Arc<Self> { Arc::new(ConfRsShared { label: label.to_string(), hits: Mutex::new(0) }) }
    pub fn label(&self) -> String { self.label.clone() }
    pub fn hit(&self) -> i32 { let mut h = self.hits.lock().unwrap(); *h += 1; *h }
    pub fn strong(&self) -> i32 { 0 }
}
pub fn conf_rs_shared_dup(s: Arc<ConfRsShared>) -> Arc<ConfRsShared> { s }
pub fn conf_rs_shared_label(s: Arc<ConfRsShared>) -> String { s.label.clone() }
pub fn conf_rs_shared_count(s: Arc<ConfRsShared>) -> i32 { Arc::strong_count(&s) as i32 }
pub fn conf_rs_shared_maybe(flag: bool) -> Option<Arc<ConfRsShared>> { if flag { Some(ConfRsShared::create("maybe")) } else { None } }

pub struct ConfRsCell {
    inner: std::rc::Rc<std::cell::RefCell<i32>>,
}
impl ConfRsCell {
    pub fn new(v: i32) -> Self { ConfRsCell { inner: std::rc::Rc::new(std::cell::RefCell::new(v)) } }
    pub fn bump(&self) -> i32 { *self.inner.borrow_mut() += 1; *self.inner.borrow() }
}

// ---- callbacks, async ----
pub fn conf_rs_apply(f: impl Fn(i32) -> i32, x: i32) -> i32 { f(x) }
pub fn conf_rs_apply_boxed(f: Box<dyn Fn(i32) -> i32>, x: i32) -> i32 { f(x) }
pub async fn conf_rs_async_double(x: i32) -> i32 { x * 2 }

// ---- statics, modules, visibility ----
pub const CONF_RS_LIMIT: i32 = 42;
pub static CONF_RS_NAME: &str = "confrust";
pub mod conf_rs_geo {
    pub fn area(w: f64, h: f64) -> f64 { w * h }
}
pub(crate) fn conf_rs_hidden() -> i32 { 7 }
pub fn conf_rs_uses_hidden() -> i32 { conf_rs_hidden() + CONF_RS_LIMIT + CONF_RS_NAME.len() as i32 + conf_rs_geo::area(2.0, 3.0) as i32 }

// ---- serde ----
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct ConfRsRecord {
    pub id: i32,
    pub name: String,
}
pub fn conf_rs_record_echo(r: ConfRsRecord) -> ConfRsRecord { ConfRsRecord { id: r.id + 1, name: r.name } }
pub fn conf_rs_record_json(v: Value) -> Value {
    let r: ConfRsRecord = serde_json::from_value(v).unwrap_or_default();
    serde_json::to_value(ConfRsRecord { id: r.id + 1, name: r.name }).unwrap_or(Value::Null)
}

// ---- napi-rs parity ----
// Shapes napi.rs binds (docs/concepts/type-conversions and friends) that the kit had no entry
// for. Every check is a todo until the generator carries the shape.
use std::collections::{BTreeMap, BTreeSet, HashSet};
pub fn conf_rs_set_make(n: i32) -> HashSet<i32> { (0..n).collect() }
pub fn conf_rs_set_len(s: HashSet<i32>) -> i32 { s.len() as i32 }
pub fn conf_rs_bset_sorted(s: BTreeSet<i32>) -> Vec<i32> { s.into_iter().collect() }
pub fn conf_rs_bmap_first(m: BTreeMap<String, i32>) -> String { m.keys().next().cloned().unwrap_or_default() }
pub fn conf_rs_opt_point(p: Option<ConfRsPoint>) -> f64 { p.map(|v| v.x as f64 + v.y).unwrap_or(-1.0) }
pub fn conf_rs_opt_color(c: Option<ConfRsColor>) -> i32 { c.map(|v| v as i32).unwrap_or(-1) }
pub fn conf_rs_opt_box(b: Option<&ConfRsBox>) -> i32 { b.map(|v| v.value).unwrap_or(-1) }
#[derive(Serialize, Deserialize)]
pub enum ConfRsEither {
    Num(i32),
    Text(String),
}
pub fn conf_rs_either_describe(e: ConfRsEither) -> String {
    match e { ConfRsEither::Num(n) => format!("num:{n}"), ConfRsEither::Text(t) => format!("text:{t}") }
}
pub fn conf_rs_either_make(flag: bool) -> ConfRsEither { if flag { ConfRsEither::Num(7) } else { ConfRsEither::Text("t".to_string()) } }
#[derive(Serialize, Deserialize)]
pub struct ConfRsPair(pub i32, pub String);
pub fn conf_rs_pair_make(n: i32, s: &str) -> ConfRsPair { ConfRsPair(n, s.to_string()) }
pub fn conf_rs_pair_first(p: ConfRsPair) -> i32 { p.0 }
pub struct ConfRsMeters(pub f64);
pub fn conf_rs_meters_double(m: ConfRsMeters) -> ConfRsMeters { ConfRsMeters(m.0 * 2.0) }
pub enum ConfRsLevel {
    Low,
    High,
}
pub fn conf_rs_level_name(l: ConfRsLevel) -> String { match l { ConfRsLevel::Low => "low".to_string(), ConfRsLevel::High => "high".to_string() } }
pub struct ConfRsAccount {
    pub owner: String,
    pub balance: i32,
    secret: i32,
}
impl ConfRsAccount {
    pub fn new(owner: &str, balance: i32) -> Self { ConfRsAccount { owner: owner.to_string(), balance, secret: 9 } }
    pub fn secret_plus(&self, n: i32) -> i32 { self.secret + n }
    pub fn limit(&self) -> i32 { self.balance * 2 }
    pub fn set_limit(&mut self, limit: i32) { self.balance = limit / 2; }
}
pub fn conf_rs_bytes_view(b: &[u8]) -> i32 { b.len() as i32 }
pub fn conf_rs_floats_sum(v: &[f64]) -> f64 { v.iter().sum() }
pub fn conf_rs_bytes_owned(n: i32) -> Vec<u8> { vec![7; n.max(0) as usize] }
#[derive(Debug)]
pub struct ConfRsCodedError {
    pub code: String,
    pub message: String,
}
impl fmt::Display for ConfRsCodedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{}", self.message) }
}
impl std::error::Error for ConfRsCodedError {}
// napi-rs reads an error's code off `AsRef<str>`; crossbind follows that convention.
impl AsRef<str> for ConfRsCodedError {
    fn as_ref(&self) -> &str { &self.code }
}
pub fn conf_rs_coded_err() -> Result<i32, ConfRsCodedError> { Err(ConfRsCodedError { code: "E_CONF".to_string(), message: "coded failure".to_string() }) }
pub fn conf_rs_panics(flag: bool) -> i32 { if flag { panic!("kit panic") } else { 1 } }
pub fn conf_rs_apply_typed(f: impl Fn(i32, &str) -> String, n: i32) -> String { f(n, "x") }
pub fn conf_rs_call_later(f: Box<dyn Fn(i32) + Send + 'static>, n: i32) { f(n) }
pub struct ConfRsCounterIter {
    n: i32,
    max: i32,
}
impl ConfRsCounterIter {
    pub fn new(max: i32) -> Self { ConfRsCounterIter { n: 0, max } }
}
impl Iterator for ConfRsCounterIter {
    type Item = i32;
    fn next(&mut self) -> Option<i32> { if self.n < self.max { self.n += 1; Some(self.n) } else { None } }
}
pub fn conf_rs_f32_out() -> f32 { 0.25 }
pub fn conf_rs_char_out() -> char { 'z' }
pub fn conf_rs_usize_out() -> usize { 5 }
pub fn conf_rs_i64_number(v: i64) -> i64 { v + 1 }
pub fn conf_rs_json_big() -> Value { serde_json::json!({ "big": 9007199254740993_i64 }) }
