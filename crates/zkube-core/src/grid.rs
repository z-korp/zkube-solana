pub const GRID_WIDTH: usize = 8;
pub const GRID_HEIGHT: usize = 10;
pub const GRID_CELLS: usize = GRID_WIDTH * GRID_HEIGHT;

pub type Row = [u8; GRID_WIDTH];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bonus {
    Hammer,
    Totem,
    Wave,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GridError {
    InvalidRow,
    InvalidColumn,
    EmptySelection,
    SelectionInsideBlock,
    InvalidBlock,
    DestinationOccupied,
    IncoherentRow,
    CapacityExceeded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Grid {
    cells: [u8; GRID_CELLS],
}

impl Default for Grid {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Grid {
    pub const EMPTY: Self = Self {
        cells: [0; GRID_CELLS],
    };

    pub fn try_from_cells(cells: [u8; GRID_CELLS]) -> Result<Self, GridError> {
        let grid = Self { cells };
        grid.validate()?;
        Ok(grid)
    }

    pub const fn cells(&self) -> &[u8; GRID_CELLS] {
        &self.cells
    }

    pub fn is_empty(&self) -> bool {
        self.cells.iter().all(|cell| *cell == 0)
    }

    pub fn is_full(&self) -> bool {
        self.row(GRID_HEIGHT - 1)
            .is_some_and(|row| row.iter().any(|cell| *cell != 0))
    }

    pub fn highest_occupied_row(&self) -> u8 {
        (0..GRID_HEIGHT)
            .rev()
            .find(|row| {
                self.row(*row)
                    .is_some_and(|cells| cells.iter().any(|cell| *cell != 0))
            })
            .unwrap_or(0) as u8
    }

    pub fn occupied_height(&self) -> u8 {
        if self.is_empty() {
            0
        } else {
            self.highest_occupied_row().saturating_add(1)
        }
    }

    pub fn row(&self, row: usize) -> Option<&Row> {
        if row >= GRID_HEIGHT {
            return None;
        }
        self.cells[row * GRID_WIDTH..(row + 1) * GRID_WIDTH]
            .try_into()
            .ok()
    }

    pub fn validate_row(row: &Row) -> Result<(), GridError> {
        let mut column = 0usize;
        while column < GRID_WIDTH {
            let size = row[column] as usize;
            if size == 0 {
                column += 1;
                continue;
            }
            if size > 4 || column + size > GRID_WIDTH {
                return Err(GridError::InvalidBlock);
            }
            if row[column..column + size]
                .iter()
                .any(|cell| *cell as usize != size)
            {
                return Err(GridError::IncoherentRow);
            }
            column += size;
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), GridError> {
        for row in 0..GRID_HEIGHT {
            Self::validate_row(self.row(row).ok_or(GridError::InvalidRow)?)?;
        }
        Ok(())
    }

    pub fn swipe(&mut self, row: u8, start: u8, destination: u8) -> Result<(), GridError> {
        let row = row as usize;
        let start = start as usize;
        let destination = destination as usize;
        if row >= GRID_HEIGHT {
            return Err(GridError::InvalidRow);
        }
        if start >= GRID_WIDTH || destination >= GRID_WIDTH {
            return Err(GridError::InvalidColumn);
        }

        let offset = row * GRID_WIDTH;
        // `start` must be the LEFT EDGE of a greedily-packed block. Blocks are
        // read left to right, a width-N block being N consecutive cells of
        // value N, so adjacent same-width blocks are distinct and independently
        // movable — e.g. "1 1" is two width-1 blocks and "2 2 2 2" is two
        // width-2 blocks. This matches the Cairo engine (check_row_coherence /
        // block-by-index swipe) and the client. A naive `cells[start-1]==size`
        // test wrongly merges them and rejected valid moves (InvalidMove/6002).
        let left_edge = Self::block_left_edge(&self.cells[offset..offset + GRID_WIDTH], start)?;
        if left_edge != start {
            return Err(GridError::SelectionInsideBlock);
        }
        let size = self.cells[offset + start] as usize;
        if size > 4 || start + size > GRID_WIDTH || destination + size > GRID_WIDTH {
            return Err(GridError::InvalidBlock);
        }
        if start == destination {
            return Ok(());
        }

        let mut candidate = *self.row(row).ok_or(GridError::InvalidRow)?;
        candidate[start..start + size].fill(0);
        if candidate[destination..destination + size]
            .iter()
            .any(|cell| *cell != 0)
        {
            return Err(GridError::DestinationOccupied);
        }
        candidate[destination..destination + size].fill(size as u8);
        Self::validate_row(&candidate)?;
        self.cells[offset..offset + GRID_WIDTH].copy_from_slice(&candidate);
        Ok(())
    }

    pub fn apply_bonus(&mut self, bonus: Bonus, row: u8, column: u8) -> Result<(), GridError> {
        let row = row as usize;
        let column = column as usize;
        if row >= GRID_HEIGHT {
            return Err(GridError::InvalidRow);
        }
        if column >= GRID_WIDTH {
            return Err(GridError::InvalidColumn);
        }
        let offset = row * GRID_WIDTH;
        let size = self.cells[offset + column];
        if size == 0 {
            return Err(GridError::EmptySelection);
        }

        match bonus {
            Bonus::Hammer => {
                let start = self.block_start(row, column)?;
                self.cells[offset + start..offset + start + size as usize].fill(0);
            }
            Bonus::Totem => {
                for cell in &mut self.cells {
                    if *cell == size {
                        *cell = 0;
                    }
                }
            }
            Bonus::Wave => self.cells[offset..offset + GRID_WIDTH].fill(0),
        }
        Ok(())
    }

    pub fn apply_gravity(&mut self) {
        loop {
            let mut changed = false;
            for row in 1..GRID_HEIGHT {
                let mut column = 0usize;
                while column < GRID_WIDTH {
                    let size = self.cells[row * GRID_WIDTH + column] as usize;
                    if size == 0 {
                        column += 1;
                        continue;
                    }
                    if size > 4 || column + size > GRID_WIDTH {
                        column += 1;
                        continue;
                    }
                    let can_fall = (0..size)
                        .all(|index| self.cells[(row - 1) * GRID_WIDTH + column + index] == 0);
                    if can_fall {
                        for index in 0..size {
                            self.cells[(row - 1) * GRID_WIDTH + column + index] = size as u8;
                            self.cells[row * GRID_WIDTH + column + index] = 0;
                        }
                        changed = true;
                    }
                    column += size;
                }
            }
            if !changed {
                break;
            }
        }
    }

    /// Resolve gravity and cascading full rows from the start of an action.
    /// The returned points reproduce Cairo's triangular per-action line score:
    /// line 1 = 1, line 2 = 2, ...
    pub fn settle(&mut self) -> (u8, u16) {
        self.settle_after(0)
    }

    /// Resolve another settle phase in the same action.
    ///
    /// Cairo passes the same line counter through the settle before next-row
    /// insertion and the settle after insertion. Resuming from `lines_before`
    /// keeps a four-line action worth 1 + 2 + 3 + 4 even when the fourth line
    /// is completed by the inserted row.
    pub fn settle_after(&mut self, lines_before: u8) -> (u8, u16) {
        let mut lines = 0u8;
        let mut action_lines = lines_before;
        let mut points = 0u16;
        loop {
            self.apply_gravity();
            let mut cleared = false;
            for row in 0..GRID_HEIGHT {
                let offset = row * GRID_WIDTH;
                if self.cells[offset..offset + GRID_WIDTH]
                    .iter()
                    .all(|cell| *cell != 0)
                {
                    self.cells[offset..offset + GRID_WIDTH].fill(0);
                    lines = lines.saturating_add(1);
                    action_lines = action_lines.saturating_add(1);
                    points = points.saturating_add(action_lines as u16);
                    cleared = true;
                }
            }
            if !cleared {
                break;
            }
        }
        (lines, points)
    }

    pub fn insert_bottom_row(&mut self, row: Row) -> Result<(), GridError> {
        Self::validate_row(&row)?;
        // Insertion shifts every existing row upward. Once the top row is
        // occupied there is no eleventh slot, so reject without dropping any
        // cells. The engine turns an attempted move-time overflow into a
        // terminal run; other callers receive an atomic capacity error.
        if self.is_full() {
            return Err(GridError::CapacityExceeded);
        }
        for target in (1..GRID_HEIGHT).rev() {
            let source = (target - 1) * GRID_WIDTH;
            self.cells
                .copy_within(source..source + GRID_WIDTH, target * GRID_WIDTH);
        }
        self.cells[..GRID_WIDTH].copy_from_slice(&row);
        Ok(())
    }

    pub fn count_cells_of_size(&self, size: u8) -> u8 {
        self.cells
            .iter()
            .filter(|cell| **cell == size)
            .count()
            .min(u8::MAX as usize) as u8
    }

    fn block_start(&self, row: usize, column: usize) -> Result<usize, GridError> {
        let offset = row * GRID_WIDTH;
        Self::block_left_edge(&self.cells[offset..offset + GRID_WIDTH], column)
    }

    /// Left-edge column of the greedily-packed block occupying `column`.
    ///
    /// Blocks are packed left to right: a width-N block is N consecutive cells
    /// of value N. Adjacent same-width blocks are therefore distinct (e.g.
    /// "1 1" is two width-1 blocks, "2 2 2 2" is two width-2 blocks) — this is
    /// the boundary model shared by the Cairo engine and the client. Errors if
    /// `column` sits in an empty cell or the row is malformed.
    fn block_left_edge(row_cells: &[u8], column: usize) -> Result<usize, GridError> {
        let mut cursor = 0usize;
        while cursor < GRID_WIDTH {
            let size = row_cells[cursor] as usize;
            if size == 0 {
                if cursor == column {
                    return Err(GridError::EmptySelection);
                }
                cursor += 1;
                continue;
            }
            if size > 4
                || cursor + size > GRID_WIDTH
                || row_cells[cursor..cursor + size]
                    .iter()
                    .any(|cell| *cell as usize != size)
            {
                return Err(GridError::IncoherentRow);
            }
            if column >= cursor && column < cursor + size {
                return Ok(cursor);
            }
            cursor += size;
        }
        Err(GridError::EmptySelection)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::vec::Vec;

    fn grid_with_rows(rows: &[(usize, Row)]) -> Grid {
        let mut cells = [0u8; GRID_CELLS];
        for (index, row) in rows {
            cells[index * GRID_WIDTH..(index + 1) * GRID_WIDTH].copy_from_slice(row);
        }
        Grid::try_from_cells(cells).unwrap()
    }

    #[test]
    fn rejects_incoherent_rows() {
        assert_eq!(
            Grid::validate_row(&[2, 0, 0, 0, 0, 0, 0, 0]),
            Err(GridError::IncoherentRow)
        );
        assert_eq!(
            Grid::validate_row(&[0, 0, 0, 0, 0, 0, 3, 3]),
            Err(GridError::InvalidBlock)
        );
    }

    #[test]
    fn swipe_moves_whole_block_and_rejects_collision() {
        let mut grid = grid_with_rows(&[(0, [0, 2, 2, 0, 1, 0, 0, 0])]);
        grid.swipe(0, 1, 2).unwrap();
        assert_eq!(grid.row(0).unwrap(), &[0, 0, 2, 2, 1, 0, 0, 0]);
        assert_eq!(grid.swipe(0, 2, 3), Err(GridError::DestinationOccupied));
        assert_eq!(grid.swipe(0, 3, 0), Err(GridError::SelectionInsideBlock));
    }

    #[test]
    fn swipe_moves_non_leading_block_of_a_same_width_run() {
        // The exact live row that 6002'd: two width-1 blocks at cols 5,6 (the
        // trailing "1 1"). Moving the col-6 one into empty col 7 is legal —
        // the old cells[start-1]==size check wrongly rejected it.
        let mut grid = grid_with_rows(&[(0, [1, 1, 3, 3, 3, 1, 1, 0])]);
        grid.swipe(0, 6, 7).unwrap();
        assert_eq!(grid.row(0).unwrap(), &[1, 1, 3, 3, 3, 1, 0, 1]);
        // The second block of the LEADING "1 1" (col 1) is independently movable.
        let mut grid2 = grid_with_rows(&[(0, [1, 1, 3, 3, 3, 1, 1, 0])]);
        grid2.swipe(0, 1, 7).unwrap();
        assert_eq!(grid2.row(0).unwrap(), &[1, 0, 3, 3, 3, 1, 1, 1]);
        // Selecting the interior of the width-3 block (col 3) is still rejected.
        let mut grid3 = grid_with_rows(&[(0, [1, 1, 3, 3, 3, 1, 1, 0])]);
        assert_eq!(grid3.swipe(0, 3, 7), Err(GridError::SelectionInsideBlock));
        // Selecting an empty cell is rejected.
        assert_eq!(grid3.swipe(0, 7, 7), Err(GridError::EmptySelection));
    }

    #[test]
    fn hammer_targets_non_leading_block_of_a_same_width_run() {
        // Hammer on the col-6 block of a trailing "1 1" clears only that cell.
        let mut grid = grid_with_rows(&[(0, [1, 1, 3, 3, 3, 1, 1, 0])]);
        grid.apply_bonus(Bonus::Hammer, 0, 6).unwrap();
        assert_eq!(grid.row(0).unwrap(), &[1, 1, 3, 3, 3, 1, 0, 0]);
    }

    #[test]
    fn gravity_keeps_wide_blocks_atomic() {
        let mut grid =
            grid_with_rows(&[(0, [1, 0, 0, 0, 0, 0, 0, 0]), (2, [2, 2, 0, 0, 0, 0, 0, 0])]);
        grid.apply_gravity();
        assert_eq!(grid.row(1).unwrap(), &[2, 2, 0, 0, 0, 0, 0, 0]);
        assert_eq!(grid.row(0).unwrap(), &[1, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn settle_cascades_and_scores_triangularly() {
        let mut grid =
            grid_with_rows(&[(0, [1, 1, 1, 1, 1, 1, 1, 1]), (1, [1, 1, 1, 1, 1, 1, 1, 1])]);
        assert_eq!(grid.settle(), (2, 3));
        assert!(grid.is_empty());
    }

    #[test]
    fn settle_phases_share_one_cairo_line_curve() {
        const FULL: Row = [1, 1, 1, 1, 1, 1, 1, 1];
        const FOUR_LINE_POINTS: u16 = 10;

        for lines_before in 0u8..=4 {
            let remaining = 4usize - usize::from(lines_before);
            let rows = (0..remaining).map(|row| (row, FULL)).collect::<Vec<_>>();
            let mut grid = grid_with_rows(&rows);
            let points_before = u16::from(lines_before)
                .saturating_mul(u16::from(lines_before.saturating_add(1)))
                / 2;
            let (lines, points) = grid.settle_after(lines_before);

            assert_eq!(lines, 4 - lines_before);
            assert_eq!(points_before + points, FOUR_LINE_POINTS);
            assert!(grid.is_empty());
        }
    }

    #[test]
    fn bonuses_match_campaign_tools() {
        let source =
            grid_with_rows(&[(0, [2, 2, 1, 0, 0, 0, 0, 0]), (1, [0, 2, 2, 0, 1, 0, 0, 0])]);

        let mut hammer = source;
        hammer.apply_bonus(Bonus::Hammer, 0, 1).unwrap();
        assert_eq!(hammer.row(0).unwrap(), &[0, 0, 1, 0, 0, 0, 0, 0]);

        let mut totem = source;
        totem.apply_bonus(Bonus::Totem, 0, 0).unwrap();
        assert_eq!(totem.count_cells_of_size(2), 0);

        let mut wave = source;
        wave.apply_bonus(Bonus::Wave, 1, 1).unwrap();
        assert_eq!(wave.row(1).unwrap(), &[0; GRID_WIDTH]);
    }

    #[test]
    fn insertion_at_capacity_is_rejected_without_dropping_the_top_row() {
        let sparse = [1, 0, 0, 0, 0, 0, 0, 0];
        let rows = (0..GRID_HEIGHT)
            .map(|row| (row, sparse))
            .collect::<Vec<_>>();
        let mut grid = grid_with_rows(&rows);
        let before = grid;

        assert_eq!(
            grid.insert_bottom_row([0, 1, 0, 0, 0, 0, 0, 0]),
            Err(GridError::CapacityExceeded)
        );
        assert_eq!(grid, before);
    }

    #[test]
    fn shared_golden_rows_match_rust_domain() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../fixtures/game-parity.json")).unwrap();
        for fixture in fixtures["validRows"].as_array().unwrap() {
            let cells: Row = fixture["cells"]
                .as_array()
                .unwrap()
                .iter()
                .map(|cell| cell.as_u64().unwrap() as u8)
                .collect::<Vec<_>>()
                .try_into()
                .unwrap();
            Grid::validate_row(&cells).unwrap();
        }
        for fixture in fixtures["invalidRows"].as_array().unwrap() {
            let cells: Row = fixture["cells"]
                .as_array()
                .unwrap()
                .iter()
                .map(|cell| cell.as_u64().unwrap() as u8)
                .collect::<Vec<_>>()
                .try_into()
                .unwrap();
            assert!(Grid::validate_row(&cells).is_err());
        }
    }

    #[test]
    fn shared_golden_grid_operations_match_rust_domain() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../fixtures/game-parity.json")).unwrap();
        for fixture in fixtures["gridCases"].as_array().unwrap() {
            let mut cells = [0u8; GRID_CELLS];
            write_fixture_rows(&mut cells, &fixture["inputRows"]);
            let mut grid = Grid::try_from_cells(cells).unwrap();
            let args = fixture["args"].as_array().cloned().unwrap_or_default();
            let result = match fixture["operation"].as_str().unwrap() {
                "swipe" => {
                    grid.swipe(
                        args[0].as_u64().unwrap() as u8,
                        args[1].as_u64().unwrap() as u8,
                        args[2].as_u64().unwrap() as u8,
                    )
                    .unwrap();
                    None
                }
                "gravity" => {
                    grid.apply_gravity();
                    None
                }
                "settle" => Some(grid.settle()),
                "hammer" | "totem" | "wave" => {
                    let bonus = match fixture["operation"].as_str().unwrap() {
                        "hammer" => Bonus::Hammer,
                        "totem" => Bonus::Totem,
                        _ => Bonus::Wave,
                    };
                    grid.apply_bonus(
                        bonus,
                        args[0].as_u64().unwrap() as u8,
                        args[1].as_u64().unwrap() as u8,
                    )
                    .unwrap();
                    None
                }
                operation => panic!("unknown fixture operation {operation}"),
            };
            if let Some((lines, points)) = result {
                assert_eq!(lines, fixture["expectedLines"].as_u64().unwrap() as u8);
                assert_eq!(points, fixture["expectedPoints"].as_u64().unwrap() as u16);
            }
            let mut expected = [0u8; GRID_CELLS];
            write_fixture_rows(&mut expected, &fixture["expectedRows"]);
            assert_eq!(grid.cells(), &expected, "{}", fixture["name"]);
        }
    }

    fn write_fixture_rows(target: &mut [u8; GRID_CELLS], rows: &Value) {
        for row in rows.as_array().unwrap() {
            let index = row["index"].as_u64().unwrap() as usize;
            let cells: Row = row["cells"]
                .as_array()
                .unwrap()
                .iter()
                .map(|cell| cell.as_u64().unwrap() as u8)
                .collect::<Vec<_>>()
                .try_into()
                .unwrap();
            target[index * GRID_WIDTH..(index + 1) * GRID_WIDTH].copy_from_slice(&cells);
        }
    }
}
