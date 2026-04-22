use anchor_lang::prelude::*;

/// Compte Treasury z-korp
/// Collecte les fees de création de partie
/// Seule l'authority peut déclencher un retrait
#[account]
pub struct Treasury {
    /// L'adresse autorisée à retirer les fonds (wallet z-korp ou multisig Squads)
    pub authority: Pubkey,

    /// Total cumulé collecté depuis le début (pour tracking)
    pub total_collected: u64,

    /// Fee par partie en lamports (modifiable par l'authority)
    pub fee_per_game: u64,
}

impl Treasury {
    pub const SIZE: usize = 8   // discriminator Anchor
        + 32  // authority
        + 8   // total_collected
        + 8;  // fee_per_game
}
