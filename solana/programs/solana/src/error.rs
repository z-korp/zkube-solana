use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,

    #[msg("Oracle queue invalide utiliser l'adresse DEFAULT_QUEUE de MagicBlock")]
    InvalidOracleQueue,
}
