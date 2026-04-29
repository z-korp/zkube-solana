use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use crate::state::DailyChallenge;

/// Crée le challenge quotidien pour un `challenge_id` donné.
/// Permissionless — n'importe quel joueur peut appeler cette instruction.
/// Si le compte existe déjà la transaction échoue (PDA init unique) ;
/// le frontend vérifie l'existence au préalable et ne l'appelle que si absent.
#[derive(Accounts)]
#[instruction(challenge_id: u32)]
pub struct CreateDailyChallenge<'info> {
    /// Créateur — paie le rent du PDA DailyChallenge
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = DailyChallenge::SIZE,
        seeds = [b"daily_challenge", &challenge_id.to_le_bytes()],
        bump,
    )]
    pub daily_challenge: Account<'info, DailyChallenge>,

    pub system_program: Program<'info, System>,
}

pub fn handler_create_daily_challenge(
    ctx: Context<CreateDailyChallenge>,
    challenge_id: u32,
) -> Result<()> {
    let dc = &mut ctx.accounts.daily_challenge;

    // Timestamps: le challenge dure exactement 24 h à partir de minuit UTC
    let start_time = challenge_id as i64 * 86400;
    let end_time   = start_time + 86400;

    dc.challenge_id       = challenge_id;
    dc.start_time         = start_time;
    dc.end_time           = end_time;
    dc.zone_id            = compute_zone_id(challenge_id);
    dc.active_mutator_id  = compute_mutator_id(challenge_id, b"active");
    dc.passive_mutator_id = compute_mutator_id(challenge_id, b"passive");
    dc.total_entries      = 0;
    dc.settled            = false;

    msg!(
        "DailyChallenge #{} créé — zone={}, active_mutator={}, passive_mutator={}",
        challenge_id,
        dc.zone_id,
        dc.active_mutator_id,
        dc.passive_mutator_id,
    );
    Ok(())
}

// ── Helpers de dérivation déterministe ───────────────────────────────────────

/// SHA256(challenge_id_le || "zone") % 10 + 1  →  zone 1..=10
/// Miroir TypeScript dans dailyConstants.ts → computeDailyZoneId()
fn compute_zone_id(challenge_id: u32) -> u8 {
    let id_bytes = challenge_id.to_le_bytes();
    let hash = hashv(&[&id_bytes, b"zone"]);
    let n = u64::from_le_bytes(hash.0[0..8].try_into().unwrap());
    ((n % 10) + 1) as u8
}

/// SHA256(challenge_id_le || kind) % 8  →  mutator 0..=7  (0 = aucun)
fn compute_mutator_id(challenge_id: u32, kind: &[u8]) -> u8 {
    let id_bytes = challenge_id.to_le_bytes();
    let hash = hashv(&[&id_bytes, kind]);
    let n = u64::from_le_bytes(hash.0[0..8].try_into().unwrap());
    (n % 8) as u8
}
