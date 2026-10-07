//! `cargo run -p solana --example daily-rules-hash -- <day>`: prints the
//! rules hash a Daily of that day carries when this checkout's program
//! prepared it. The operator's checks compare it with the Daily on the
//! cluster to tell which catalogue it was prepared under.

#[path = "daily_rules/hash.rs"]
mod hash;

fn main() {
    let day: u32 = std::env::args()
        .nth(1)
        .and_then(|day| day.parse().ok())
        .expect("usage: daily-rules-hash <day>");
    let hex: String = hash::prepared(day).iter().map(|byte| format!("{byte:02x}")).collect();
    println!("{hex}");
}
