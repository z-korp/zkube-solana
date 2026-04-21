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

    #[msg("Indices de move invalides row < 10, col < 8, start != end")]
    InvalidMove,

    #[msg("La randomness a deja ete injectee pour cette partie")]
    RandomnessAlreadySet,
}
