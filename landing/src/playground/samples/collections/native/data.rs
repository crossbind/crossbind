use std::collections::BTreeMap;

// A Vec arrives as an array, and a map with string keys as an
// object. Bytes cross as a Uint8Array, both ways.
pub fn sorted(mut words: Vec<String>) -> Vec<String> {
    words.sort();
    words
}

pub fn word_lengths(text: &str) -> BTreeMap<String, i32> {
    text.split_whitespace()
        .map(|word| (word.to_string(), word.len() as i32))
        .collect()
}

pub fn invert(bytes: &[u8]) -> Vec<u8> {
    bytes.iter().map(|byte| 255 - byte).collect()
}
