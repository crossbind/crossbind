pub struct Counter {
    total: i32,
}

impl Counter {
    pub fn new(start: i32) -> Self {
        Counter { total: start }
    }
    pub fn add(&mut self, n: i32) -> i32 {
        self.total += n;
        self.total
    }
    pub fn total(&self) -> i32 {
        self.total
    }
}
