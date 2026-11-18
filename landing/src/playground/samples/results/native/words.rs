// None arrives as null, and an Err as a thrown Error.
pub fn first_long_word(text: &str, min: i32) -> Option<String> {
    text.split_whitespace()
        .find(|word| word.len() as i32 >= min)
        .map(|word| word.to_string())
}

pub fn parse_score(text: &str) -> Result<i32, String> {
    match text.parse::<i32>() {
        Ok(score) if (0..=100).contains(&score) => Ok(score),
        Ok(score) => Err(format!("{score} is out of range")),
        Err(_) => Err(format!("{text} is not a number")),
    }
}
