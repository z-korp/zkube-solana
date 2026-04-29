use anchor_lang::prelude::*;

/// Un tournoi zkube une instance par tournoi créée par zKorp.
/// Stocke les paramètres le prize pool accumulé et l'état du settle.
#[account]
pub struct Tournament {
    /// Identifiant unique du tournoi (incrémental : 1, 2, 3...)
    pub tournament_id: u32,

    /// Début du tournoi (Unix timestamp)
    pub start_time: i64,

    /// Fin du tournoi (Unix timestamp) = start_time + 48h
    pub end_time: i64,

    /// Zone thématique (1–10) — dérivée de tournament_id via SHA256
    pub zone_id: u8,

    /// Entry fee en lamports (fixe : 100_000_000 = 0.1 SOL)
    pub entry_fee: u64,

    /// Prize pool accumulé (90% de chaque entry fee)
    /// Stocké dans ce compte — distribué au settle
    pub prize_pool: u64,

    /// Nombre de joueurs uniques inscrits
    pub total_players: u32,

    /// Nombre total de tentatives (inclut les replays)
    pub total_attempts: u32,

    /// true après settle_tournament — bloque les nouvelles inscriptions
    pub settled: bool,

    // ── Résultats du settle (remplis par settle_tournament) ──────────────────
    /// Pubkey du 1er gagnant (Pubkey::default() = pas de gagnant)
    pub winner_1: Pubkey,
    pub prize_1:  u64,

    /// Pubkey du 2ème gagnant
    pub winner_2: Pubkey,
    pub prize_2:  u64,

    /// Pubkey du 3ème gagnant
    pub winner_3: Pubkey,
    pub prize_3:  u64,
}

impl Tournament {
    /// Entry fee fixe : 0.1 SOL en lamports
    pub const ENTRY_FEE: u64 = 100_000_000;

    /// Part treasury : 10% de l'entry fee
    pub const TREASURY_BPS: u64 = 10;

    /// Durée du tournoi : 48h en secondes
    pub const DURATION: i64 = 48 * 3600;

    /// Répartition des prizes (en pourcentage)
    pub const PRIZE_1ST: u64 = 60;
    pub const PRIZE_2ND: u64 = 35;
    pub const PRIZE_3RD: u64 = 5;

    pub const SIZE: usize = 8   // discriminant Anchor
        + 4   // tournament_id
        + 8   // start_time
        + 8   // end_time
        + 1   // zone_id
        + 8   // entry_fee
        + 8   // prize_pool
        + 4   // total_players
        + 4   // total_attempts
        + 1   // settled
        + 32 + 8  // winner_1 + prize_1
        + 32 + 8  // winner_2 + prize_2
        + 32 + 8; // winner_3 + prize_3
}

/// Score et métadonnées d'un joueur pour un tournoi donné.
/// Créé à la première inscription, mis à jour à chaque replay si meilleur score.
#[account]
pub struct TournamentEntry {
    /// Référence au tournoi
    pub tournament_id: u32,

    /// Adresse du joueur
    pub player: Pubkey,

    /// Meilleur score atteint toutes tentatives confondues
    pub best_score: u32,

    /// Timestamp de soumission du meilleur score
    /// Tiebreaker : à score égal, le plus petit timestamp gagne
    pub submitted_at: i64,

    /// Nombre de tentatives jouées (1 = première, 2 = premier replay, etc.)
    pub attempts: u8,

    /// true si au moins une partie a été terminée et soumise
    pub has_submitted: bool,
}

impl TournamentEntry {
    pub const SIZE: usize = 8   // discriminant Anchor
        + 4   // tournament_id
        + 32  // player
        + 4   // best_score
        + 8   // submitted_at
        + 1   // attempts
        + 1;  // has_submitted
}
