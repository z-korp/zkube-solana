use sha2::{Digest, Sha256};

/// A SHA-256 implementation over a sequence of byte slices.
///
/// Implementing this trait for a zero-sized type lets a chain wrapper replace
/// software hashing with its native syscall while retaining identical inputs.
pub trait Sha256Provider {
    fn hashv(parts: &[&[u8]]) -> [u8; 32];
}

/// Portable SHA-256 used by native, test, Cairo-vector, and WASM tooling.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SoftwareSha256;

impl Sha256Provider for SoftwareSha256 {
    fn hashv(parts: &[&[u8]]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        for part in parts {
            hasher.update(part);
        }
        hasher.finalize().into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashv_does_not_insert_part_boundaries() {
        assert_eq!(
            SoftwareSha256::hashv(&[b"zkube", b"-world"]),
            SoftwareSha256::hashv(&[b"zkube-world"])
        );
    }
}
