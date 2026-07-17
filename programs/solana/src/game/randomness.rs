use solana_sha256_hasher::hashv;

use super::{Grid, GridError, Row, GRID_WIDTH};

pub const MIN_OPENING_HEIGHT: u8 = 3;
pub const MAX_OPENING_HEIGHT: u8 = 8;
const MAX_OPENING_SOURCE_ROWS: u8 = 16;

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
        if self.values[1..].iter().all(|weight| *weight == 0) {
            return Err(RandomnessError::NoBlockWeight);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RandomnessError {
    ZeroTotalWeight,
    NoEmptyWeight,
    NoBlockWeight,
    InvalidOpeningHeight,
    InvalidGeneratedRow(GridError),
}

/// A complete opening derived from one verified VRF result.
///
/// Source rows use the same weighted packing as every later preview. They are
/// inserted and settled sequentially, matching the gameplay/Cairo opening
/// semantics without making additional oracle requests.
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

/// Build exactly `height` settled board rows and one visible preview row.
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
        b"zkube-opening-layout-v2",
        randomness,
        request_counter,
        rules_hash,
    );
    let mut grid = Grid::EMPTY;
    let mut rows_derived = 0u8;
    while grid.occupied_height() < height && rows_derived < MAX_OPENING_SOURCE_ROWS {
        let row = packed_row(&mut stream, weights);
        grid.insert_bottom_row(row)
            .map_err(RandomnessError::InvalidGeneratedRow)?;
        // Seed-phase clears are deliberately discarded, just as they were in
        // Cairo's initialize_grid. The opening delivered to the player is
        // already stable and cannot collapse retroactively on the first move.
        let _ = grid.settle();
        rows_derived = rows_derived.saturating_add(1);
    }

    if grid.occupied_height() < height {
        // Canonical weights reach the requested height well before the cap.
        // Keep the callback total even for a pathological future catalog or
        // adversarial draw stream: a repeated dense row with one fixed hole is
        // coherent, nonfull, gravity-stable, and reaches the target exactly.
        let hole = stream.next_u32() as usize % GRID_WIDTH;
        let mut fallback = [1u8; GRID_WIDTH];
        fallback[hole] = 0;
        grid = Grid::EMPTY;
        for _ in 0..height {
            grid.insert_bottom_row(fallback)
                .map_err(RandomnessError::InvalidGeneratedRow)?;
        }
    }

    let preview = packed_row(&mut stream, weights);
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
    let mut stream = DrawStream::new(b"zkube-next-row-v3", randomness, request_counter, [0; 32]);
    Ok(packed_row(&mut stream, weights))
}

/// Pack a weighted row without turning rejected large blocks into accidental
/// gaps. Conditioning the draw on the sizes that fit the current span is
/// distribution-equivalent to Cairo's redraw loop, but has fixed work.
fn packed_row(stream: &mut DrawStream, weights: BlockWeights) -> Row {
    let mut row = [0u8; GRID_WIDTH];
    let mut column = 0usize;
    let mut has_hole = false;
    while column < GRID_WIDTH {
        let remaining = GRID_WIDTH - column;
        let max_size = remaining.min(4);
        let forbid_exact_fill = !has_hole && remaining <= 4;
        let segment = weighted_fitting_segment(
            stream.next_u32(),
            weights.values,
            max_size,
            forbid_exact_fill,
        );
        if segment == 0 {
            has_hole = true;
            column += 1;
            continue;
        }
        let size = usize::from(segment);
        row[column..column + size].fill(segment);
        column += size;
    }

    if row.iter().all(|cell| *cell == 0) {
        let size = weights.values[1..]
            .iter()
            .position(|weight| *weight > 0)
            .map(|index| index + 1)
            .expect("validated weights contain a non-empty block");
        let start = stream.next_u32() as usize % (GRID_WIDTH - size + 1);
        row[start..start + size].fill(size as u8);
    }
    row = shuffled_row(stream, row);
    debug_assert!(row.contains(&0));
    debug_assert!(Grid::validate_row(&row).is_ok());
    row
}

/// Shuffle whole block and gap entities so weighted packing does not bias the
/// final gap toward the right edge. Reordering entities preserves every draw
/// and always keeps the row coherent; blocks are never split across an edge.
fn shuffled_row(stream: &mut DrawStream, row: Row) -> Row {
    let mut entities = [0u8; GRID_WIDTH];
    let mut entity_count = 0usize;
    let mut column = 0usize;
    while column < GRID_WIDTH {
        let segment = row[column];
        entities[entity_count] = segment;
        entity_count += 1;
        column += usize::from(segment.max(1));
    }
    // One cryptographic draw seeds a tiny local mixer for the at-most-seven
    // swaps, keeping the SBF callback's SHA-256 syscall count bounded.
    let mut shuffle = stream.next_u32();
    for index in (1..entity_count).rev() {
        shuffle ^= shuffle << 13;
        shuffle ^= shuffle >> 17;
        shuffle ^= shuffle << 5;
        let swap_with = shuffle as usize % (index + 1);
        entities.swap(index, swap_with);
    }

    let mut shuffled = [0u8; GRID_WIDTH];
    column = 0;
    for segment in entities.into_iter().take(entity_count) {
        let width = usize::from(segment.max(1));
        if segment > 0 {
            shuffled[column..column + width].fill(segment);
        }
        column += width;
    }
    shuffled
}

fn weighted_fitting_segment(
    roll: u32,
    weights: [u16; 5],
    max_size: usize,
    forbid_exact_fill: bool,
) -> u8 {
    let mut total = 0u32;
    for (segment, weight) in weights.iter().enumerate().take(max_size + 1) {
        if !(forbid_exact_fill && segment == max_size) {
            total = total.saturating_add(u32::from(*weight));
        }
    }
    debug_assert!(total > 0, "the empty-cell weight is always eligible");
    let roll = roll % total;
    let mut cursor = 0u32;
    for (segment, weight) in weights.iter().enumerate().take(max_size + 1) {
        if forbid_exact_fill && segment == max_size {
            continue;
        }
        cursor = cursor.saturating_add(u32::from(*weight));
        if roll < cursor {
            return segment as u8;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAMPAIGN_WEIGHT_CURVE: [[u16; 5]; 8] = [
        [15, 30, 30, 15, 10],
        [15, 25, 30, 20, 10],
        [15, 25, 25, 20, 15],
        [10, 20, 25, 25, 20],
        [10, 20, 20, 25, 25],
        [5, 15, 20, 30, 30],
        [1, 15, 15, 35, 34],
        [1, 5, 10, 49, 35],
    ];
    const DAILY_WEIGHT_CURVE: [[u16; 5]; 8] = [
        [25, 30, 25, 15, 5],
        [22, 28, 25, 18, 7],
        [20, 25, 25, 20, 10],
        [18, 22, 24, 22, 14],
        [16, 20, 22, 24, 18],
        [14, 18, 20, 26, 22],
        [12, 16, 18, 28, 26],
        [10, 14, 16, 30, 30],
    ];

    fn randomness_for(seed: u32) -> [u8; 32] {
        sha256v(&[b"zkube-generator-regression-v1", &seed.to_le_bytes()])
    }

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
                assert!(first.hash_blocks <= 20);
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
        assert_eq!(
            row_from_vrf(
                [0; 32],
                1,
                BlockWeights {
                    values: [100, 0, 0, 0, 0]
                }
            ),
            Err(RandomnessError::NoBlockWeight)
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

    #[test]
    fn fitting_selection_conditions_out_oversized_blocks() {
        let weights = [1, 2, 3, 4, u16::MAX];
        for roll in 0..10_000 {
            assert!(weighted_fitting_segment(roll, weights, 1, false) <= 1);
            assert!(weighted_fitting_segment(roll, weights, 2, false) <= 2);
            assert!(weighted_fitting_segment(roll, weights, 3, false) <= 3);
            assert_eq!(weighted_fitting_segment(roll, weights, 1, true), 0);
        }
    }

    #[test]
    fn every_generated_row_is_fully_accounted_for_and_reproducible() {
        for weights in [
            [15, 30, 30, 15, 10],
            [10, 20, 20, 25, 25],
            [1, 5, 10, 49, 35],
            [25, 30, 25, 15, 5],
            [10, 14, 16, 30, 30],
        ] {
            for seed in 0..=u8::MAX {
                let row = row_from_vrf([seed; 32], 11, BlockWeights { values: weights }).unwrap();
                assert!(row.contains(&0));
                assert!(row.iter().any(|cell| *cell != 0));
                Grid::validate_row(&row).unwrap();
                assert_eq!(
                    row,
                    row_from_vrf([seed; 32], 11, BlockWeights { values: weights }).unwrap()
                );
            }
        }
    }

    #[test]
    fn every_authored_weight_tier_generates_complete_rows_and_openings() {
        for weights in CAMPAIGN_WEIGHT_CURVE.into_iter().chain(DAILY_WEIGHT_CURVE) {
            let weights = BlockWeights { values: weights };
            for seed in 0..64 {
                let randomness = randomness_for(seed);
                let row = row_from_vrf(randomness, seed + 1, weights).unwrap();
                assert!(row.contains(&0));
                assert!(row.iter().any(|cell| *cell != 0));
                Grid::validate_row(&row).unwrap();

                let opening = opening_from_vrf(randomness, 1, [23; 32], 8, weights).unwrap();
                assert_stable(opening, 8);
            }
        }
    }

    #[test]
    fn difficulty_weights_materially_change_the_generated_distribution() {
        let easy = BlockWeights {
            values: DAILY_WEIGHT_CURVE[0],
        };
        let hard = BlockWeights {
            values: DAILY_WEIGHT_CURVE[7],
        };
        let mut easy_empty = 0usize;
        let mut hard_empty = 0usize;
        let mut easy_large = 0usize;
        let mut hard_large = 0usize;

        for seed in 0..4_096 {
            let randomness = randomness_for(seed);
            let easy_row = row_from_vrf(randomness, seed + 1, easy).unwrap();
            let hard_row = row_from_vrf(randomness, seed + 1, hard).unwrap();
            easy_empty += easy_row.iter().filter(|cell| **cell == 0).count();
            hard_empty += hard_row.iter().filter(|cell| **cell == 0).count();
            easy_large += easy_row.iter().filter(|cell| **cell >= 3).count();
            hard_large += hard_row.iter().filter(|cell| **cell >= 3).count();
        }

        assert!(hard_empty < easy_empty);
        assert!(hard_large > easy_large);
    }

    #[test]
    fn row_shuffle_avoids_a_fixed_trailing_gap_bias() {
        let weights = BlockWeights {
            values: CAMPAIGN_WEIGHT_CURVE[0],
        };
        let mut gaps_by_column = [0usize; GRID_WIDTH];
        for seed in 0..8_192 {
            let row = row_from_vrf(randomness_for(seed), seed + 1, weights).unwrap();
            for (column, cell) in row.iter().enumerate() {
                gaps_by_column[column] += usize::from(*cell == 0);
            }
        }

        assert!(
            gaps_by_column[0].abs_diff(gaps_by_column[GRID_WIDTH - 1]) < 256,
            "column gap counts: {gaps_by_column:?}"
        );
        let interior = &gaps_by_column[1..GRID_WIDTH - 1];
        let min = *interior.iter().min().unwrap();
        let max = *interior.iter().max().unwrap();
        assert!(max - min < 256, "column gap counts: {gaps_by_column:?}");
    }

    #[test]
    fn canonical_openings_do_not_collapse_into_support_towers() {
        let mut occupied_cells = 0usize;
        for seed in 0..256 {
            let layout = opening_from_vrf(
                randomness_for(seed),
                1,
                [31; 32],
                8,
                BlockWeights {
                    values: CAMPAIGN_WEIGHT_CURVE[0],
                },
            )
            .unwrap();
            assert_stable(layout, 8);
            occupied_cells += layout
                .grid
                .cells()
                .iter()
                .filter(|cell| **cell != 0)
                .count();
        }

        // More than three occupied cells per visible row on average. The
        // regressed support-mask generator fell below this by monotonically
        // narrowing every row above the first.
        assert!(occupied_cells > 256 * 8 * 3);
    }
}
