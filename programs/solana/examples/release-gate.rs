//! `cargo run -p solana --example release-gate -- <ELF>`: exits 0 only when
//! the pinned loader deploys the ELF with every feature gate off. The release
//! build and the deploy plan run it before they record or quote a program.

#[path = "release_gate/loader.rs"]
mod loader;

fn main() {
    let path = std::env::args().nth(1).expect("usage: release-gate <ELF>");
    let elf = std::fs::read(&path).unwrap_or_else(|error| {
        eprintln!("cannot read {path}: {error}");
        std::process::exit(2);
    });
    match loader::deploy(&elf, false) {
        Ok(()) => println!("the pinned loader deploys {path} with every feature gate off"),
        Err(error) => {
            eprintln!("the pinned loader refuses {path} with every feature gate off: {error}");
            std::process::exit(1);
        }
    }
}
