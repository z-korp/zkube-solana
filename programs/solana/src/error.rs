use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The signer is not authorized for this run")]
    NotGameOwner,

    #[msg("The run is already terminal")]
    GameOver,

    #[msg("The move coordinates are invalid")]
    InvalidMove,

    #[msg("Only the configured authority may perform this action")]
    Unauthorized,

    #[msg("The source account has insufficient funds")]
    InsufficientFunds,

    #[msg("The active run is not delegated to the ephemeral rollup")]
    NotDelegated,

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

    #[msg("The Daily challenge has not started")]
    ChallengeNotStarted,

    #[msg("The Daily challenge entry or play window has ended")]
    ChallengeEnded,

    #[msg("The Daily challenge has not ended")]
    ChallengeNotEnded,

    #[msg("This Daily attempt has already been submitted")]
    AlreadySubmitted,

    // ── Domain and accounting ────────────────────────────────────────────────
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Insufficient Stars")]
    InsufficientStars,
    #[msg("Invalid map")]
    InvalidMap,
    #[msg("Invalid level")]
    InvalidLevel,
    #[msg("Invalid star rating")]
    InvalidStars,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Unsupported account version")]
    InvalidVersion,
    #[msg("Invalid run id")]
    InvalidRunId,
    #[msg("Finish or abandon the active run before starting another")]
    ActiveRunExists,
    #[msg("Map is locked")]
    MapLocked,
    #[msg("Map is disabled")]
    MapDisabled,
    #[msg("Map is already unlocked")]
    MapAlreadyUnlocked,
    #[msg("Content version mismatch")]
    ContentVersionMismatch,
    #[msg("Invalid block weights")]
    InvalidBlockWeights,
    #[msg("A VRF request is already pending")]
    VrfRequestPending,
    #[msg("No VRF request is pending")]
    NoVrfRequestPending,
    #[msg("The run receipt does not match the committed run")]
    ReceiptMismatch,
    #[msg("The player has no Daily prize")]
    NoPrize,
    #[msg("The Daily prize has already been claimed")]
    PrizeAlreadyClaimed,
    #[msg("The Daily prize claim window is still open")]
    PrizeClaimWindowOpen,
    #[msg("The refund has already been claimed")]
    RefundAlreadyClaimed,
    #[msg("The progression rule is invalid")]
    InvalidProgressRule,
    #[msg("This progress reward has already been claimed")]
    RewardAlreadyClaimed,
    #[msg("The progress requirement has not been met")]
    RewardNotEarned,
    #[msg("This quest is not active in the current cadence")]
    QuestNotActive,
    #[msg("The financial accounting invariant does not balance")]
    AccountingInvariant,
    #[msg("The selected Star pack does not exist")]
    InvalidPack,
    #[msg("The Star pack price changed; refresh the quote")]
    PriceChanged,
    #[msg("The scoped player session is invalid")]
    InvalidSession,
    #[msg("The scoped player session has expired")]
    SessionExpired,
}
