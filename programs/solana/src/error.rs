use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The run is already terminal")]
    GameOver,

    #[msg("The move coordinates are invalid")]
    InvalidMove,

    #[msg("Only the configured authority may perform this action")]
    Unauthorized,

    #[msg("The source account has insufficient funds")]
    InsufficientFunds,

    #[msg("The account is in an invalid state for this instruction")]
    InvalidState,

    #[msg("The account owner or relationship is invalid")]
    InvalidOwner,

    #[msg("The expected move or action counter does not match")]
    InvalidMoveOrder,

    // ── Domain and accounting ────────────────────────────────────────────────
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Unsupported account version")]
    InvalidVersion,
    #[msg("Invalid run id")]
    InvalidRunId,
    #[msg("Finish or abandon the active run before starting another")]
    ActiveRunExists,
    #[msg("A VRF request is already pending")]
    VrfRequestPending,
    #[msg("The VRF callback does not match the pending request")]
    VrfRequestMismatch,
    #[msg("The player has no Daily prize")]
    NoPrize,
    #[msg("The Daily is not finalized, so its boards are not sealed")]
    BoardIncomplete,
    #[msg("The financial accounting invariant does not balance")]
    AccountingInvariant,
    #[msg("The player does not have a Kredit available")]
    InsufficientKredits,
    #[msg("No paid Daily is scheduled for this day")]
    DailyNotScheduled,
    #[msg("The scoped player session is invalid")]
    InvalidSession,
    #[msg("The featured emblem is invalid or not unlocked")]
    InvalidEmblem,
    #[msg("The provided period is not the canonical current or successor period")]
    InvalidPeriod,
    #[msg("This Daily has admitted every player it can size a board for")]
    DailyFull,
}
