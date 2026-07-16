use solana_sha256_hasher::hashv;

use super::{Grid, GridError, Row, GRID_CELLS, GRID_WIDTH};

pub const MIN_OPENING_HEIGHT: u8 = 3;
pub const MAX_OPENING_HEIGHT: u8 = 8;

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
    InvalidOpeningHeight,
    InvalidGeneratedRow(GridError),
}

/// A complete opening derived from one verified VRF result.
///
/// Rows are written bottom-up and every occupied cell above row zero is
/// supported by an occupied cell below. This makes the opening gravity-stable
/// without calling the gameplay settle loop in the oracle callback.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OpeningLayout {
    pub grid: Grid,
    pub preview: Row,
    /// Hash blocks consumed by the deterministic draw stream.
    pub hash_blocks: u8,
}

/// SHA-256 stream that amortizes one digest across eight `u32` draws.
///
/// Solana's SHA-256 syscall is substantially cheaper than constructing the
/// software `sha2` state for every draw. Domain, verified randomness, request,
/// and rules are bound into every block so streams cannot be replayed between
/// roles or content versions.
struct DrawStream {
    root: [u8; 32],
    block: [u8; 32],
    block_index: u32,
    word_index: usize,
}

impl DrawStream {
    fn new(
        domain: &[u8],
        randomness: [u8; 32],
        request_counter: u32,
        rules_hash: [u8; 32],
    ) -> Self {
        let request = request_counter.to_le_bytes();
        let root = sha256v(&[domain, &randomness, &request, &rules_hash]);
        Self {
            root,
            block: [0; 32],
            block_index: 0,
            word_index: 8,
        }
    }

    fn next_u32(&mut self) -> u32 {
        if self.word_index == 8 {
            let index = self.block_index.to_le_bytes();
            self.block = sha256v(&[b"zkube-draw-block-v1", &self.root, &index]);
            self.block_index = self.block_index.saturating_add(1);
            self.word_index = 0;
        }
        let offset = self.word_index * 4;
        self.word_index += 1;
        u32::from_le_bytes(
            self.block[offset..offset + 4]
                .try_into()
                .expect("draw block contains eight u32 words"),
        )
    }

    fn hash_blocks(&self) -> u8 {
        self.block_index.min(u32::from(u8::MAX)) as u8
    }
}

pub fn sha256v(values: &[&[u8]]) -> [u8; 32] {
    hashv(values).to_bytes()
}

/// Build exactly `height` stable board rows and one visible preview row.
///
/// The algorithm performs a fixed, small amount of work: one pass over at
/// most eight rows of eight columns. A reserved hole prevents a full seed row;
/// unsupported placements become empty; and a size-one fallback guarantees
/// every row is non-empty. There are no retry or settle loops.
pub fn opening_from_vrf(
    randomness: [u8; 32],
    request_counter: u32,
    rules_hash: [u8; 32],
    height: u8,
    weights: BlockWeights,
) -> Result<OpeningLayout, RandomnessError> {
    weights.validate()?;
    if !(MIN_OPENING_HEIGHT..=MAX_OPENING_HEIGHT).contains(&height) {
        return Err(RandomnessError::InvalidOpeningHeight);
    }

    let mut stream = DrawStream::new(
        b"zkube-opening-layout-v1",
        randomness,
        request_counter,
        rules_hash,
    );
    let mut cells = [0u8; GRID_CELLS];
    let mut support = [true; GRID_WIDTH];
    for row_index in 0..usize::from(height) {
        let row = supported_row(&mut stream, weights, support);
        let start = row_index * GRID_WIDTH;
        cells[start..start + GRID_WIDTH].copy_from_slice(&row);
        support = row.map(|cell| cell != 0);
    }
    // Preview rows are playable but are not part of the stable opening stack,
    // so they have no support restriction.
    let preview = supported_row(&mut stream, weights, [true; GRID_WIDTH]);
    let grid = Grid::try_from_cells(cells).map_err(RandomnessError::InvalidGeneratedRow)?;
    Ok(OpeningLayout {
        grid,
        preview,
        hash_blocks: stream.hash_blocks(),
    })
}

/// Convert one verified VRF result into exactly one playable row.
pub fn row_from_vrf(
    randomness: [u8; 32],
    request_counter: u32,
    weights: BlockWeights,
) -> Result<Row, RandomnessError> {
    weights.validate()?;
    let mut stream = DrawStream::new(b"zkube-next-row-v2", randomness, request_counter, [0; 32]);
    Ok(supported_row(&mut stream, weights, [true; GRID_WIDTH]))
}

fn supported_row(
    stream: &mut DrawStream,
    weights: BlockWeights,
    support: [bool; GRID_WIDTH],
) -> Row {
    let total: u32 = weights.values.iter().map(|weight| u32::from(*weight)).sum();
    let hole_roll = stream.next_u32() as usize;
    let unsupported_count = support.iter().filter(|occupied| !**occupied).count();
    // Once the support narrows, reserve an already-unsupported column. This
    // keeps the single remaining support cell available for the non-empty
    // fallback while still guaranteeing that the row cannot become full.
    let hole = if unsupported_count == 0 {
        hole_roll % GRID_WIDTH
    } else {
        let selected = hole_roll % unsupported_count;
        (0..GRID_WIDTH)
            .filter(|column| !support[*column])
            .nth(selected)
            .expect("unsupported count was measured from the same row")
    };
    let mut row = [0u8; GRID_WIDTH];
    let mut column = 0usize;
    while column < GRID_WIDTH {
        if column == hole || !support[column] {
            column += 1;
            continue;
        }
        let segment = weighted_segment(stream.next_u32() % total, weights.values);
        if segment == 0 {
            column += 1;
            continue;
        }
        let size = usize::from(segment);
        let end = column.saturating_add(size);
        let fits = end <= GRID_WIDTH
            && !(column..end).contains(&hole)
            && support[column..end].iter().all(|occupied| *occupied);
        if fits {
            row[column..end].fill(segment);
            column = end;
        } else {
            // Deterministic bounded fallback: leave this cell empty and keep
            // scanning. If the complete row remains empty, a supported unit
            // block is installed below.
            column += 1;
        }
    }

    if row.iter().all(|cell| *cell == 0) {
        let fallback = (0..GRID_WIDTH)
            .find(|column| *column != hole && support[*column])
            .expect("non-empty support has a column outside the reserved hole");
        row[fallback] = 1;
    }
    debug_assert!(row[hole] == 0);
    debug_assert!(Grid::validate_row(&row).is_ok());
    row
}

fn weighted_segment(roll: u32, weights: [u16; 5]) -> u8 {
    let mut cursor = 0u32;
    for (segment, weight) in weights.into_iter().enumerate() {
        cursor = cursor.saturating_add(u32::from(weight));
        if roll < cursor {
            return segment as u8;
        }
    }
    4
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_stable(layout: OpeningLayout, height: u8) {
        assert_eq!(layout.grid.occupied_height(), height);
        let mut settled = layout.grid;
        settled.apply_gravity();
        assert_eq!(settled, layout.grid);
        for row_index in 0..usize::from(height) {
            let row = layout.grid.row(row_index).unwrap();
            assert!(row.contains(&0));
            assert!(row.iter().any(|cell| *cell != 0));
            Grid::validate_row(row).unwrap();
        }
        assert!(layout.preview.contains(&0));
        assert!(layout.preview.iter().any(|cell| *cell != 0));
        Grid::validate_row(&layout.preview).unwrap();
    }

    #[test]
    fn opening_is_exact_stable_bounded_and_reproducible() {
        for height in MIN_OPENING_HEIGHT..=MAX_OPENING_HEIGHT {
            for seed in 0..=u8::MAX {
                let args = ([seed; 32], 7, [19; 32], height, BlockWeights::default());
                let first = opening_from_vrf(args.0, args.1, args.2, args.3, args.4).unwrap();
                let replay = opening_from_vrf(args.0, args.1, args.2, args.3, args.4).unwrap();
                assert_eq!(first, replay);
                assert!(first.hash_blocks <= 10);
                assert_stable(first, height);
            }
        }
    }

    #[test]
    fn observed_callback_randomness_regressions_fit_one_opening() {
        for hex in [
            "37101e06b9e54aaee5941e084bbbe7fdff8da04f52e7ea2e2858cc4b33d67ff1",
            "231b28d9502df09592416cbbeb98cad993f41cde9be2ec0692d688846c779a28",
            "701f6ec7ce9e1146c5e275af39876e30adf831c27c1de1e7846510438c2e1aaf",
        ] {
            let mut randomness = [0u8; 32];
            for (index, byte) in randomness.iter_mut().enumerate() {
                *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).unwrap();
            }
            assert_stable(
                opening_from_vrf(randomness, 1, [3; 32], 8, BlockWeights::default()).unwrap(),
                8,
            );
        }
    }

    #[test]
    fn streams_are_request_rules_and_role_separated() {
        let base = opening_from_vrf([7; 32], 1, [8; 32], 4, BlockWeights::default()).unwrap();
        assert_ne!(
            base,
            opening_from_vrf([7; 32], 2, [8; 32], 4, BlockWeights::default()).unwrap()
        );
        assert_ne!(
            base,
            opening_from_vrf([7; 32], 1, [9; 32], 4, BlockWeights::default()).unwrap()
        );
        assert_ne!(
            base.preview,
            row_from_vrf([7; 32], 1, BlockWeights::default()).unwrap()
        );
    }

    #[test]
    fn rejects_out_of_range_openings_and_unplayable_weights() {
        assert_eq!(
            opening_from_vrf([0; 32], 1, [0; 32], 2, BlockWeights::default()),
            Err(RandomnessError::InvalidOpeningHeight)
        );
        assert_eq!(
            row_from_vrf(
                [0; 32],
                1,
                BlockWeights {
                    values: [0, 1, 1, 1, 1]
                }
            ),
            Err(RandomnessError::NoEmptyWeight)
        );
    }

    #[test]
    fn pathological_weights_still_make_bounded_playable_rows() {
        let weights = BlockWeights {
            values: [1, 0, 0, 0, u16::MAX],
        };
        assert_stable(
            opening_from_vrf([9; 32], 99, [4; 32], 8, weights).unwrap(),
            8,
        );
    }
}
