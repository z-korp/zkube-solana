//! Observations of mutations already chosen by the engine. These events are
//! neither replay inputs nor protocol state, and never participate in hashing.

use crate::{Bonus, GRID_CELLS, Row, RunEndReason};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresentationEvent {
    BlockMoved {
        gravity: bool,
        from_row: u8,
        from_column: u8,
        to_row: u8,
        to_column: u8,
        width: u8,
    },
    RowsCleared {
        rows: u16,
    },
    RowInserted {
        row: Row,
    },
    BonusApplied {
        bonus: Bonus,
        removed: [u8; 10],
    },
    BoardReplaced {
        cells: [u8; GRID_CELLS],
    },
    PreviewChanged {
        row: Option<Row>,
    },
    Terminal {
        reason: RunEndReason,
    },
    /// The accepted action report already determined this fact. A full
    /// reroll inventory still produces the cue, without an invented grant.
    PerfectClear {
        reroll_granted: bool,
    },
}

/// Observers receive facts, cannot influence the transition, and must not
/// publish a partially collected trace if the enclosing transition rejects.
pub trait PresentationObserver {
    fn observe(&mut self, event: PresentationEvent);
}

/// Existing program/native/WASM consumers incur no event allocation.
pub struct NoPresentation;

impl PresentationObserver for NoPresentation {
    #[inline]
    fn observe(&mut self, _: PresentationEvent) {}
}
