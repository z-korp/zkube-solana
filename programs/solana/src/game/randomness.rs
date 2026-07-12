use sha2::{Digest, Sha256};

use super::{Grid, GridError, Row, GRID_WIDTH};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BlockWeights {
    /// Weights for empty, size-1, size-2, size-3, and size-4 segments.
    pub values: [u16; 5],
}

impl Default for BlockWeights {
    fn default() -> Self {
        Self {
            values: [20, 25, 22, 18, 15],
        }
    }
}

impl BlockWeights {
    pub fn validate(self) -> Result<(), RandomnessError> {
        if self.values.iter().all(|weight| *weight == 0) {
            return Err(RandomnessError::ZeroTotalWeight);
        }
        if self.values[0] == 0 {
            return Err(RandomnessError::NoEmptyWeight);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RandomnessError {
    ZeroTotalWeight,
    NoEmptyWeight,
    InvalidGeneratedRow(GridError),
}

/// Convert one verified VRF result into exactly one playable row.
///
/// The request callback is responsible for authenticating the oracle and
/// binding `request_counter` to the run. This pure mapping is deterministic so
/// it can be reproduced by tests/auditors. It always emits a coherent row with
/// at least one empty cell, preventing an unavoidable instant clear/full row.
pub fn row_from_vrf(
    randomness: [u8; 32],
    request_counter: u32,
    weights: BlockWeights,
) -> Result<Row, RandomnessError> {
    weights.validate()?;
    let total = weights
        .values
        .iter()
        .map(|weight| *weight as u32)
        .sum::<u32>();
    let mut row = [0u8; GRID_WIDTH];
    let mut column = 0usize;
    let mut draw = 0u32;
    let mut has_empty = false;
    let mut attempts = 0u16;

    while column < GRID_WIDTH {
        attempts = attempts.saturating_add(1);
        if attempts > 128 {
            // Bounded compute fallback for pathological admin-configured
            // weights. Empty cells are always coherent and playable.
            row[column..].fill(0);
            has_empty = true;
            break;
        }
        let remaining = GRID_WIDTH - column;
        let roll = random_u32(randomness, request_counter, draw) % total;
        draw = draw.saturating_add(1);
        let segment = weighted_segment(roll, weights.values);
        let size = if segment == 0 { 1 } else { segment as usize };
        if size > remaining || (size == remaining && !has_empty && segment != 0) {
            continue;
        }
        if segment == 0 {
            has_empty = true;
            column += 1;
        } else {
            row[column..column + size].fill(segment);
            column += size;
        }
    }

    // The fit rule above guarantees this, but keep the invariant local even if
    // weight/selection behavior changes later.
    if !has_empty {
        row[GRID_WIDTH - 1] = 0;
    }
    Grid::validate_row(&row).map_err(RandomnessError::InvalidGeneratedRow)?;
    Ok(row)
}

fn random_u32(randomness: [u8; 32], request_counter: u32, draw: u32) -> u32 {
    let digest = Sha256::new()
        .chain_update(b"zkube-row-v1")
        .chain_update(randomness)
        .chain_update(request_counter.to_le_bytes())
        .chain_update(draw.to_le_bytes())
        .finalize();
    u32::from_le_bytes(
        digest[..4]
            .try_into()
            .expect("SHA-256 prefix has four bytes"),
    )
}

fn weighted_segment(roll: u32, weights: [u16; 5]) -> u8 {
    let mut cursor = 0u32;
    for (segment, weight) in weights.into_iter().enumerate() {
        cursor = cursor.saturating_add(weight as u32);
        if roll < cursor {
            return segment as u8;
        }
    }
    4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_mapping_is_deterministic_playable_and_counter_scoped() {
        let randomness = [7u8; 32];
        let first = row_from_vrf(randomness, 1, BlockWeights::default()).unwrap();
        assert_eq!(
            first,
            row_from_vrf(randomness, 1, BlockWeights::default()).unwrap()
        );
        assert_ne!(
            first,
            row_from_vrf(randomness, 2, BlockWeights::default()).unwrap()
        );
        assert!(first.contains(&0));
        Grid::validate_row(&first).unwrap();
    }

    #[test]
    fn pathological_non_empty_weights_still_leave_a_hole() {
        let row = row_from_vrf(
            [9u8; 32],
            99,
            BlockWeights {
                values: [1, 0, 0, 0, u16::MAX],
            },
        )
        .unwrap();
        assert!(row.contains(&0));
        Grid::validate_row(&row).unwrap();
    }

    #[test]
    fn rejects_weights_that_cannot_generate_a_playable_row() {
        assert_eq!(
            row_from_vrf(
                [0; 32],
                0,
                BlockWeights {
                    values: [0, 1, 1, 1, 1],
                },
            ),
            Err(RandomnessError::NoEmptyWeight)
        );
    }
}
