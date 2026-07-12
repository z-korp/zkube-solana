use super::{Bonus, Grid, GridError, Row};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConstraintKind {
    #[default]
    None,
    ComboLines,
    BreakBlocks,
    ComboStreak,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Constraint {
    pub kind: ConstraintKind,
    pub value: u8,
    pub required_count: u8,
}

impl Constraint {
    pub fn is_satisfied(self, progress: u8) -> bool {
        match self.kind {
            ConstraintKind::None => true,
            ConstraintKind::ComboStreak => progress >= 1,
            ConstraintKind::ComboLines | ConstraintKind::BreakBlocks => {
                progress >= self.required_count
            }
        }
    }

    fn update(self, current: u8, report: &MoveReport) -> u8 {
        match self.kind {
            ConstraintKind::None => current,
            ConstraintKind::ComboLines => {
                if report.lines_cleared >= self.value {
                    current.saturating_add(1).min(self.required_count)
                } else {
                    current
                }
            }
            ConstraintKind::BreakBlocks => current
                .saturating_add(report.blocks_destroyed_of_target_size)
                .min(self.required_count),
            ConstraintKind::ComboStreak => {
                u8::from(current >= 1 || report.combo_counter >= self.value)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LevelRules {
    pub points_required: u32,
    pub max_moves: u16,
    pub primary: Constraint,
    pub secondary: Constraint,
}

impl Default for LevelRules {
    fn default() -> Self {
        Self {
            points_required: 1,
            max_moves: 20,
            primary: Constraint::default(),
            secondary: Constraint::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MutatorRules {
    pub score_multiplier_x100: u16,
    pub combo_multiplier_x100: u16,
    pub line_clear_bonus: u16,
    pub perfect_clear_bonus: u16,
    /// Bias-128 encoding from zkube: every point is a five percentage-point
    /// change to the neutral 3-star (50%) and 2-star (75%) move thresholds.
    pub star_threshold_modifier: u8,
    /// 0=None, 1=single-move combo lines, 2=cumulative lines, 3=score.
    pub bonus_trigger_type: u8,
    pub bonus_threshold: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EndlessRules {
    /// Score at which each difficulty tier 1..7 begins. Tier 0 begins at zero.
    pub thresholds: [u32; 7],
    /// Integer x100 score multipliers for tiers 0..7.
    pub score_multipliers_x100: [u16; 8],
    /// Applies before selecting the tier; 100 is neutral.
    pub ramp_multiplier_x100: u16,
}

impl Default for EndlessRules {
    fn default() -> Self {
        Self {
            thresholds: [25, 75, 150, 300, 600, 1_200, 2_400],
            score_multipliers_x100: [100, 110, 125, 140, 160, 180, 210, 250],
            ramp_multiplier_x100: 100,
        }
    }
}

impl EndlessRules {
    pub fn difficulty_for_score(self, score: u32) -> u8 {
        let ramped = scale(score, self.ramp_multiplier_x100);
        self.thresholds
            .iter()
            .take_while(|threshold| ramped >= **threshold)
            .count() as u8
    }

    pub fn score_multiplier(self, difficulty: u8) -> u16 {
        self.score_multipliers_x100[difficulty.min(7) as usize]
    }
}

impl Default for MutatorRules {
    fn default() -> Self {
        Self {
            score_multiplier_x100: 100,
            combo_multiplier_x100: 100,
            line_clear_bonus: 0,
            perfect_clear_bonus: 0,
            star_threshold_modifier: 128,
            bonus_trigger_type: 0,
            bonus_threshold: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RunPhase {
    #[default]
    Ready,
    Playing,
    AwaitingVrf,
    LevelComplete,
    Finished,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MoveReport {
    pub lines_cleared: u8,
    pub points_earned: u32,
    pub combo_counter: u8,
    pub highest_row_before: u8,
    pub highest_row_after: u8,
    pub perfect_clear: bool,
    pub blocks_destroyed_of_target_size: u8,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ActionContext {
    highest_row_before: u8,
    break_target: u8,
    break_cells_before: u8,
    lines: u8,
    base_points: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunError {
    InvalidPhase,
    MoveLimitReached,
    MissingNextRow,
    RowAlreadyAvailable,
    InvalidExpectedMove,
    NoBonusCharge,
    Grid(GridError),
}

impl From<GridError> for RunError {
    fn from(error: GridError) -> Self {
        Self::Grid(error)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RunEngine {
    pub grid: Grid,
    pub next_row: Option<Row>,
    pub phase: RunPhase,
    pub score: u32,
    pub moves: u16,
    pub combo_counter: u8,
    pub max_combo: u8,
    pub primary_progress: u8,
    pub secondary_progress: u8,
    pub level_lines_cleared: u16,
    pub bonus: Option<Bonus>,
    pub bonus_charges: u8,
    pub initial_rows_remaining: u8,
}

impl Default for RunEngine {
    fn default() -> Self {
        Self {
            grid: Grid::EMPTY,
            next_row: None,
            phase: RunPhase::Ready,
            score: 0,
            moves: 0,
            combo_counter: 0,
            max_combo: 0,
            primary_progress: 0,
            secondary_progress: 0,
            level_lines_cleared: 0,
            bonus: None,
            bonus_charges: 0,
            initial_rows_remaining: 0,
        }
    }
}

impl RunEngine {
    pub fn start(grid: Grid, next_row: Row) -> Result<Self, RunError> {
        Grid::validate_row(&next_row)?;
        Ok(Self {
            grid,
            next_row: Some(next_row),
            phase: RunPhase::Playing,
            ..Self::default()
        })
    }

    pub fn provide_vrf_row(&mut self, row: Row) -> Result<(), RunError> {
        if self.phase != RunPhase::AwaitingVrf {
            return Err(RunError::InvalidPhase);
        }
        if self.next_row.is_some() {
            return Err(RunError::RowAlreadyAvailable);
        }
        Grid::validate_row(&row)?;
        if self.initial_rows_remaining > 0 {
            self.grid.insert_bottom_row(row)?;
            // Settle the seed stack exactly like Cairo's initialize_grid, which
            // runs assess_game (gravity + line clears) after every add_line.
            // Without this the independently-generated seed rows leave blocks
            // hanging over empty cells (floating cubes) and the first move's
            // settle retroactively collapses/mis-scores the board. Seed-phase
            // clears are discarded — they never count toward the run.
            let _ = self.grid.settle();
            self.initial_rows_remaining -= 1;
            // Keep awaiting until all configured seed rows plus one visible
            // next row have independently verified VRF callbacks.
        } else if self.grid.is_empty() {
            self.grid.insert_bottom_row(row)?;
            let _ = self.grid.settle();
            // Keep awaiting: the player must always see exactly one next row.
        } else {
            self.next_row = Some(row);
            self.phase = RunPhase::Playing;
        }
        Ok(())
    }

    pub fn play_move(
        &mut self,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
        level: LevelRules,
        mutator: MutatorRules,
    ) -> Result<MoveReport, RunError> {
        if self.phase != RunPhase::Playing {
            return Err(RunError::InvalidPhase);
        }
        if self.moves != expected_move {
            return Err(RunError::InvalidExpectedMove);
        }
        if self.moves >= level.max_moves {
            return Err(RunError::MoveLimitReached);
        }
        let next_row = self.next_row.take().ok_or(RunError::MissingNextRow)?;
        let before = self.grid;
        let highest_row_before = self.grid.highest_occupied_row();
        let break_target = break_target(level);
        let break_cells_before = if break_target == 0 {
            0
        } else {
            self.grid.count_cells_of_size(break_target)
                + next_row
                    .iter()
                    .filter(|cell| **cell == break_target)
                    .count() as u8
        };

        if let Err(error) = self.grid.swipe(row, start, destination) {
            self.next_row = Some(next_row);
            self.grid = before;
            return Err(error.into());
        }
        let (first_lines, first_points) = self.grid.settle();
        if self.grid.is_full() {
            return Ok(self.finish_move(
                ActionContext {
                    highest_row_before,
                    break_target,
                    break_cells_before,
                    lines: first_lines,
                    base_points: first_points,
                },
                level,
                mutator,
            ));
        }

        self.grid.insert_bottom_row(next_row)?;
        let (second_lines, second_points) = self.grid.settle();
        let report = self.finish_move(
            ActionContext {
                highest_row_before,
                break_target,
                break_cells_before,
                lines: first_lines.saturating_add(second_lines),
                base_points: first_points.saturating_add(second_points),
            },
            level,
            mutator,
        );
        Ok(report)
    }

    pub fn apply_bonus(
        &mut self,
        row: u8,
        column: u8,
        level: LevelRules,
        mutator: MutatorRules,
    ) -> Result<MoveReport, RunError> {
        if self.phase != RunPhase::Playing {
            return Err(RunError::InvalidPhase);
        }
        let bonus = self.bonus.ok_or(RunError::NoBonusCharge)?;
        if self.bonus_charges == 0 {
            return Err(RunError::NoBonusCharge);
        }
        let highest_row_before = self.grid.highest_occupied_row();
        let break_target = break_target(level);
        let before = self.grid.count_cells_of_size(break_target);
        self.grid.apply_bonus(bonus, row, column)?;
        self.bonus_charges -= 1;
        let (lines, base_points) = self.grid.settle();
        Ok(self.finish_action(
            ActionContext {
                highest_row_before,
                break_target,
                break_cells_before: before,
                lines,
                base_points,
            },
            level,
            mutator,
            false,
        ))
    }

    pub fn level_satisfied(&self, rules: LevelRules) -> bool {
        self.score >= rules.points_required
            && rules.primary.is_satisfied(self.primary_progress)
            && rules.secondary.is_satisfied(self.secondary_progress)
    }

    fn finish_move(
        &mut self,
        context: ActionContext,
        level: LevelRules,
        mutator: MutatorRules,
    ) -> MoveReport {
        self.moves = self.moves.saturating_add(1);
        self.finish_action(context, level, mutator, true)
    }

    fn finish_action(
        &mut self,
        context: ActionContext,
        level: LevelRules,
        mutator: MutatorRules,
        needs_next_row: bool,
    ) -> MoveReport {
        let ActionContext {
            highest_row_before,
            break_target,
            break_cells_before,
            lines,
            base_points,
        } = context;
        if lines > 1 {
            self.combo_counter = self.combo_counter.saturating_add(lines);
            self.max_combo = self.max_combo.max(lines);
        }
        let perfect_clear = self.grid.is_empty();
        let score_before = self.score;
        let lines_before = self.level_lines_cleared;
        let mut points = scale(base_points as u32, mutator.score_multiplier_x100);
        points = points.saturating_add(lines as u32 * mutator.line_clear_bonus as u32);
        if perfect_clear {
            points = points.saturating_add(mutator.perfect_clear_bonus as u32);
        }
        if lines > 1 {
            points = scale(points, mutator.combo_multiplier_x100);
        }
        self.score = self.score.saturating_add(points);
        if needs_next_row {
            self.level_lines_cleared = self.level_lines_cleared.saturating_add(u16::from(lines));
            let charges = match mutator.bonus_trigger_type {
                1 if mutator.bonus_threshold > 0 && u16::from(lines) >= mutator.bonus_threshold => {
                    1
                }
                2 if mutator.bonus_threshold > 0 => {
                    self.level_lines_cleared / mutator.bonus_threshold
                        - lines_before / mutator.bonus_threshold
                }
                3 if mutator.bonus_threshold > 0 => {
                    let score_threshold = u32::from(mutator.bonus_threshold);
                    (self.score / score_threshold - score_before / score_threshold)
                        .min(u32::from(u8::MAX)) as u16
                }
                _ => 0,
            };
            self.bonus_charges = self
                .bonus_charges
                .saturating_add(charges.min(u16::from(u8::MAX)) as u8)
                .min(15);
        }

        let break_cells_after = self.grid.count_cells_of_size(break_target);
        let destroyed_cells = break_cells_before.saturating_sub(break_cells_after);
        let mut report = MoveReport {
            lines_cleared: lines,
            points_earned: points,
            combo_counter: self.combo_counter,
            highest_row_before,
            highest_row_after: self.grid.highest_occupied_row(),
            perfect_clear,
            blocks_destroyed_of_target_size: if break_target == 0 {
                0
            } else {
                destroyed_cells / break_target
            },
        };
        self.primary_progress = level.primary.update(self.primary_progress, &report);
        self.secondary_progress = level.secondary.update(self.secondary_progress, &report);

        if self.grid.is_full() || self.moves >= level.max_moves && !self.level_satisfied(level) {
            self.phase = RunPhase::Finished;
        } else if self.level_satisfied(level) {
            self.phase = RunPhase::LevelComplete;
        } else if needs_next_row {
            self.phase = RunPhase::AwaitingVrf;
        }
        // Ensure the returned report always reflects the final combo value.
        report.combo_counter = self.combo_counter;
        report
    }
}

pub fn calculate_level_stars(max_moves: u16, moves_used: u16, star_threshold_modifier: u8) -> u8 {
    let (positive, magnitude) = if star_threshold_modifier >= 128 {
        (true, star_threshold_modifier - 128)
    } else {
        (false, 128 - star_threshold_modifier)
    };
    let magnitude_percent = magnitude as u16 * 5;
    let three_percent = if positive {
        50u16.saturating_sub(magnitude_percent).max(10)
    } else {
        (50u16.saturating_add(magnitude_percent)).min(90)
    };
    let two_percent = if positive {
        75u16
            .saturating_sub(magnitude_percent)
            .max(three_percent.saturating_add(1))
    } else {
        (75u16.saturating_add(magnitude_percent)).min(99)
    };
    let three_threshold = max_moves.saturating_mul(three_percent) / 100;
    let two_threshold = max_moves.saturating_mul(two_percent) / 100;
    if moves_used <= three_threshold {
        3
    } else if moves_used <= two_threshold {
        2
    } else {
        1
    }
}

fn break_target(level: LevelRules) -> u8 {
    if level.primary.kind == ConstraintKind::BreakBlocks {
        level.primary.value
    } else if level.secondary.kind == ConstraintKind::BreakBlocks {
        level.secondary.value
    } else {
        0
    }
}

fn scale(value: u32, multiplier_x100: u16) -> u32 {
    value
        .saturating_mul(multiplier_x100.max(1) as u32)
        .saturating_div(100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::GRID_CELLS;
    use serde_json::Value;

    fn grid(rows: &[(usize, Row)]) -> Grid {
        let mut cells = [0; GRID_CELLS];
        for (index, row) in rows {
            cells[index * 8..(index + 1) * 8].copy_from_slice(row);
        }
        Grid::try_from_cells(cells).unwrap()
    }

    #[test]
    fn move_consumes_visible_row_then_requires_fresh_vrf() {
        let source = grid(&[(0, [1, 1, 1, 1, 1, 1, 0, 1])]);
        let mut run = RunEngine::start(source, [0, 0, 0, 0, 0, 0, 0, 1]).unwrap();
        let report = run
            .play_move(0, 0, 7, 6, LevelRules::default(), MutatorRules::default())
            .unwrap();
        assert_eq!(report.lines_cleared, 1);
        assert_eq!(report.points_earned, 1);
        assert_eq!(run.phase, RunPhase::LevelComplete);
        assert_eq!(run.moves, 1);
        assert!(run.next_row.is_none());
    }

    #[test]
    fn empty_grid_needs_a_seed_row_and_then_a_visible_next_row() {
        let mut run = RunEngine {
            phase: RunPhase::AwaitingVrf,
            ..RunEngine::default()
        };
        let row = [1, 0, 0, 0, 0, 0, 0, 0];
        run.provide_vrf_row(row).unwrap();
        assert_eq!(run.phase, RunPhase::AwaitingVrf);
        assert_eq!(run.grid.row(0).unwrap(), &row);
        run.provide_vrf_row(row).unwrap();
        assert_eq!(run.phase, RunPhase::Playing);
        assert_eq!(run.next_row, Some(row));
    }

    #[test]
    fn configured_seed_rows_each_require_fresh_vrf() {
        let mut run = RunEngine {
            phase: RunPhase::AwaitingVrf,
            initial_rows_remaining: 3,
            ..RunEngine::default()
        };
        let row = [1, 0, 0, 0, 0, 0, 0, 0];
        for expected_remaining in [2, 1, 0] {
            run.provide_vrf_row(row).unwrap();
            assert_eq!(run.phase, RunPhase::AwaitingVrf);
            assert_eq!(run.initial_rows_remaining, expected_remaining);
            assert!(run.next_row.is_none());
        }
        run.provide_vrf_row(row).unwrap();
        assert_eq!(run.phase, RunPhase::Playing);
        assert_eq!(run.next_row, Some(row));
    }

    #[test]
    fn seed_rows_are_gravity_settled_no_floating_cubes() {
        let mut run = RunEngine {
            phase: RunPhase::AwaitingVrf,
            initial_rows_remaining: 2,
            ..RunEngine::default()
        };
        // Two DISTINCT coherent rows. Inserted raw (the pre-fix behavior) the
        // col-0 block from the first row would hang over the empty col-0 cell
        // of the second — a floating cube. Seeding must gravity-settle, exactly
        // like Cairo's initialize_grid.
        run.provide_vrf_row([1, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        run.provide_vrf_row([0, 0, 1, 0, 0, 0, 0, 0]).unwrap();
        // The seeded board is already gravity-stable (applying gravity again is
        // a no-op) — the definitive "no floating cubes" assertion.
        let mut resettled = run.grid;
        resettled.apply_gravity();
        assert_eq!(resettled, run.grid, "seed board must be gravity-settled");
        assert_eq!(run.grid.row(0).unwrap(), &[1, 0, 1, 0, 0, 0, 0, 0]);
        assert_eq!(run.grid.row(1).unwrap(), &[0, 0, 0, 0, 0, 0, 0, 0]);
        // The final VRF callback yields the single visible preview row.
        run.provide_vrf_row([2, 2, 0, 0, 0, 0, 0, 0]).unwrap();
        assert_eq!(run.phase, RunPhase::Playing);
        assert_eq!(run.next_row, Some([2, 2, 0, 0, 0, 0, 0, 0]));
    }

    #[test]
    fn line_threshold_bonus_charges_cross_monotonic_boundaries() {
        let source = grid(&[(0, [1, 1, 1, 1, 1, 1, 0, 1])]);
        let mut run = RunEngine::start(source, [0, 0, 0, 0, 0, 0, 0, 1]).unwrap();
        run.bonus = Some(Bonus::Wave);
        let mutator = MutatorRules {
            bonus_trigger_type: 2,
            bonus_threshold: 1,
            ..MutatorRules::default()
        };
        run.play_move(0, 0, 7, 6, LevelRules::default(), mutator)
            .unwrap();
        assert_eq!(run.level_lines_cleared, 1);
        assert_eq!(run.bonus_charges, 1);
    }

    #[test]
    fn constraints_clamp_and_complete() {
        let combo = Constraint {
            kind: ConstraintKind::ComboLines,
            value: 2,
            required_count: 1,
        };
        let report = MoveReport {
            lines_cleared: 2,
            ..MoveReport::default()
        };
        assert_eq!(combo.update(0, &report), 1);
        assert!(combo.is_satisfied(1));
    }

    #[test]
    fn stars_match_neutral_and_biased_campaign_thresholds() {
        assert_eq!(calculate_level_stars(20, 10, 128), 3);
        assert_eq!(calculate_level_stars(20, 15, 128), 2);
        assert_eq!(calculate_level_stars(20, 16, 128), 1);
        assert_eq!(calculate_level_stars(20, 9, 129), 3);
        assert_eq!(calculate_level_stars(20, 10, 129), 2);
        assert_eq!(calculate_level_stars(20, 11, 127), 3);
    }

    #[test]
    fn endless_difficulty_uses_configured_thresholds_and_ramp() {
        let mut rules = EndlessRules::default();
        assert_eq!(rules.difficulty_for_score(24), 0);
        assert_eq!(rules.difficulty_for_score(25), 1);
        assert_eq!(rules.score_multiplier(1), 110);
        rules.ramp_multiplier_x100 = 200;
        assert_eq!(rules.difficulty_for_score(13), 1);
    }

    #[test]
    fn shared_golden_endless_cases_match_rust_domain() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../../fixtures/game-parity.json")).unwrap();
        for fixture in fixtures["endlessCases"].as_array().unwrap() {
            let rules = EndlessRules {
                ramp_multiplier_x100: fixture["rampMultiplierX100"].as_u64().unwrap() as u16,
                ..EndlessRules::default()
            };
            let difficulty = rules.difficulty_for_score(fixture["score"].as_u64().unwrap() as u32);
            assert_eq!(difficulty, fixture["difficulty"].as_u64().unwrap() as u8);
            assert_eq!(
                rules.score_multiplier(difficulty),
                fixture["scoreMultiplierX100"].as_u64().unwrap() as u16
            );
        }
    }

    #[test]
    fn shared_golden_engine_cases_match_rust_domain() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../../fixtures/game-parity.json")).unwrap();
        for fixture in fixtures["engineCases"].as_array().unwrap() {
            let mut rows = Vec::new();
            for row in fixture["inputRows"].as_array().unwrap() {
                rows.push((
                    row["index"].as_u64().unwrap() as usize,
                    fixture_row(&row["cells"]),
                ));
            }
            let level = LevelRules {
                points_required: fixture["level"]["pointsRequired"].as_u64().unwrap() as u32,
                max_moves: fixture["level"]["maxMoves"].as_u64().unwrap() as u16,
                primary: fixture_constraint(&fixture["level"]["primary"]),
                secondary: fixture_constraint(&fixture["level"]["secondary"]),
            };
            let mutator = MutatorRules {
                score_multiplier_x100: fixture["mutator"]["scoreMultiplierX100"].as_u64().unwrap()
                    as u16,
                combo_multiplier_x100: fixture["mutator"]["comboMultiplierX100"].as_u64().unwrap()
                    as u16,
                line_clear_bonus: fixture["mutator"]["lineClearBonus"].as_u64().unwrap() as u16,
                perfect_clear_bonus: fixture["mutator"]["perfectClearBonus"].as_u64().unwrap()
                    as u16,
                star_threshold_modifier: 128,
                bonus_trigger_type: fixture["mutator"]["bonusTriggerType"].as_u64().unwrap() as u8,
                bonus_threshold: fixture["mutator"]["bonusThreshold"].as_u64().unwrap() as u16,
            };
            let mut run = RunEngine::start(grid(&rows), fixture_row(&fixture["nextRow"])).unwrap();
            let movement = fixture["move"].as_array().unwrap();
            let report = run
                .play_move(
                    0,
                    movement[0].as_u64().unwrap() as u8,
                    movement[1].as_u64().unwrap() as u8,
                    movement[2].as_u64().unwrap() as u8,
                    level,
                    mutator,
                )
                .unwrap();
            let expected = &fixture["expected"];
            assert_eq!(
                run.phase,
                match expected["phase"].as_str().unwrap() {
                    "levelComplete" => RunPhase::LevelComplete,
                    "awaitingVrf" => RunPhase::AwaitingVrf,
                    phase => panic!("unknown fixture phase {phase}"),
                },
                "{}",
                fixture["name"]
            );
            assert_eq!(run.score, expected["score"].as_u64().unwrap() as u32);
            assert_eq!(run.moves, expected["moves"].as_u64().unwrap() as u16);
            assert_eq!(
                report.lines_cleared,
                expected["lines"].as_u64().unwrap() as u8
            );
            assert_eq!(
                report.points_earned,
                expected["points"].as_u64().unwrap() as u32
            );
            assert_eq!(run.combo_counter, expected["combo"].as_u64().unwrap() as u8);
            assert_eq!(
                run.primary_progress,
                expected["primaryProgress"].as_u64().unwrap() as u8
            );
            assert_eq!(
                run.bonus_charges,
                expected["bonusCharges"].as_u64().unwrap() as u8
            );
        }
    }

    fn fixture_row(value: &Value) -> Row {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|cell| cell.as_u64().unwrap() as u8)
            .collect::<Vec<_>>()
            .try_into()
            .unwrap()
    }

    fn fixture_constraint(value: &Value) -> Constraint {
        Constraint {
            kind: match value["kind"].as_str().unwrap() {
                "none" => ConstraintKind::None,
                "comboLines" => ConstraintKind::ComboLines,
                "breakBlocks" => ConstraintKind::BreakBlocks,
                "comboStreak" => ConstraintKind::ComboStreak,
                kind => panic!("unknown fixture constraint {kind}"),
            },
            value: value["value"].as_u64().unwrap() as u8,
            required_count: value["requiredCount"].as_u64().unwrap() as u8,
        }
    }

    #[test]
    fn invalid_move_is_atomic_and_keeps_next_row() {
        let source = grid(&[(0, [2, 2, 1, 0, 0, 0, 0, 0])]);
        let next = [1, 0, 0, 0, 0, 0, 0, 0];
        let mut run = RunEngine::start(source, next).unwrap();
        assert!(run
            .play_move(0, 0, 0, 1, LevelRules::default(), MutatorRules::default())
            .is_err());
        assert_eq!(run.grid, source);
        assert_eq!(run.next_row, Some(next));
        assert_eq!(run.moves, 0);
    }

    #[test]
    fn shared_golden_star_cases_match_rust_domain() {
        let fixtures: Value =
            serde_json::from_str(include_str!("../../../../fixtures/game-parity.json")).unwrap();
        for fixture in fixtures["starCases"].as_array().unwrap() {
            assert_eq!(
                calculate_level_stars(
                    fixture["maxMoves"].as_u64().unwrap() as u16,
                    fixture["movesUsed"].as_u64().unwrap() as u16,
                    fixture["modifier"].as_u64().unwrap() as u8,
                ),
                fixture["stars"].as_u64().unwrap() as u8
            );
        }
    }
}
