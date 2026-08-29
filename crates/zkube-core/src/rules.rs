use super::{Bonus, Grid, GridError, Row};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConstraintKind {
    #[default]
    None,
    CombosOfAtLeast,
    BreakBlocks,
    ClearLines,
    CombosOfExactly,
    BigMoves,
    TriggerFired,
    BonusLines,
    BonusBreaks,
    ComboOfAtLeast,
    ComboOfExactly,
    Streak,
    BreakInMove,
    AllWidthsInMove,
    BigMove,
    BonusLinesInMove,
    PerfectClear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConstraintClass {
    Cumulative,
    Moment,
}

impl ConstraintKind {
    #[must_use]
    pub const fn from_tag(tag: u8) -> Option<Self> {
        Some(match tag {
            0 => Self::None,
            1 => Self::CombosOfAtLeast,
            2 => Self::BreakBlocks,
            3 => Self::ClearLines,
            4 => Self::CombosOfExactly,
            5 => Self::BigMoves,
            6 => Self::TriggerFired,
            7 => Self::BonusLines,
            8 => Self::BonusBreaks,
            9 => Self::ComboOfAtLeast,
            10 => Self::ComboOfExactly,
            11 => Self::Streak,
            12 => Self::BreakInMove,
            13 => Self::AllWidthsInMove,
            14 => Self::BigMove,
            15 => Self::BonusLinesInMove,
            16 => Self::PerfectClear,
            _ => return None,
        })
    }

    #[must_use]
    pub const fn tag(self) -> u8 {
        match self {
            Self::None => 0,
            Self::CombosOfAtLeast => 1,
            Self::BreakBlocks => 2,
            Self::ClearLines => 3,
            Self::CombosOfExactly => 4,
            Self::BigMoves => 5,
            Self::TriggerFired => 6,
            Self::BonusLines => 7,
            Self::BonusBreaks => 8,
            Self::ComboOfAtLeast => 9,
            Self::ComboOfExactly => 10,
            Self::Streak => 11,
            Self::BreakInMove => 12,
            Self::AllWidthsInMove => 13,
            Self::BigMove => 14,
            Self::BonusLinesInMove => 15,
            Self::PerfectClear => 16,
        }
    }

    #[must_use]
    pub const fn class(self) -> Option<ConstraintClass> {
        match self {
            Self::None => None,
            Self::CombosOfAtLeast
            | Self::BreakBlocks
            | Self::ClearLines
            | Self::CombosOfExactly
            | Self::BigMoves
            | Self::TriggerFired
            | Self::BonusLines
            | Self::BonusBreaks => Some(ConstraintClass::Cumulative),
            Self::ComboOfAtLeast
            | Self::ComboOfExactly
            | Self::Streak
            | Self::BreakInMove
            | Self::AllWidthsInMove
            | Self::BigMove
            | Self::BonusLinesInMove
            | Self::PerfectClear => Some(ConstraintClass::Moment),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Constraint {
    pub kind: ConstraintKind,
    pub value: u8,
    pub required_count: u8,
}

impl Constraint {
    #[must_use]
    pub const fn is_present(self) -> bool {
        !matches!(self.kind, ConstraintKind::None)
    }

    #[must_use]
    pub const fn has_valid_shape(self) -> bool {
        match self.kind {
            ConstraintKind::None => self.value == 0 && self.required_count == 0,
            ConstraintKind::CombosOfAtLeast | ConstraintKind::CombosOfExactly => {
                self.value >= 2 && self.value <= 8 && self.required_count > 0
            }
            ConstraintKind::BreakBlocks => self.value <= 4 && self.required_count > 0,
            ConstraintKind::ClearLines
            | ConstraintKind::TriggerFired
            | ConstraintKind::BonusLines
            | ConstraintKind::BonusBreaks => self.value == 0 && self.required_count > 0,
            ConstraintKind::BigMoves => self.value > 0 && self.required_count > 0,
            ConstraintKind::ComboOfAtLeast | ConstraintKind::ComboOfExactly => {
                self.value >= 2 && self.value <= 8 && self.required_count == 1
            }
            ConstraintKind::Streak => self.value >= 1 && self.value <= 8 && self.required_count > 0,
            ConstraintKind::BreakInMove => self.value <= 4 && self.required_count > 0,
            ConstraintKind::AllWidthsInMove | ConstraintKind::PerfectClear => {
                self.value == 0 && self.required_count == 1
            }
            ConstraintKind::BigMove | ConstraintKind::BonusLinesInMove => {
                self.value > 0 && self.required_count == 1
            }
        }
    }

    #[must_use]
    pub const fn is_valid_primary(self) -> bool {
        self.has_valid_shape()
            && matches!(self.kind.class(), None | Some(ConstraintClass::Cumulative))
            && (!self.is_present() || self.required_count >= 2)
    }

    #[must_use]
    pub const fn is_valid_secondary(self) -> bool {
        self.has_valid_shape() && matches!(self.kind.class(), None | Some(ConstraintClass::Moment))
    }

    pub fn is_satisfied(self, progress: u8) -> bool {
        self.is_present() && progress >= self.required_count
    }

    fn update(
        self,
        current: u8,
        report: &MoveReport,
        charges_earned: u8,
        level_lines_cleared: u16,
    ) -> u8 {
        let destroyed = |width: u8| {
            if width == 0 {
                report.blocks_destroyed_by_size.into_iter().sum()
            } else {
                width
                    .checked_sub(1)
                    .and_then(|index| report.blocks_destroyed_by_size.get(index as usize))
                    .copied()
                    .unwrap_or(0)
            }
        };
        let player_move = !report.action_was_bonus;
        let completed = |condition: bool| {
            if condition { self.required_count } else { 0 }
        };
        match self.kind {
            ConstraintKind::None => current,
            ConstraintKind::ClearLines => u8::try_from(level_lines_cleared)
                .unwrap_or(u8::MAX)
                .min(self.required_count),
            ConstraintKind::BreakBlocks => current
                .saturating_add(destroyed(self.value))
                .min(self.required_count),
            ConstraintKind::CombosOfAtLeast => {
                if player_move && report.lines_cleared >= self.value {
                    current.saturating_add(1).min(self.required_count)
                } else {
                    current
                }
            }
            ConstraintKind::CombosOfExactly => {
                if player_move && report.lines_cleared == self.value {
                    current.saturating_add(1).min(self.required_count)
                } else {
                    current
                }
            }
            ConstraintKind::BigMoves => {
                if player_move && report.points_earned >= u32::from(self.value) {
                    current.saturating_add(1).min(self.required_count)
                } else {
                    current
                }
            }
            ConstraintKind::TriggerFired => charges_earned.min(self.required_count),
            ConstraintKind::BonusLines => current
                .saturating_add(if report.action_was_bonus {
                    report.lines_cleared
                } else {
                    0
                })
                .min(self.required_count),
            ConstraintKind::BonusBreaks => current
                .saturating_add(if report.action_was_bonus {
                    destroyed(0)
                } else {
                    0
                })
                .min(self.required_count),
            ConstraintKind::ComboOfAtLeast => {
                completed(player_move && report.lines_cleared >= self.value)
            }
            ConstraintKind::ComboOfExactly => {
                completed(player_move && report.lines_cleared == self.value)
            }
            ConstraintKind::Streak => {
                if report.action_was_bonus {
                    current
                } else if report.lines_cleared >= self.value {
                    current.saturating_add(1).min(self.required_count)
                } else {
                    0
                }
            }
            ConstraintKind::BreakInMove => {
                if player_move {
                    destroyed(self.value).min(self.required_count)
                } else {
                    0
                }
            }
            ConstraintKind::AllWidthsInMove => completed(
                player_move
                    && report
                        .blocks_destroyed_by_size
                        .iter()
                        .all(|destroyed| *destroyed > 0),
            ),
            ConstraintKind::BigMove => {
                completed(player_move && report.points_earned >= u32::from(self.value))
            }
            ConstraintKind::BonusLinesInMove => {
                completed(report.action_was_bonus && report.lines_cleared >= self.value)
            }
            ConstraintKind::PerfectClear => completed(report.perfect_clear),
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

impl LevelRules {
    /// The contiguous number of authored star sources. A secondary without a
    /// primary is invalid catalog content and cannot create a gap in stars.
    #[must_use]
    pub const fn earnable_stars(self) -> u8 {
        if !self.primary.is_present() {
            1
        } else if !self.secondary.is_present() {
            2
        } else {
            3
        }
    }

    #[must_use]
    pub const fn has_contiguous_star_sources(self) -> bool {
        !self.secondary.is_present() || self.primary.is_present()
    }

    #[must_use]
    pub const fn has_valid_constraint_classes(self) -> bool {
        matches!(
            self.primary.kind.class(),
            None | Some(ConstraintClass::Cumulative)
        ) && matches!(
            self.secondary.kind.class(),
            None | Some(ConstraintClass::Moment)
        )
    }

    /// A Blow must add a new fact after its cumulative Shape. This rejects
    /// exact fact containment; geometric overlap remains authored balance.
    #[must_use]
    pub const fn has_distinct_constraint_facts(
        self,
        bonus_trigger_type: u8,
        bonus_threshold: u16,
    ) -> bool {
        let primary = self.primary;
        let secondary = self.secondary;
        let secondary_is_trigger = match bonus_trigger_type {
            1 => {
                matches!(secondary.kind, ConstraintKind::ComboOfAtLeast)
                    && secondary.value as u16 == bonus_threshold
            }
            4 => {
                matches!(secondary.kind, ConstraintKind::ComboOfExactly)
                    && secondary.value as u16 == bonus_threshold
            }
            6 => matches!(secondary.kind, ConstraintKind::AllWidthsInMove),
            8 => {
                matches!(secondary.kind, ConstraintKind::BreakInMove)
                    && secondary.value == 0
                    && secondary.required_count as u16 == bonus_threshold
            }
            9 => {
                matches!(secondary.kind, ConstraintKind::Streak)
                    && secondary.value == 1
                    && secondary.required_count as u16 == bonus_threshold
            }
            _ => false,
        };
        let contained = match primary.kind {
            ConstraintKind::CombosOfExactly => match secondary.kind {
                ConstraintKind::ComboOfExactly => secondary.value == primary.value,
                ConstraintKind::ComboOfAtLeast => secondary.value <= primary.value,
                _ => false,
            },
            ConstraintKind::CombosOfAtLeast => {
                matches!(secondary.kind, ConstraintKind::ComboOfAtLeast)
                    && secondary.value <= primary.value
            }
            ConstraintKind::BigMoves => {
                matches!(secondary.kind, ConstraintKind::BigMove)
                    && secondary.value <= primary.value
            }
            ConstraintKind::BonusLines => {
                matches!(secondary.kind, ConstraintKind::BonusLinesInMove) && secondary.value == 1
            }
            ConstraintKind::TriggerFired => secondary_is_trigger,
            _ => false,
        };
        !contained
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MutatorRules {
    pub score_multiplier_x100: u16,
    pub combo_multiplier_x100: u16,
    pub line_clear_bonus: u16,
    pub perfect_clear_bonus: u16,
    /// 0=None, 1=N+ move lines, 2=cumulative move lines, 4=exact move lines,
    /// 6=all block sizes in one move, 7=combo-count boundary, 8=N+ blocks in
    /// one move, 9=N consecutive line-clearing moves.
    pub bonus_trigger_type: u8,
    pub bonus_threshold: u16,
}

/// Validates the one shared threshold convention for renewable bonus triggers.
/// The event-shaped all-block-sizes trigger carries zero because its condition
/// has no authored numeric parameter; every numeric trigger carries a positive
/// threshold.
#[must_use]
pub const fn bonus_trigger_threshold_is_valid(trigger_type: u8, threshold: u16) -> bool {
    match trigger_type {
        0 | 6 => threshold == 0,
        1 | 2 | 4 | 7 | 8 | 9 => threshold > 0,
        _ => false,
    }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunMode {
    Campaign,
    Daily,
}

/// Shared upper bound for held guardian-bonus and reroll inventories.
pub const BONUS_CHARGE_CAP: u8 = 3;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MoveReport {
    pub lines_cleared: u8,
    pub points_earned: u32,
    /// Saturating count of player moves that cleared at least two lines.
    pub combo_counter: u8,
    pub height_before: u8,
    pub height_after: u8,
    pub perfect_clear: bool,
    /// True only for a guardian bonus action. Rerolls produce no move report.
    pub action_was_bonus: bool,
    pub blocks_destroyed_by_size: [u8; 4],
    /// Neutral points before passive/endless multipliers and flat bonuses.
    pub neutral_points_earned: u32,
    /// Difficulty tier used to score the action.
    pub difficulty_at_action: u8,
    /// Charges produced by this transition before the engine's inventory cap.
    /// The engine also persists their saturating run total.
    pub charges_earned: u8,
    /// Whether the consumed preview could not enter after the first settle.
    /// This distinguishes overflow from move-budget exhaustion in experiments.
    pub preview_insertion_blocked: bool,
    /// A mode-specific reroll grant was added to the held inventory.
    pub reroll_granted: bool,
    /// A mode-specific reroll grant was due but the inventory was full.
    pub reroll_grant_discarded: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ActionContext {
    height_before: u8,
    block_cells_before: [u8; 4],
    lines: u8,
    base_point_parts: [u16; 2],
    row_insertion_blocked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunError {
    InvalidPhase,
    MoveLimitReached,
    MissingNextRow,
    RowAlreadyAvailable,
    InvalidExpectedMove,
    NoBonusCharge,
    NoRerollAvailable,
    RerollRequiresVrf,
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
    /// Saturating count of player moves that cleared at least two lines.
    pub combo_counter: u8,
    pub max_combo: u8,
    pub primary_progress: u8,
    pub secondary_progress: u8,
    /// Latched one-to-three-star Campaign result. Daily rules keep this at zero.
    pub earned_stars: u8,
    /// Consecutive player moves that each clear at least one line.
    pub streak: u8,
    /// Guardian trigger events produced across the run, before inventory caps.
    pub charges_earned: u8,
    pub level_lines_cleared: u16,
    pub bonus: Option<Bonus>,
    pub bonus_charges: u8,
    /// Held preview replacements, independent of guardian bonus identity.
    pub reroll_charges: u8,
    pub starting_height_target: u8,
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
            earned_stars: 0,
            streak: 0,
            charges_earned: 0,
            level_lines_cleared: 0,
            bonus: None,
            bonus_charges: 0,
            reroll_charges: 1,
            starting_height_target: 0,
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
        if self.starting_height_target > 0 {
            self.grid.insert_bottom_row(row)?;
            // Settle the seed stack exactly like Cairo's initialize_grid, which
            // runs assess_game (gravity + line clears) after every add_line.
            // Without this the independently-generated seed rows leave blocks
            // hanging over empty cells (floating cubes) and the first move's
            // settle retroactively collapses/mis-scores the board. Seed-phase
            // clears are discarded — they never count toward the run.
            let _ = self.grid.settle();
            if self.grid.occupied_height() >= self.starting_height_target {
                self.starting_height_target = 0;
            }
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

    #[allow(clippy::too_many_arguments)]
    pub fn play_move(
        &mut self,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
        level: LevelRules,
        mutator: MutatorRules,
        mode: RunMode,
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
        let height_before = self.grid.occupied_height();
        let grid_block_cells_before =
            core::array::from_fn(|index| self.grid.count_cells_of_size(index as u8 + 1));
        let block_cells_with_preview = core::array::from_fn(|index| {
            let size = index as u8 + 1;
            grid_block_cells_before[index]
                .saturating_add(next_row.iter().filter(|cell| **cell == size).count() as u8)
        });

        if let Err(error) = self.grid.swipe(row, start, destination) {
            self.next_row = Some(next_row);
            self.grid = before;
            return Err(error.into());
        }
        let (first_lines, first_points) = self.grid.settle();
        if self.grid.is_full() {
            return Ok(self.finish_move_with_mode(
                ActionContext {
                    height_before,
                    // The preview was consumed but never entered the grid, so
                    // it must not become invented destroyed-block credit.
                    block_cells_before: grid_block_cells_before,
                    lines: first_lines,
                    base_point_parts: [first_points, 0],
                    row_insertion_blocked: true,
                },
                level,
                mutator,
                mode,
            ));
        }

        self.grid.insert_bottom_row(next_row)?;
        // Cairo carries one line counter through both settle phases of the
        // action. The inserted row can complete another line, which must keep
        // climbing the same triangular score curve instead of restarting at 1.
        let (second_lines, second_points) = self.grid.settle_after(first_lines);
        let report = self.finish_move_with_mode(
            ActionContext {
                height_before,
                block_cells_before: block_cells_with_preview,
                lines: first_lines.saturating_add(second_lines),
                base_point_parts: [first_points, second_points],
                row_insertion_blocked: false,
            },
            level,
            mutator,
            mode,
        );
        Ok(report)
    }

    pub fn apply_bonus(
        &mut self,
        row: u8,
        column: u8,
        level: LevelRules,
        mutator: MutatorRules,
        mode: RunMode,
    ) -> Result<MoveReport, RunError> {
        if self.phase != RunPhase::Playing {
            return Err(RunError::InvalidPhase);
        }
        let bonus = self.bonus.ok_or(RunError::NoBonusCharge)?;
        if self.bonus_charges == 0 {
            return Err(RunError::NoBonusCharge);
        }
        let height_before = self.grid.occupied_height();
        let block_cells_before =
            core::array::from_fn(|index| self.grid.count_cells_of_size(index as u8 + 1));
        self.grid.apply_bonus(bonus, row, column)?;
        self.bonus_charges -= 1;
        let (lines, base_points) = self.grid.settle();
        let report = self.finish_action_with_mode(
            ActionContext {
                height_before,
                block_cells_before,
                lines,
                base_point_parts: [base_points, 0],
                row_insertion_blocked: false,
            },
            level,
            mutator,
            mode,
            false,
            true,
        );
        if report.perfect_clear && self.phase == RunPhase::Playing {
            let preview = self.next_row.take().ok_or(RunError::MissingNextRow)?;
            self.grid.insert_bottom_row(preview)?;
            // VRF rows always contain a hole, so this is a gravity-only
            // continuation and cannot create unreported score.
            let _ = self.grid.settle();
            self.phase = RunPhase::AwaitingVrf;
        }
        Ok(report)
    }

    /// Consume one held reroll and wait for a replacement preview row.
    ///
    /// The current preview stays visible in state until verified randomness
    /// atomically replaces it, so a failed callback cannot strand the run
    /// without a playable row.
    pub fn request_reroll(&mut self) -> Result<(), RunError> {
        if self.phase != RunPhase::Playing {
            return Err(RunError::RerollRequiresVrf);
        }
        if self.reroll_charges == 0 {
            return Err(RunError::NoRerollAvailable);
        }
        if self.next_row.is_none() {
            return Err(RunError::MissingNextRow);
        }
        self.reroll_charges -= 1;
        self.phase = RunPhase::AwaitingVrf;
        Ok(())
    }

    /// Replace the preview for a pending reroll without changing the board or
    /// consuming a move.
    pub fn provide_reroll_row(&mut self, row: Row) -> Result<(), RunError> {
        if !self.reroll_pending() {
            return Err(RunError::RerollRequiresVrf);
        }
        Grid::validate_row(&row)?;
        self.next_row = Some(row);
        self.phase = RunPhase::Playing;
        Ok(())
    }

    #[must_use]
    pub const fn reroll_pending(&self) -> bool {
        matches!(self.phase, RunPhase::AwaitingVrf) && self.next_row.is_some()
    }

    pub fn level_satisfied(&self, rules: LevelRules) -> bool {
        self.earned_stars == rules.earnable_stars()
    }

    #[cfg(test)]
    fn finish_move(
        &mut self,
        context: ActionContext,
        level: LevelRules,
        mutator: MutatorRules,
    ) -> MoveReport {
        self.finish_move_with_mode(context, level, mutator, RunMode::Campaign)
    }

    fn finish_move_with_mode(
        &mut self,
        context: ActionContext,
        level: LevelRules,
        mutator: MutatorRules,
        mode: RunMode,
    ) -> MoveReport {
        self.moves = self.moves.saturating_add(1);
        self.finish_action_with_mode(context, level, mutator, mode, true, false)
    }

    #[cfg(test)]
    fn finish_action(
        &mut self,
        context: ActionContext,
        level: LevelRules,
        mutator: MutatorRules,
        needs_next_row: bool,
    ) -> MoveReport {
        self.finish_action_with_mode(
            context,
            level,
            mutator,
            RunMode::Campaign,
            needs_next_row,
            false,
        )
    }

    #[cfg(test)]
    fn finish_action_with_kind(
        &mut self,
        context: ActionContext,
        level: LevelRules,
        mutator: MutatorRules,
        needs_next_row: bool,
        action_was_bonus: bool,
    ) -> MoveReport {
        self.finish_action_with_mode(
            context,
            level,
            mutator,
            RunMode::Campaign,
            needs_next_row,
            action_was_bonus,
        )
    }

    fn finish_action_with_mode(
        &mut self,
        context: ActionContext,
        level: LevelRules,
        mutator: MutatorRules,
        mode: RunMode,
        needs_next_row: bool,
        action_was_bonus: bool,
    ) -> MoveReport {
        let ActionContext {
            height_before,
            block_cells_before,
            lines,
            base_point_parts,
            row_insertion_blocked,
        } = context;
        if needs_next_row {
            self.streak = if lines >= 1 {
                self.streak.saturating_add(1)
            } else {
                0
            };
        }
        let combo_before = self.combo_counter;
        if needs_next_row && lines > 1 {
            self.combo_counter = self.combo_counter.saturating_add(1);
            self.max_combo = self.max_combo.max(lines);
        }
        let perfect_clear = self.grid.is_empty();
        let lines_before = self.level_lines_cleared;
        // Cairo applies the flat multiplier to each settle phase separately,
        // so preserve the same integer-floor behavior instead of multiplying
        // their sum.
        let neutral_points = base_point_parts.into_iter().map(u32::from).sum::<u32>();
        let mut points = score_base_parts(base_point_parts, mutator.score_multiplier_x100);
        points = points.saturating_add(lines as u32 * mutator.line_clear_bonus as u32);
        if lines > 1 {
            points = scale(points, mutator.combo_multiplier_x100);
        }
        if perfect_clear {
            points = points.saturating_add(mutator.perfect_clear_bonus as u32);
        }
        self.score = self.score.saturating_add(points);
        if needs_next_row {
            self.level_lines_cleared = self.level_lines_cleared.saturating_add(u16::from(lines));
        }

        let blocks_destroyed_by_size = core::array::from_fn(|index| {
            let size = index as u8 + 1;
            block_cells_before[index].saturating_sub(self.grid.count_cells_of_size(size)) / size
        });
        let mut report = MoveReport {
            lines_cleared: lines,
            points_earned: points,
            combo_counter: self.combo_counter,
            height_before,
            height_after: self.grid.occupied_height(),
            perfect_clear,
            action_was_bonus,
            blocks_destroyed_by_size,
            neutral_points_earned: neutral_points,
            difficulty_at_action: 0,
            charges_earned: 0,
            preview_insertion_blocked: row_insertion_blocked,
            reroll_granted: false,
            reroll_grant_discarded: false,
        };
        let charges = match mutator.bonus_trigger_type {
            1 if needs_next_row
                && mutator.bonus_threshold > 0
                && u16::from(lines) >= mutator.bonus_threshold =>
            {
                1
            }
            2 if needs_next_row && mutator.bonus_threshold > 0 => {
                self.level_lines_cleared / mutator.bonus_threshold
                    - lines_before / mutator.bonus_threshold
            }
            4 if needs_next_row && u16::from(lines) == mutator.bonus_threshold => 1,
            6 if needs_next_row
                && blocks_destroyed_by_size
                    .iter()
                    .all(|destroyed| *destroyed > 0) =>
            {
                1
            }
            7 if needs_next_row
                && mutator.bonus_threshold > 0
                && u16::from(self.combo_counter) / mutator.bonus_threshold
                    > u16::from(combo_before) / mutator.bonus_threshold =>
            {
                1
            }
            8 if needs_next_row
                && blocks_destroyed_by_size
                    .into_iter()
                    .map(u16::from)
                    .sum::<u16>()
                    >= mutator.bonus_threshold =>
            {
                1
            }
            9 if needs_next_row && u16::from(self.streak) == mutator.bonus_threshold => 1,
            _ => 0,
        };
        report.charges_earned = charges.min(u16::from(u8::MAX)) as u8;
        self.charges_earned = self.charges_earned.saturating_add(report.charges_earned);
        self.bonus_charges = self
            .bonus_charges
            .saturating_add(charges.min(u16::from(u8::MAX)) as u8)
            .min(BONUS_CHARGE_CAP);
        self.primary_progress = level.primary.update(
            self.primary_progress,
            &report,
            self.charges_earned,
            self.level_lines_cleared,
        );
        self.secondary_progress = level.secondary.update(
            self.secondary_progress,
            &report,
            self.charges_earned,
            self.level_lines_cleared,
        );

        // Star sources latch in order after all action facts and constraint
        // progress are current. Independent `if`s deliberately allow one
        // action to cross all three sources. `None` is never an earned source.
        let old_earned_stars = self.earned_stars;
        if self.earned_stars == 0 && self.score >= level.points_required {
            self.earned_stars = 1;
        }
        if self.earned_stars == 1
            && level.primary.is_present()
            && level.primary.is_satisfied(self.primary_progress)
        {
            self.earned_stars = 2;
        }
        if self.earned_stars == 2
            && level.primary.is_present()
            && level.secondary.is_present()
            && level.secondary.is_satisfied(self.secondary_progress)
        {
            self.earned_stars = 3;
        }

        let reroll_grant_due = match mode {
            RunMode::Campaign => old_earned_stars < 2 && self.earned_stars >= 2,
            RunMode::Daily => report.perfect_clear,
        };
        if reroll_grant_due {
            if self.reroll_charges < BONUS_CHARGE_CAP {
                self.reroll_charges += 1;
                report.reroll_granted = true;
            } else {
                report.reroll_grant_discarded = true;
            }
        }

        // Occupying row ten is legal. A run ends only when a move has settled
        // and still cannot insert its visible preview row (the attempted
        // eleventh row). Completion takes precedence when that same action
        // satisfies the level.
        if self.level_satisfied(level) {
            self.phase = RunPhase::LevelComplete;
        } else if row_insertion_blocked || self.moves >= level.max_moves {
            self.phase = RunPhase::Finished;
        } else if needs_next_row {
            self.phase = RunPhase::AwaitingVrf;
        }
        // Ensure the returned report always reflects the final combo value.
        report.combo_counter = self.combo_counter;
        report
    }
}

fn scale(value: u32, multiplier_x100: u16) -> u32 {
    value
        .saturating_mul(multiplier_x100.max(1) as u32)
        .saturating_div(100)
}

fn score_base_parts(parts: [u16; 2], multiplier_x100: u16) -> u32 {
    parts
        .into_iter()
        .map(|part| scale(u32::from(part), multiplier_x100))
        .fold(0u32, u32::saturating_add)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::GRID_CELLS;
    use serde_json::Value;
    use std::{vec, vec::Vec};

    #[test]
    fn trigger_threshold_semantics_are_exhaustive() {
        for trigger_type in 0..=10 {
            assert_eq!(
                bonus_trigger_threshold_is_valid(trigger_type, 0),
                matches!(trigger_type, 0 | 6),
            );
            assert_eq!(
                bonus_trigger_threshold_is_valid(trigger_type, 1),
                matches!(trigger_type, 1 | 2 | 4 | 7 | 8 | 9),
            );
        }
    }

    fn grid(rows: &[(usize, Row)]) -> Grid {
        let mut cells = [0; GRID_CELLS];
        for (index, row) in rows {
            cells[index * 8..(index + 1) * 8].copy_from_slice(row);
        }
        Grid::try_from_cells(cells).unwrap()
    }

    fn campaign_v2_mutators() -> Vec<MutatorRules> {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/campaign-v2.json")).unwrap();
        fixture["maps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|map| {
                let rules = map["rules"].as_array().unwrap();
                MutatorRules {
                    score_multiplier_x100: rules[0].as_u64().unwrap() as u16,
                    combo_multiplier_x100: rules[1].as_u64().unwrap() as u16,
                    line_clear_bonus: rules[2].as_u64().unwrap() as u16,
                    perfect_clear_bonus: rules[3].as_u64().unwrap() as u16,
                    bonus_trigger_type: rules[5].as_u64().unwrap() as u8,
                    bonus_threshold: rules[6].as_u64().unwrap() as u16,
                }
            })
            .collect()
    }

    fn campaign_v2_constraint(value: &Value) -> Constraint {
        let tuple = value.as_array().unwrap();
        Constraint {
            kind: ConstraintKind::from_tag(tuple[0].as_u64().unwrap() as u8)
                .expect("known Campaign constraint kind"),
            value: tuple[1].as_u64().unwrap() as u8,
            required_count: tuple[2].as_u64().unwrap() as u8,
        }
    }

    #[test]
    fn campaign_v2_levels_have_constructive_accounting_completions() {
        fn constructive_action(
            constraint: Constraint,
            progress: u8,
            streak: u8,
            points_required: u32,
            mutator: MutatorRules,
        ) -> (ActionContext, bool, bool) {
            let mut lines = 4u8;
            let mut block_cells_before = [0; 4];
            let mut base_points = points_required
                .max(u32::from(constraint.value))
                .min(u32::from(u16::MAX)) as u16;
            let mut needs_next_row = true;
            let mut action_was_bonus = false;
            match constraint.kind {
                ConstraintKind::None | ConstraintKind::PerfectClear => {}
                ConstraintKind::CombosOfAtLeast | ConstraintKind::ComboOfAtLeast => {
                    lines = constraint.value;
                }
                ConstraintKind::CombosOfExactly | ConstraintKind::ComboOfExactly => {
                    lines = constraint.value;
                }
                ConstraintKind::BreakBlocks => {
                    let remaining = constraint.required_count.saturating_sub(progress);
                    let width = constraint.value.max(1);
                    block_cells_before[usize::from(width - 1)] = remaining.saturating_mul(width);
                }
                ConstraintKind::BreakInMove => {
                    let width = constraint.value.max(1);
                    block_cells_before[usize::from(width - 1)] =
                        constraint.required_count.saturating_mul(width);
                }
                ConstraintKind::ClearLines => {
                    lines = constraint.required_count.saturating_sub(progress).max(1);
                }
                ConstraintKind::BigMoves | ConstraintKind::BigMove => {
                    base_points = base_points.max(u16::from(constraint.value));
                }
                ConstraintKind::TriggerFired => match mutator.bonus_trigger_type {
                    1 | 4 => {
                        lines = u8::try_from(mutator.bonus_threshold).unwrap_or(u8::MAX);
                    }
                    2 => {
                        lines = u8::try_from(mutator.bonus_threshold).unwrap_or(u8::MAX);
                    }
                    5 => {}
                    6 => block_cells_before = [1, 2, 3, 4],
                    7 => lines = 2,
                    8 => {
                        block_cells_before[0] =
                            u8::try_from(mutator.bonus_threshold).unwrap_or(u8::MAX);
                    }
                    9 => {
                        lines = u8::from(
                            streak < u8::try_from(mutator.bonus_threshold).unwrap_or(u8::MAX),
                        );
                    }
                    _ => panic!("authored trigger must have constructive semantics"),
                },
                ConstraintKind::BonusLines | ConstraintKind::BonusLinesInMove => {
                    lines = constraint
                        .required_count
                        .saturating_sub(progress)
                        .max(constraint.value);
                    needs_next_row = false;
                    action_was_bonus = true;
                }
                ConstraintKind::BonusBreaks => {
                    block_cells_before[0] =
                        constraint.required_count.saturating_sub(progress).max(1);
                    needs_next_row = false;
                    action_was_bonus = true;
                }
                ConstraintKind::Streak => lines = constraint.value,
                ConstraintKind::AllWidthsInMove => block_cells_before = [1, 2, 3, 4],
            }
            let triangular = u16::from(lines) * u16::from(lines + 1) / 2;
            (
                ActionContext {
                    block_cells_before,
                    lines,
                    base_point_parts: [base_points.max(triangular), 0],
                    ..ActionContext::default()
                },
                needs_next_row,
                action_was_bonus,
            )
        }

        let fixture: Value =
            serde_json::from_str(include_str!("../../../fixtures/campaign-v2.json")).unwrap();
        let mutators = campaign_v2_mutators();
        for (map_index, map) in fixture["maps"].as_array().unwrap().iter().enumerate() {
            for (level_index, value) in map["levels"].as_array().unwrap().iter().enumerate() {
                let tuple = value.as_array().unwrap();
                let level = LevelRules {
                    points_required: tuple[0].as_u64().unwrap() as u32,
                    max_moves: tuple[1].as_u64().unwrap() as u16,
                    primary: campaign_v2_constraint(&tuple[3]),
                    secondary: campaign_v2_constraint(&tuple[4]),
                };
                let mut run = RunEngine {
                    phase: RunPhase::Playing,
                    ..RunEngine::default()
                };
                for _ in 0..level.max_moves {
                    if run.level_satisfied(level) {
                        break;
                    }
                    run.phase = RunPhase::Playing;
                    run.moves = run.moves.saturating_add(1);
                    let (constraint, progress) = if level.primary.is_satisfied(run.primary_progress)
                    {
                        (level.secondary, run.secondary_progress)
                    } else {
                        (level.primary, run.primary_progress)
                    };
                    let (context, needs_next_row, action_was_bonus) = constructive_action(
                        constraint,
                        progress,
                        run.streak,
                        level.points_required,
                        mutators[map_index],
                    );
                    run.finish_action_with_kind(
                        context,
                        level,
                        mutators[map_index],
                        needs_next_row,
                        action_was_bonus,
                    );
                }
                assert!(
                    run.level_satisfied(level),
                    "constructive accounting did not complete map {} level {} within {} moves",
                    map_index + 1,
                    level_index + 1,
                    level.max_moves,
                );
            }
        }
    }

    #[test]
    fn campaign_v2_scoring_synergies_are_exact_for_moves_and_bonus_actions() {
        let mutators = campaign_v2_mutators();
        let expected_single = [2, 1, 2, 2, 4, 2, 3, 1, 3, 2];
        let expected_combo = [5, 4, 10, 6, 9, 10, 9, 6, 14, 17];
        let expected_perfect_four = [14, 35, 28, 35, 22, 38, 50, 20, 36, 92];
        let incomplete = LevelRules {
            points_required: u32::MAX,
            max_moves: u16::MAX,
            primary: Constraint::default(),
            secondary: Constraint::default(),
        };
        let bonus_level = LevelRules {
            primary: Constraint {
                kind: ConstraintKind::CombosOfAtLeast,
                value: 2,
                required_count: 1,
            },
            secondary: Constraint {
                kind: ConstraintKind::ComboOfAtLeast,
                value: 2,
                required_count: 1,
            },
            ..incomplete
        };

        for (index, mutator) in mutators.into_iter().enumerate() {
            let occupied = || RunEngine {
                grid: grid(&[(0, [1, 0, 0, 0, 0, 0, 0, 0])]),
                phase: RunPhase::Playing,
                ..RunEngine::default()
            };
            let mut single = occupied();
            let single_report = single.finish_action(
                ActionContext {
                    lines: 1,
                    base_point_parts: [1, 0],
                    ..ActionContext::default()
                },
                incomplete,
                mutator,
                true,
            );
            assert_eq!(single_report.points_earned, expected_single[index]);

            let mut combo = occupied();
            let combo_report = combo.finish_action(
                ActionContext {
                    lines: 2,
                    base_point_parts: [3, 0],
                    ..ActionContext::default()
                },
                incomplete,
                mutator,
                true,
            );
            assert_eq!(combo_report.points_earned, expected_combo[index]);

            let mut perfect = RunEngine {
                phase: RunPhase::Playing,
                ..RunEngine::default()
            };
            let perfect_report = perfect.finish_action(
                ActionContext {
                    lines: 4,
                    base_point_parts: [6, 4],
                    ..ActionContext::default()
                },
                incomplete,
                mutator,
                true,
            );
            assert_eq!(perfect_report.points_earned, expected_perfect_four[index]);

            // Bonus actions share score, combo, and constraint accounting but
            // do not spend a move or advance move-only trigger counters.
            let mut bonus = occupied();
            let bonus_report = bonus.finish_action(
                ActionContext {
                    lines: 2,
                    base_point_parts: [3, 0],
                    ..ActionContext::default()
                },
                bonus_level,
                mutator,
                false,
            );
            assert_eq!(bonus_report.points_earned, expected_combo[index]);
            assert_eq!(bonus.moves, 0);
            assert_eq!((bonus.primary_progress, bonus.secondary_progress), (1, 1));
        }
    }

    #[test]
    fn move_consumes_visible_row_then_requires_fresh_vrf() {
        let source = grid(&[(0, [1, 1, 1, 1, 1, 1, 0, 1])]);
        let mut run = RunEngine::start(source, [0, 0, 0, 0, 0, 0, 0, 1]).unwrap();
        let report = run
            .play_move(
                0,
                0,
                7,
                6,
                LevelRules::default(),
                MutatorRules::default(),
                RunMode::Campaign,
            )
            .unwrap();
        assert_eq!(report.lines_cleared, 1);
        assert_eq!(report.points_earned, 1);
        assert!(!report.action_was_bonus);
        assert_eq!(run.phase, RunPhase::LevelComplete);
        assert_eq!(run.moves, 1);
        assert!(run.next_row.is_none());
    }

    #[test]
    fn tenth_row_is_playable_and_only_the_next_insertion_ends_the_run() {
        let sparse = [1, 0, 0, 0, 0, 0, 0, 0];
        let rows = (0..9).map(|row| (row, sparse)).collect::<Vec<_>>();
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let mut run = RunEngine::start(grid(&rows), sparse).unwrap();

        let tenth_row = run
            .play_move(
                0,
                0,
                0,
                0,
                level,
                MutatorRules::default(),
                RunMode::Campaign,
            )
            .unwrap();
        assert_eq!(tenth_row.height_after, 10);
        assert_eq!(run.grid.occupied_height(), 10);
        assert_eq!(run.phase, RunPhase::AwaitingVrf);
        assert_eq!(run.moves, 1);
        assert!(run.next_row.is_none());

        run.provide_vrf_row(sparse).unwrap();
        let before_overflow = run.grid;
        let overflow = run
            .play_move(
                1,
                0,
                0,
                0,
                level,
                MutatorRules::default(),
                RunMode::Campaign,
            )
            .unwrap();
        assert_eq!(overflow.height_after, 10);
        assert_eq!(overflow.blocks_destroyed_by_size, [0; 4]);
        assert_eq!(run.grid, before_overflow);
        assert_eq!(run.phase, RunPhase::Finished);
        assert_eq!(run.moves, 2);
        assert!(run.next_row.is_none());
    }

    #[test]
    fn move_that_clears_space_at_capacity_can_insert_its_preview() {
        let sparse = [1, 0, 0, 0, 0, 0, 0, 0];
        let mut rows = vec![(0, [1; 8])];
        rows.extend((1..10).map(|row| (row, sparse)));
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let mut run = RunEngine::start(grid(&rows), sparse).unwrap();

        let report = run
            .play_move(
                0,
                1,
                0,
                0,
                level,
                MutatorRules::default(),
                RunMode::Campaign,
            )
            .unwrap();

        assert_eq!(report.lines_cleared, 1);
        assert_eq!(run.grid.occupied_height(), 10);
        assert_eq!(run.phase, RunPhase::AwaitingVrf);
        assert_eq!(run.moves, 1);
    }

    #[test]
    fn bonus_on_a_ten_row_grid_does_not_end_the_run() {
        let sparse = [1, 0, 0, 0, 0, 0, 0, 0];
        let mut rows = vec![(0, [1, 0, 2, 2, 0, 0, 0, 0])];
        rows.extend((1..10).map(|row| (row, sparse)));
        let mut run = RunEngine::start(grid(&rows), sparse).unwrap();
        run.bonus = Some(Bonus::Totem);
        run.bonus_charges = 1;

        run.apply_bonus(
            0,
            2,
            LevelRules {
                points_required: u32::MAX,
                max_moves: 20,
                ..LevelRules::default()
            },
            MutatorRules::default(),
            RunMode::Campaign,
        )
        .unwrap();

        assert_eq!(run.grid.occupied_height(), 10);
        assert_eq!(run.phase, RunPhase::Playing);
        assert_eq!(run.moves, 0);
        assert_eq!(run.bonus_charges, 0);
    }

    #[test]
    fn reroll_inventory_is_separate_from_guardian_bonus_inventory() {
        let preview = [1, 0, 0, 0, 0, 0, 0, 0];
        let replacement = [0, 0, 2, 2, 0, 0, 0, 0];
        let mut run = RunEngine::start(Grid::EMPTY, preview).unwrap();
        run.bonus = Some(Bonus::Hammer);
        run.bonus_charges = 2;

        run.request_reroll().unwrap();
        assert_eq!(run.reroll_charges, 0);
        assert_eq!(run.bonus, Some(Bonus::Hammer));
        assert_eq!(run.bonus_charges, 2);
        assert_eq!(run.next_row, Some(preview));
        run.provide_reroll_row(replacement).unwrap();
        assert_eq!(run.next_row, Some(replacement));
        assert_eq!(run.bonus_charges, 2);
        assert_eq!(run.request_reroll(), Err(RunError::NoRerollAvailable));
    }

    #[test]
    fn campaign_second_star_grants_one_held_reroll_once() {
        let level = LevelRules {
            points_required: 1,
            max_moves: 20,
            primary: Constraint {
                kind: ConstraintKind::CombosOfAtLeast,
                value: 2,
                required_count: 1,
            },
            secondary: Constraint {
                kind: ConstraintKind::ComboOfExactly,
                value: 2,
                required_count: 1,
            },
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        let report = run.finish_action_with_mode(
            ActionContext {
                lines: 2,
                base_point_parts: [1, 0],
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            RunMode::Campaign,
            true,
            false,
        );
        assert_eq!(run.earned_stars, 3, "a direct jump still crosses star two");
        assert_eq!(run.reroll_charges, 2);
        assert!(report.reroll_granted);
        assert!(!report.reroll_grant_discarded);

        run.phase = RunPhase::Playing;
        let repeated = run.finish_action_with_mode(
            ActionContext {
                lines: 2,
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            RunMode::Campaign,
            true,
            false,
        );
        assert_eq!(run.reroll_charges, 2);
        assert!(!repeated.reroll_granted);

        run.phase = RunPhase::Playing;
        run.next_row = Some([1, 0, 0, 0, 0, 0, 0, 0]);
        run.request_reroll().unwrap();
        assert_eq!(run.reroll_charges, 1);
    }

    #[test]
    fn daily_perfect_clear_grants_or_discards_at_the_reroll_cap() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        let granted = run.finish_action_with_mode(
            ActionContext::default(),
            level,
            MutatorRules::default(),
            RunMode::Daily,
            true,
            false,
        );
        assert_eq!(run.reroll_charges, 2);
        assert!(granted.reroll_granted);
        assert!(!granted.reroll_grant_discarded);

        run.phase = RunPhase::Playing;
        run.reroll_charges = BONUS_CHARGE_CAP;
        let discarded = run.finish_action_with_mode(
            ActionContext::default(),
            level,
            MutatorRules::default(),
            RunMode::Daily,
            true,
            false,
        );
        assert_eq!(run.reroll_charges, BONUS_CHARGE_CAP);
        assert!(!discarded.reroll_granted);
        assert!(discarded.reroll_grant_discarded);
    }

    #[test]
    fn level_completion_wins_when_the_same_move_cannot_insert_row_eleven() {
        let sparse = [1, 0, 0, 0, 0, 0, 0, 0];
        let rows = (0..10).map(|row| (row, sparse)).collect::<Vec<_>>();
        let mut run = RunEngine::start(grid(&rows), sparse).unwrap();

        run.play_move(
            0,
            0,
            0,
            0,
            LevelRules {
                points_required: 0,
                max_moves: 20,
                ..LevelRules::default()
            },
            MutatorRules::default(),
            RunMode::Campaign,
        )
        .unwrap();

        assert_eq!(run.phase, RunPhase::LevelComplete);
        assert_eq!(run.moves, 1);
        assert_eq!(run.grid.occupied_height(), 10);
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
    fn configured_seed_height_is_measured_after_settle() {
        let mut run = RunEngine {
            phase: RunPhase::AwaitingVrf,
            starting_height_target: 2,
            ..RunEngine::default()
        };
        run.provide_vrf_row([1, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        assert_eq!(run.starting_height_target, 2);
        // This block falls beside the first, so two callbacks still leave a
        // one-row board and seeding must continue.
        run.provide_vrf_row([0, 0, 1, 0, 0, 0, 0, 0]).unwrap();
        assert_eq!(run.grid.occupied_height(), 1);
        assert_eq!(run.starting_height_target, 2);
        // A block in an occupied column finally reaches the requested height.
        run.provide_vrf_row([1, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        assert_eq!(run.grid.occupied_height(), 2);
        assert_eq!(run.starting_height_target, 0);
        assert!(run.next_row.is_none());
        run.provide_vrf_row([0, 0, 1, 0, 0, 0, 0, 0]).unwrap();
        assert_eq!(run.phase, RunPhase::Playing);
        assert_eq!(run.next_row, Some([0, 0, 1, 0, 0, 0, 0, 0]));
    }

    #[test]
    fn seed_rows_are_gravity_settled_no_floating_cubes() {
        let mut run = RunEngine {
            phase: RunPhase::AwaitingVrf,
            starting_height_target: 2,
            ..RunEngine::default()
        };
        // Two DISTINCT coherent rows. Inserted raw (the pre-fix behavior) the
        // col-0 block from the first row would hang over the empty col-0 cell
        // of the second — a floating cube. Seeding must gravity-settle, exactly
        // like Cairo's initialize_grid.
        run.provide_vrf_row([1, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        run.provide_vrf_row([1, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        // The seeded board is already gravity-stable (applying gravity again is
        // a no-op) — the definitive "no floating cubes" assertion.
        let mut resettled = run.grid;
        resettled.apply_gravity();
        assert_eq!(resettled, run.grid, "seed board must be gravity-settled");
        assert_eq!(run.grid.row(0).unwrap(), &[1, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(run.grid.row(1).unwrap(), &[1, 0, 0, 0, 0, 0, 0, 0]);
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
        run.play_move(
            0,
            0,
            7,
            6,
            LevelRules::default(),
            mutator,
            RunMode::Campaign,
        )
        .unwrap();
        assert_eq!(run.level_lines_cleared, 1);
        assert_eq!(run.bonus_charges, 1);
    }

    #[test]
    fn renewable_bonus_inventory_stops_at_the_shared_cap() {
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            bonus: Some(Bonus::Wave),
            bonus_charges: BONUS_CHARGE_CAP,
            ..RunEngine::default()
        };
        let report = run.finish_action(
            ActionContext {
                lines: 1,
                ..ActionContext::default()
            },
            LevelRules::default(),
            MutatorRules {
                bonus_trigger_type: 1,
                bonus_threshold: 1,
                ..MutatorRules::default()
            },
            true,
        );

        assert_eq!(report.charges_earned, 1);
        assert_eq!(run.bonus_charges, BONUS_CHARGE_CAP);
    }

    #[test]
    fn fixed_line_triggers_distinguish_at_least_from_exact() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let mut at_least = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        at_least.finish_action(
            ActionContext {
                lines: 4,
                ..ActionContext::default()
            },
            level,
            MutatorRules {
                bonus_trigger_type: 1,
                bonus_threshold: 3,
                ..MutatorRules::default()
            },
            true,
        );
        assert_eq!(at_least.bonus_charges, 1);

        let mut exact = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        let exact_rules = MutatorRules {
            bonus_trigger_type: 4,
            bonus_threshold: 3,
            ..MutatorRules::default()
        };
        exact.finish_action(
            ActionContext {
                lines: 4,
                ..ActionContext::default()
            },
            level,
            exact_rules,
            true,
        );
        assert_eq!(exact.bonus_charges, 0);
        exact.phase = RunPhase::Playing;
        exact.finish_action(
            ActionContext {
                lines: 3,
                ..ActionContext::default()
            },
            level,
            exact_rules,
            true,
        );
        assert_eq!(exact.bonus_charges, 1);
    }

    #[test]
    fn all_block_sizes_trigger_requires_every_size_in_one_move() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let rules = MutatorRules {
            bonus_trigger_type: 6,
            ..MutatorRules::default()
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        run.finish_action(
            ActionContext {
                block_cells_before: [1, 2, 3, 0],
                ..ActionContext::default()
            },
            level,
            rules,
            true,
        );
        assert_eq!(run.bonus_charges, 0);
        run.phase = RunPhase::Playing;
        run.finish_action(
            ActionContext {
                block_cells_before: [1, 2, 3, 4],
                ..ActionContext::default()
            },
            level,
            rules,
            true,
        );
        assert_eq!(run.bonus_charges, 1);
        assert_eq!(run.charges_earned, 1);
    }

    #[test]
    fn combo_count_trigger_awards_at_most_one_charge_per_action() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            combo_counter: 2,
            ..RunEngine::default()
        };
        run.finish_action(
            ActionContext {
                lines: 4,
                ..ActionContext::default()
            },
            level,
            MutatorRules {
                bonus_trigger_type: 7,
                bonus_threshold: 3,
                ..MutatorRules::default()
            },
            true,
        );
        assert_eq!(run.combo_counter, 3);
        assert_eq!(run.bonus_charges, 1);

        run.finish_action_with_kind(
            ActionContext {
                lines: 4,
                ..ActionContext::default()
            },
            level,
            MutatorRules {
                bonus_trigger_type: 7,
                bonus_threshold: 3,
                ..MutatorRules::default()
            },
            false,
            true,
        );
        assert_eq!(run.combo_counter, 3, "bonus actions are not combos");
        assert_eq!(run.bonus_charges, 1);
    }

    #[test]
    fn block_burst_trigger_sums_every_width_on_player_moves() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let rules = MutatorRules {
            bonus_trigger_type: 8,
            bonus_threshold: 6,
            ..MutatorRules::default()
        };
        let context = ActionContext {
            // Six blocks: two each of widths one, two, and three.
            block_cells_before: [2, 4, 6, 0],
            ..ActionContext::default()
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        run.finish_action(context, level, rules, true);
        assert_eq!(run.bonus_charges, 1);

        run.finish_action_with_kind(context, level, rules, false, true);
        assert_eq!(run.bonus_charges, 1, "bonus actions cannot fire type 8");
    }

    #[test]
    fn clearing_move_streak_trigger_fires_when_the_threshold_is_reached() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let rules = MutatorRules {
            bonus_trigger_type: 9,
            bonus_threshold: 3,
            ..MutatorRules::default()
        };
        let clearing_move = ActionContext {
            lines: 1,
            ..ActionContext::default()
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            streak: 2,
            ..RunEngine::default()
        };
        run.finish_action(clearing_move, level, rules, true);
        assert_eq!((run.streak, run.bonus_charges), (3, 1));
        run.finish_action(clearing_move, level, rules, true);
        assert_eq!((run.streak, run.bonus_charges), (4, 1));

        run.finish_action(ActionContext::default(), level, rules, true);
        assert_eq!(run.streak, 0);
        run.finish_action_with_kind(clearing_move, level, rules, false, true);
        assert_eq!(run.streak, 0, "bonus actions are streak-neutral");
    }

    #[test]
    fn perfect_clear_bonus_is_added_after_combo_scaling() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            ..LevelRules::default()
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        let report = run.finish_action(
            ActionContext {
                lines: 2,
                base_point_parts: [10, 0],
                ..ActionContext::default()
            },
            level,
            MutatorRules {
                score_multiplier_x100: 150,
                combo_multiplier_x100: 200,
                line_clear_bonus: 3,
                perfect_clear_bonus: 5,
                ..MutatorRules::default()
            },
            false,
        );
        assert_eq!(report.points_earned, 47);
    }

    #[test]
    fn bonus_perfect_clear_consumes_preview_without_spending_a_move() {
        let source = grid(&[(0, [1, 0, 0, 0, 0, 0, 0, 0])]);
        let preview = [2, 2, 0, 0, 0, 0, 0, 0];
        let mut run = RunEngine::start(source, preview).unwrap();
        run.bonus = Some(Bonus::Hammer);
        run.bonus_charges = 1;
        let report = run
            .apply_bonus(
                0,
                0,
                LevelRules {
                    points_required: u32::MAX,
                    max_moves: 20,
                    ..LevelRules::default()
                },
                MutatorRules {
                    perfect_clear_bonus: 10,
                    ..MutatorRules::default()
                },
                RunMode::Campaign,
            )
            .unwrap();
        assert!(report.perfect_clear);
        assert!(report.action_was_bonus);
        assert_eq!(report.points_earned, 10);
        assert_eq!(run.moves, 0);
        assert_eq!(run.phase, RunPhase::AwaitingVrf);
        assert_eq!(run.next_row, None);
        assert_eq!(run.grid.row(0).unwrap(), &preview);
        assert_eq!(run.bonus_charges, 0);
    }

    #[test]
    fn score_multiplier_rounds_each_settle_phase_independently() {
        assert_eq!(score_base_parts([1, 1], 150), 2);
        assert_eq!(score_base_parts([2, 1], 150), 4);
        assert_ne!(score_base_parts([1, 1], 150), scale(2, 150));
        // A 3+1 split keeps Cairo's shared 1+2+3+4 curve while retaining
        // Cairo's per-phase multiplier floors: 6*1.5 + 4*1.5 = 15.
        assert_eq!(score_base_parts([6, 4], 150), 15);
    }

    #[test]
    fn every_constraint_kind_reads_its_declared_action_fact() {
        let player = MoveReport {
            lines_cleared: 3,
            points_earned: 40,
            perfect_clear: true,
            blocks_destroyed_by_size: [4, 3, 2, 1],
            ..MoveReport::default()
        };
        let bonus = MoveReport {
            action_was_bonus: true,
            ..player
        };
        let progress = |kind, value, count, current, report, _streak, charges, lines| {
            Constraint {
                kind,
                value,
                required_count: count,
            }
            .update(current, report, charges, lines)
        };

        assert_eq!(progress(ConstraintKind::None, 0, 0, 2, &player, 0, 0, 0), 2);
        assert_eq!(
            progress(ConstraintKind::ClearLines, 0, 12, 0, &player, 0, 0, 12),
            12
        );
        assert_eq!(
            progress(ConstraintKind::BreakBlocks, 0, 8, 0, &player, 0, 0, 0),
            8
        );
        assert_eq!(
            progress(ConstraintKind::CombosOfAtLeast, 3, 2, 1, &player, 0, 0, 0),
            2
        );
        assert_eq!(
            progress(ConstraintKind::CombosOfExactly, 3, 2, 0, &player, 0, 0, 0),
            1
        );
        assert_eq!(
            progress(ConstraintKind::BigMoves, 30, 2, 1, &player, 0, 0, 0),
            2
        );
        assert_eq!(
            progress(ConstraintKind::TriggerFired, 0, 3, 0, &player, 0, 3, 0),
            3
        );
        assert_eq!(
            progress(ConstraintKind::BonusLines, 0, 3, 0, &bonus, 0, 0, 0),
            3
        );
        assert_eq!(
            progress(ConstraintKind::BonusBreaks, 0, 10, 0, &bonus, 0, 0, 0),
            10
        );
        assert_eq!(
            progress(ConstraintKind::ComboOfAtLeast, 3, 1, 0, &player, 0, 0, 0),
            1
        );
        assert_eq!(
            progress(ConstraintKind::ComboOfExactly, 3, 1, 0, &player, 0, 0, 0),
            1
        );
        assert_eq!(
            progress(ConstraintKind::Streak, 1, 5, 4, &player, 0, 0, 0),
            5
        );
        assert_eq!(
            progress(ConstraintKind::BreakInMove, 2, 3, 0, &player, 0, 0, 0),
            3
        );
        assert_eq!(
            progress(ConstraintKind::AllWidthsInMove, 0, 1, 0, &player, 0, 0, 0),
            1
        );
        assert_eq!(
            progress(ConstraintKind::BigMove, 40, 1, 0, &player, 0, 0, 0),
            1
        );
        assert_eq!(
            progress(ConstraintKind::BonusLinesInMove, 2, 1, 0, &bonus, 0, 0, 0),
            1
        );
        assert_eq!(
            progress(ConstraintKind::PerfectClear, 0, 1, 0, &player, 0, 0, 0),
            1
        );

        assert_eq!(
            progress(ConstraintKind::ComboOfExactly, 2, 1, 1, &player, 0, 0, 0),
            0
        );
        assert_eq!(
            progress(ConstraintKind::BonusLinesInMove, 2, 1, 1, &player, 0, 0, 0),
            0
        );
        assert!(!Constraint::default().is_satisfied(0));
    }

    #[test]
    fn constraint_classes_and_tags_are_exhaustive_and_stable() {
        for tag in 0..=16 {
            let kind = ConstraintKind::from_tag(tag).unwrap();
            assert_eq!(kind.tag(), tag);
            assert_eq!(kind.class().is_none(), tag == 0);
        }
        assert!(ConstraintKind::from_tag(17).is_none());
        assert_eq!(
            ConstraintKind::CombosOfAtLeast.class(),
            Some(ConstraintClass::Cumulative)
        );
        assert_eq!(
            ConstraintKind::ComboOfAtLeast.class(),
            Some(ConstraintClass::Moment)
        );

        for (kind, value) in [
            (ConstraintKind::ComboOfAtLeast, 2),
            (ConstraintKind::ComboOfExactly, 2),
            (ConstraintKind::AllWidthsInMove, 0),
            (ConstraintKind::BigMove, 1),
            (ConstraintKind::BonusLinesInMove, 1),
            (ConstraintKind::PerfectClear, 0),
        ] {
            assert!(
                Constraint {
                    kind,
                    value,
                    required_count: 1,
                }
                .is_valid_secondary()
            );
            assert!(
                !Constraint {
                    kind,
                    value,
                    required_count: 2,
                }
                .is_valid_secondary()
            );
        }
        for kind in [ConstraintKind::Streak, ConstraintKind::BreakInMove] {
            assert!(
                Constraint {
                    kind,
                    value: 1,
                    required_count: 2,
                }
                .is_valid_secondary()
            );
        }
    }

    #[test]
    fn streak_constraint_uses_its_minimum_while_trigger_streak_counts_clearing_moves() {
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 10,
            secondary: Constraint {
                kind: ConstraintKind::Streak,
                value: 2,
                required_count: 3,
            },
            ..LevelRules::default()
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };

        run.finish_action(
            ActionContext {
                lines: 2,
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            true,
        );
        assert_eq!((run.streak, run.secondary_progress), (1, 1));

        run.phase = RunPhase::Playing;
        run.finish_action_with_kind(
            ActionContext {
                lines: 4,
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            false,
            true,
        );
        assert_eq!((run.streak, run.secondary_progress), (1, 1));

        run.phase = RunPhase::Playing;
        run.finish_action(
            ActionContext {
                lines: 1,
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            true,
        );
        assert_eq!((run.streak, run.secondary_progress), (2, 0));
    }

    #[test]
    fn zone_one_wave_scores_advances_objectives_and_never_self_recharges() {
        let source = grid(&[
            (0, [1, 1, 1, 1, 0, 0, 0, 0]),
            (1, [1, 0, 0, 0, 0, 0, 0, 0]),
            (2, [0, 0, 0, 0, 1, 1, 1, 1]),
        ]);
        let mut run = RunEngine::start(source, [1, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        run.bonus = Some(Bonus::Wave);
        run.bonus_charges = 1;
        let level = LevelRules {
            points_required: u32::MAX,
            max_moves: 20,
            primary: Constraint {
                kind: ConstraintKind::BreakBlocks,
                value: 1,
                required_count: 6,
            },
            secondary: Constraint::default(),
        };
        let report = run
            .apply_bonus(
                1,
                0,
                level,
                MutatorRules {
                    line_clear_bonus: 1,
                    bonus_trigger_type: 1,
                    bonus_threshold: 1,
                    ..MutatorRules::default()
                },
                RunMode::Campaign,
            )
            .unwrap();

        assert_eq!(report.lines_cleared, 1);
        assert_eq!(report.points_earned, 2);
        assert_eq!(run.score, 2);
        assert_eq!(run.primary_progress, 6);
        assert_eq!(run.moves, 0);
        assert_eq!(run.bonus_charges, 0);
    }

    #[test]
    fn constraint_stars_latch_zero_to_three_on_one_action() {
        let level = LevelRules {
            points_required: 1,
            max_moves: 20,
            primary: Constraint {
                kind: ConstraintKind::CombosOfAtLeast,
                value: 2,
                required_count: 1,
            },
            secondary: Constraint {
                kind: ConstraintKind::ComboOfAtLeast,
                value: 2,
                required_count: 1,
            },
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };

        run.finish_action(
            ActionContext {
                lines: 2,
                base_point_parts: [1, 0],
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            false,
        );

        assert_eq!(run.earned_stars, 3);
        assert_eq!(run.phase, RunPhase::LevelComplete);
    }

    #[test]
    fn constraint_stars_latch_in_order_across_actions() {
        let level = LevelRules {
            points_required: 1,
            max_moves: 20,
            primary: Constraint {
                kind: ConstraintKind::BreakBlocks,
                value: 1,
                required_count: 1,
            },
            secondary: Constraint {
                kind: ConstraintKind::ComboOfAtLeast,
                value: 2,
                required_count: 1,
            },
        };
        let mut run = RunEngine {
            phase: RunPhase::Playing,
            grid: grid(&[(0, [1, 0, 0, 0, 0, 0, 0, 0])]),
            ..RunEngine::default()
        };

        run.finish_action(
            ActionContext {
                base_point_parts: [1, 0],
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            false,
        );
        assert_eq!(run.earned_stars, 1);

        run.grid = Grid::EMPTY;
        run.finish_action(
            ActionContext {
                block_cells_before: [1, 0, 0, 0],
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            false,
        );
        assert_eq!(run.earned_stars, 2);

        run.finish_action(
            ActionContext {
                lines: 2,
                ..ActionContext::default()
            },
            level,
            MutatorRules::default(),
            false,
        );
        assert_eq!(run.earned_stars, 3);
        assert_eq!(run.phase, RunPhase::LevelComplete);
    }

    #[test]
    fn exhausted_runs_keep_one_or_two_latched_stars() {
        let primary = Constraint {
            kind: ConstraintKind::CombosOfAtLeast,
            value: 2,
            required_count: 1,
        };
        let secondary = Constraint {
            kind: ConstraintKind::BreakInMove,
            value: 1,
            required_count: 1,
        };
        let mut one = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        one.finish_move(
            ActionContext {
                base_point_parts: [1, 0],
                ..ActionContext::default()
            },
            LevelRules {
                points_required: 1,
                max_moves: 1,
                primary,
                secondary,
            },
            MutatorRules::default(),
        );
        assert_eq!((one.phase, one.earned_stars), (RunPhase::Finished, 1));

        let mut two = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        two.finish_move(
            ActionContext {
                lines: 2,
                base_point_parts: [1, 0],
                ..ActionContext::default()
            },
            LevelRules {
                points_required: 1,
                max_moves: 1,
                primary,
                secondary,
            },
            MutatorRules::default(),
        );
        assert_eq!((two.phase, two.earned_stars), (RunPhase::Finished, 2));
    }

    #[test]
    fn absent_constraints_cap_and_complete_the_contiguous_star_sources() {
        let mut one = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        one.finish_action(
            ActionContext {
                base_point_parts: [1, 0],
                ..ActionContext::default()
            },
            LevelRules::default(),
            MutatorRules::default(),
            false,
        );
        assert_eq!((one.phase, one.earned_stars), (RunPhase::LevelComplete, 1));

        let mut two = RunEngine {
            phase: RunPhase::Playing,
            ..RunEngine::default()
        };
        two.finish_action(
            ActionContext {
                lines: 2,
                base_point_parts: [1, 0],
                ..ActionContext::default()
            },
            LevelRules {
                primary: Constraint {
                    kind: ConstraintKind::CombosOfAtLeast,
                    value: 2,
                    required_count: 1,
                },
                ..LevelRules::default()
            },
            MutatorRules::default(),
            false,
        );
        assert_eq!((two.phase, two.earned_stars), (RunPhase::LevelComplete, 2));
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
            serde_json::from_str(include_str!("../../../fixtures/game-parity.json")).unwrap();
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
            serde_json::from_str(include_str!("../../../fixtures/game-parity.json")).unwrap();
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
                    RunMode::Campaign,
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
            assert_eq!(
                run.earned_stars,
                expected["earnedStars"].as_u64().unwrap() as u8
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
                "combosOfAtLeast" => ConstraintKind::CombosOfAtLeast,
                "breakBlocks" => ConstraintKind::BreakBlocks,
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
        assert!(
            run.play_move(
                0,
                0,
                0,
                1,
                LevelRules::default(),
                MutatorRules::default(),
                RunMode::Campaign,
            )
            .is_err()
        );
        assert_eq!(run.grid, source);
        assert_eq!(run.next_row, Some(next));
        assert_eq!(run.moves, 0);
    }
}
