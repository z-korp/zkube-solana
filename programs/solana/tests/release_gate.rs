#![cfg(feature = "sbf-tests")]
//! The release gate against the loader it is: the canonical program and every
//! symbol encoding audit 11 found a hand-written scanner reading differently
//! from the loader. The gate refuses a gated import in each with the gates off,
//! and the same bytes load with the gates on, so it is the gate that decides.

#[path = "../examples/release_gate/loader.rs"]
mod loader;

fn program() -> Vec<u8> {
    let directory =
        std::env::var("SBF_OUT_DIR").expect("SBF_OUT_DIR names the built program's folder");
    std::fs::read(std::path::Path::new(&directory).join("solana.so")).expect("the built program")
}

fn u16_at(elf: &[u8], at: usize) -> usize {
    u16::from_le_bytes(elf[at..at + 2].try_into().unwrap()) as usize
}

fn u64_at(elf: &[u8], at: usize) -> usize {
    u64::from_le_bytes(elf[at..at + 8].try_into().unwrap()) as usize
}

/// The section header the dynamic table's DT_SYMTAB names.
fn symbol_section(elf: &[u8]) -> usize {
    let (start, size, count) = (u64_at(elf, 0x28), u16_at(elf, 0x3a), u16_at(elf, 0x3c));
    (0..count)
        .map(|index| start + index * size)
        .find(|at| u32::from_le_bytes(elf[at + 4..at + 8].try_into().unwrap()) == 11)
        .expect("a dynamic symbol section")
}

/// The PT_DYNAMIC program header.
fn dynamic_header(elf: &[u8]) -> usize {
    let (start, size, count) = (u64_at(elf, 0x20), u16_at(elf, 0x36), u16_at(elf, 0x38));
    (0..count)
        .map(|index| start + index * size)
        .find(|at| u32::from_le_bytes(elf[*at..at + 4].try_into().unwrap()) == 2)
        .expect("a PT_DYNAMIC header")
}

/// The program with its sol_sha256 import renamed to sol_blake3, whose feature
/// gate a cluster may have off.
fn gated(elf: &[u8]) -> Vec<u8> {
    let mut bytes = elf.to_vec();
    let at = bytes
        .windows(11)
        .position(|window| window == b"sol_sha256\0")
        .expect("the sol_sha256 import");
    bytes[at..at + 10].copy_from_slice(b"sol_blake3");
    bytes
}

/// The encodings: as built, the symbol section typed SYMTAB, its entry size
/// zero, and an unaligned PT_DYNAMIC header the loader rejects for the
/// SHT_DYNAMIC section.
fn encodings(elf: &[u8]) -> Vec<(&'static str, Vec<u8>)> {
    let section = symbol_section(elf);
    let mut symtab = elf.to_vec();
    symtab[section + 4..section + 8].copy_from_slice(&2u32.to_le_bytes());
    let mut zero_entry = elf.to_vec();
    zero_entry[section + 0x38..section + 0x40].copy_from_slice(&0u64.to_le_bytes());
    let header = dynamic_header(elf);
    let empty = (65..elf.len() - 16)
        .step_by(2)
        .find(|at| at % 8 != 0 && elf[*at..at + 16].iter().all(|byte| *byte == 0))
        .expect("sixteen empty unaligned bytes");
    let mut unaligned = elf.to_vec();
    unaligned[header + 8..header + 16].copy_from_slice(&(empty as u64).to_le_bytes());
    unaligned[header + 32..header + 40].copy_from_slice(&16u64.to_le_bytes());
    vec![
        ("as built", elf.to_vec()),
        ("symbol section typed SYMTAB", symtab),
        ("symbol entry size zero", zero_entry),
        ("unaligned PT_DYNAMIC", unaligned),
    ]
}

#[test]
fn the_release_gate_deploys_the_program_with_every_feature_gate_off() {
    let elf = program();
    for (encoding, bytes) in encodings(&elf) {
        assert_eq!(
            loader::deploy(&bytes, false),
            Ok(()),
            "{encoding}, every gate off"
        );
        assert_eq!(
            loader::deploy(&bytes, true),
            Ok(()),
            "{encoding}, every gate on"
        );
    }
}

#[test]
fn the_release_gate_refuses_a_gated_import_in_every_symbol_encoding() {
    for (encoding, bytes) in encodings(&gated(&program())) {
        let refused = loader::deploy(&bytes, false);
        assert!(
            refused.is_err(),
            "{encoding}: a gated import must be refused with the gates off"
        );
        assert_eq!(
            loader::deploy(&bytes, true),
            Ok(()),
            "{encoding}: the same bytes load with the gates on"
        );
    }
}
