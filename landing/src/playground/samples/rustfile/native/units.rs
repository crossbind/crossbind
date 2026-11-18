// A pub fn is a function in JavaScript, and a pub struct with
// its impl is a class. snake_case names arrive in camelCase.
pub fn word_count(text: &str) -> i32 {
    text.split_whitespace().count() as i32
}

pub struct Celsius {
    degrees: f64,
}

impl Celsius {
    pub fn new(degrees: f64) -> Self {
        Celsius { degrees }
    }

    pub fn to_fahrenheit(&self) -> f64 {
        self.degrees * 9.0 / 5.0 + 32.0
    }
}
