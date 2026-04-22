use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,

    #[msg("Oracle queue invalide utiliser l'adresse DEFAULT_QUEUE de MagicBlock")]
    InvalidOracleQueue,

    #[msg("Tu n'es pas le proprietaire de cette partie")]
    NotGameOwner,

    #[msg("Cette partie est deja terminee")]
    GameOver,

    #[msg("indices de move invalides row < 10, col < 8, start != end")]
    InvalidMove,

    #[msg("la randomness a deja ete injectee pour cette partie")]
    RandomnessAlreadySet,

    #[msg("Seule l'authority peut effectuer cette action")]
    Unauthorized,

    #[msg("Fonds insuffisants dans la treasury")]
    InsufficientFunds,
}
