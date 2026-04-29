use anchor_lang::prelude::*;

/// Challenge quotidien — une instance par jour (challenge_id = Unix / 86400).
/// Créé permissionless par n'importe quel client ; idempotent via PDA.
#[account]
pub struct DailyChallenge {
    /// Identifiant du jour = Unix timestamp / 86400
    pub challenge_id: u32,
    /// Début du challenge en secondes Unix (minuit UTC du jour)
    pub start_time: i64,
    /// Fin du challenge en secondes Unix (minuit UTC J+1)
    pub end_time: i64,
    /// Zone thématique (1–10) dérivée de challenge_id via SHA256
    pub zone_id: u8,
    /// Mutator actif (0 = aucun, 1–7 = ID config)
    pub active_mutator_id: u8,
    /// Mutator passif (0 = aucun, 1–7 = ID config)
    pub passive_mutator_id: u8,
    /// Nombre de joueurs qui ont commencé ce challenge
    pub total_entries: u32,
    /// true après settle_challenge (classement figé)
    pub settled: bool,
}

impl DailyChallenge {
    pub const SIZE: usize = 8   // discriminant Anchor
        + 4   // challenge_id
        + 8   // start_time
        + 8   // end_time
        + 1   // zone_id
        + 1   // active_mutator_id
        + 1   // passive_mutator_id
        + 4   // total_entries
        + 1;  // settled
}

/// Score d'un joueur pour un challenge.
/// Une seule entrée par (challenge, joueur) — une seule tentative autorisée.
#[account]
pub struct DailyEntry {
    /// Référence au challenge
    pub challenge_id: u32,
    /// Adresse du joueur
    pub player: Pubkey,
    /// Score final copié depuis game_state.score lors de submit_daily_score
    pub score: u32,
    /// true si la partie est terminée et le score soumis (submit_daily_score appelé)
    pub completed: bool,
}

impl DailyEntry {
    pub const SIZE: usize = 8   // discriminant Anchor
        + 4   // challenge_id
        + 32  // player
        + 4   // score
        + 1;  // completed
}

/// Suivi de la tentative daily en cours d'un joueur.
/// Créée par start_daily, fermée par submit_daily_score (remboursement lamports).
/// Une seule par joueur — empêche les tentatives multiples en parallèle.
#[account]
pub struct ActiveDailyAttempt {
    /// Adresse du joueur
    pub player: Pubkey,
    /// ID du challenge en cours
    pub challenge_id: u32,
    /// Timestamp de démarrage
    pub started_at: i64,
}

impl ActiveDailyAttempt {
    pub const SIZE: usize = 8   // discriminant Anchor
        + 32  // player
        + 4   // challenge_id
        + 8;  // started_at
}
