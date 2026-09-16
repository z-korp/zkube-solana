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

    #[msg("The MagicBlock program is invalid")]
    InvalidMagicProgram,

    #[msg("The run is not ready to finish")]
    GameNotFinished,

    #[msg("The Daily challenge entry or play window has ended")]
    ChallengeEnded,

    #[msg("The Daily challenge has not ended")]
    ChallengeNotEnded,

    #[msg("This Daily attempt has already been submitted")]
    AlreadySubmitted,

    // ── Domain and accounting ────────────────────────────────────────────────
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Invalid level")]
    InvalidLevel,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Unsupported account version")]
    InvalidVersion,
    #[msg("Invalid run id")]
    InvalidRunId,
    #[msg("Finish or abandon the active run before starting another")]
    ActiveRunExists,
    #[msg("Invalid block weights")]
    InvalidBlockWeights,
    #[msg("A VRF request is already pending")]
    VrfRequestPending,
    #[msg("No VRF request is pending")]
    NoVrfRequestPending,
    #[msg("The VRF callback does not match the pending request")]
    VrfRequestMismatch,
    #[msg("The player has no Daily prize")]
    NoPrize,
    #[msg("This Daily prize position was already claimed")]
    PrizeAlreadyClaimed,
    #[msg("The Daily prize claim window has closed")]
    ClaimWindowClosed,
    #[msg("The Daily prize claim window is still open")]
    ClaimWindowOpen,
    #[msg("The payout board exceeds the protocol safety ceiling")]
    BoardCapacityExceeded,
    #[msg("The payout board is incomplete or unsealed")]
    BoardIncomplete,
    #[msg("A submitted payout row does not match its ArenaPlayer source")]
    BoardEntryMismatch,
    #[msg("Submitted payout rows are not in canonical order")]
    BoardEntryOutOfOrder,
    #[msg("A player appears more than once on a payout board")]
    DuplicateBoardPlayer,
    #[msg("The financial accounting invariant does not balance")]
    AccountingInvariant,
    #[msg("The Arena entry price changed; refresh the exact quote")]
    PriceChanged,
    #[msg("The player does not have a Kredit available")]
    InsufficientKredits,
    #[msg("A Kredit purchase must contain a positive whole-number count at the exact unit price")]
    InvalidKreditPurchase,
    #[msg("No paid Daily is scheduled for this day")]
    DailyNotScheduled,
    #[msg("The scoped player session is invalid")]
    InvalidSession,
    #[msg("The scoped player session has expired")]
    SessionExpired,
    #[msg("The featured emblem is invalid or not unlocked")]
    InvalidEmblem,
    #[msg("The provided period is not the canonical current or successor period")]
    InvalidPeriod,
    #[msg("The first Daily was already seeded")]
    AlreadySeeded,
}
