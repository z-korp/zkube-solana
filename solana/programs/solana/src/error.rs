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

    #[msg("Le compte game_state n'est pas delegue a l'Ephemeral Rollup")]
    NotDelegated,

    #[msg("L'authority de delegation ne correspond pas au joueur")]
    InvalidAuthority,

    #[msg("Phase de jeu invalide pour cette instruction")]
    InvalidState,

    #[msg("L'owner du compte PDA n'est pas le programme attendu")]
    InvalidOwner,

    #[msg("La delegation a l'Ephemeral Rollup a echoue")]
    DelegationFailed,

    #[msg("Ordre des moves invalide (expected_move != move_count)")]
    InvalidMoveOrder,

    #[msg("Le programme magic_program est invalide")]
    InvalidMagicProgram,

    #[msg("Le compte magic_context est invalide")]
    InvalidMagicContext,

    #[msg("La partie n'est pas encore terminee (game.over doit etre true)")]
    GameNotFinished,
}
