//! zKube's durable Solana authority and settlement program.
//!
//! The connected wallet address is the immutable player identity. Safe player
//! instructions accept either that owner signer or a scoped, unexpired
//! SessionTokenV2 actor targeting this program; native-SOL purchases remain
//! owner-only. Active gameplay is delegated to MagicBlock, but progression,
//! contests, custody, and final settlement remain authoritative on
//! Solana base. Permissionless keeper instructions are valid only when their
//! account relationships and one-way lifecycle predicates are satisfied.

pub mod error;
pub mod game;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;
pub use instructions::*;
pub use state::*;

declare_id!("Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd");

#[ephemeral]
#[program]
pub mod solana {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        args: InitializeProtocolArgs,
    ) -> Result<()> {
        instructions::content_instructions::handler_initialize_protocol(ctx, args)
    }

    pub fn initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
        instructions::content_instructions::handler_initialize_player(ctx)
    }

    pub fn create_player_label(
        ctx: Context<CreatePlayerLabel>,
        args: PlayerLabelArgs,
    ) -> Result<()> {
        instructions::player_label_instructions::handler_create_player_label(ctx, args)
    }

    pub fn funded_create_player_label(
        ctx: Context<FundedCreatePlayerLabel>,
        args: PlayerLabelArgs,
    ) -> Result<()> {
        instructions::player_funding_instructions::handler_funded_create_player_label(ctx, args)
    }

    pub fn set_player_label(ctx: Context<SetPlayerLabel>, args: PlayerLabelArgs) -> Result<()> {
        instructions::player_label_instructions::handler_set_player_label(ctx, args)
    }

    pub fn set_featured_emblem(ctx: Context<SetFeaturedEmblem>, emblem_id: u8) -> Result<()> {
        instructions::profile_instructions::handler_set_featured_emblem(ctx, emblem_id)
    }

    pub fn withdraw_player_funding(
        ctx: Context<WithdrawPlayerFunding>,
        lamports: u64,
    ) -> Result<()> {
        instructions::content_instructions::handler_withdraw_player_funding(ctx, lamports)
    }

    pub fn funded_prepare_campaign_run(
        ctx: Context<FundedPrepareCampaignRun>,
        run_id: u64,
        map_id: u8,
        level: u8,
    ) -> Result<()> {
        instructions::player_funding_instructions::handler_funded_prepare_campaign_run(
            ctx, run_id, map_id, level,
        )
    }

    pub fn funded_delegate_active_run<'info>(
        ctx: Context<'info, FundedDelegateActiveRun<'info>>,
    ) -> Result<()> {
        instructions::player_funding_instructions::handler_funded_delegate_active_run(ctx)
    }

    pub fn initialize_arcade(ctx: Context<InitializeArcade>) -> Result<()> {
        instructions::arcade_instructions::handler_initialize_arcade(ctx)
    }

    pub fn publish_arena_rules(
        ctx: Context<PublishArenaRules>,
        args: PublishArenaRulesArgs,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_publish_arena_rules(ctx, args)
    }

    pub fn activate_arena_rules(ctx: Context<ActivateArenaRules>) -> Result<()> {
        instructions::arcade_instructions::handler_activate_arena_rules(ctx)
    }

    pub fn prepare_arena_daily(ctx: Context<PrepareArenaDaily>, day_id: u32) -> Result<()> {
        instructions::arcade_instructions::handler_prepare_arena_daily(ctx, day_id)
    }

    pub fn prepare_weekly_jackpot(ctx: Context<PrepareWeeklyJackpot>, week_id: u32) -> Result<()> {
        instructions::arcade_instructions::handler_prepare_weekly_jackpot(ctx, week_id)
    }

    pub fn prepare_season(ctx: Context<PrepareSeason>, season_id: u32) -> Result<()> {
        instructions::arcade_instructions::handler_prepare_season(ctx, season_id)
    }

    pub fn activate_arena_daily(ctx: Context<ActivateArenaDaily>) -> Result<()> {
        instructions::arcade_instructions::handler_activate_arena_daily(ctx)
    }

    pub fn activate_weekly_jackpot(ctx: Context<ActivateWeeklyJackpot>) -> Result<()> {
        instructions::arcade_instructions::handler_activate_weekly_jackpot(ctx)
    }

    pub fn activate_season(ctx: Context<ActivateSeason>) -> Result<()> {
        instructions::arcade_instructions::handler_activate_season(ctx)
    }

    pub fn seed_launch_pools(
        ctx: Context<SeedLaunchPools>,
        daily_lamports: u64,
        weekly_lamports: u64,
        season_lamports: u64,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_seed_launch_pools(
            ctx,
            daily_lamports,
            weekly_lamports,
            season_lamports,
        )
    }

    pub fn enter_arena_v2(
        ctx: Context<EnterArenaV2>,
        run_id: u64,
        expected_entry_lamports: u64,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_enter_arena_v2(
            ctx,
            run_id,
            expected_entry_lamports,
        )
    }

    pub fn funded_enter_arena_v2(
        ctx: Context<FundedEnterArenaV2>,
        run_id: u64,
        expected_entry_lamports: u64,
    ) -> Result<()> {
        instructions::player_funding_instructions::handler_funded_enter_arena_v2(
            ctx,
            run_id,
            expected_entry_lamports,
        )
    }

    pub fn prepare_practice_run_v2(ctx: Context<PreparePracticeRunV2>, run_id: u64) -> Result<()> {
        instructions::arcade_instructions::handler_prepare_practice_run_v2(ctx, run_id)
    }

    pub fn funded_prepare_practice_run_v2(
        ctx: Context<FundedPreparePracticeRunV2>,
        run_id: u64,
    ) -> Result<()> {
        instructions::player_funding_instructions::handler_funded_prepare_practice_run_v2(
            ctx, run_id,
        )
    }

    pub fn consume_arena_run(ctx: Context<ConsumeArenaRun>) -> Result<()> {
        instructions::arcade_instructions::handler_consume_arena_run(ctx)
    }

    pub fn consume_practice_run(ctx: Context<ConsumePracticeRun>) -> Result<()> {
        instructions::arcade_instructions::handler_consume_practice_run(ctx)
    }

    pub fn expire_unresolved_arena_run(
        ctx: Context<ExpireUnresolvedArenaRun>,
        run_id: u64,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_expire_unresolved_arena_run(ctx, run_id)
    }

    pub fn cleanup_orphan_active_run(ctx: Context<CleanupOrphanActiveRun>) -> Result<()> {
        instructions::arcade_instructions::handler_cleanup_orphan_active_run(ctx)
    }

    pub fn initialize_season_player(ctx: Context<InitializeSeasonPlayer>) -> Result<()> {
        instructions::arcade_instructions::handler_initialize_season_player(ctx)
    }

    pub fn rollup_arena_to_season(ctx: Context<RollupArenaToSeason>) -> Result<()> {
        instructions::arcade_instructions::handler_rollup_arena_to_season(ctx)
    }

    pub fn seal_arena_season_rollups(ctx: Context<SealArenaSeasonRollups>) -> Result<()> {
        instructions::arcade_instructions::handler_seal_arena_season_rollups(ctx)
    }

    pub fn finalize_arena_daily<'info>(
        ctx: Context<'info, FinalizeArenaDaily<'info>>,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_finalize_arena_daily(ctx)
    }

    pub fn finalize_weekly_jackpot<'info>(
        ctx: Context<'info, FinalizeWeeklyJackpot<'info>>,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_finalize_weekly_jackpot(ctx)
    }

    pub fn finalize_season<'info>(ctx: Context<'info, FinalizeSeason<'info>>) -> Result<()> {
        instructions::arcade_instructions::handler_finalize_season(ctx)
    }

    pub fn sync_daily_profile(ctx: Context<SyncDailyProfile>) -> Result<()> {
        instructions::profile_instructions::handler_sync_daily_profile(ctx)
    }

    pub fn sync_weekly_profile(ctx: Context<SyncWeeklyProfile>) -> Result<()> {
        instructions::profile_instructions::handler_sync_weekly_profile(ctx)
    }

    pub fn sync_season_profile(ctx: Context<SyncSeasonProfile>) -> Result<()> {
        instructions::profile_instructions::handler_sync_season_profile(ctx)
    }

    pub fn close_arena_player(ctx: Context<CloseArenaPlayer>) -> Result<()> {
        instructions::arcade_instructions::handler_close_arena_player(ctx)
    }

    pub fn close_season_player(ctx: Context<CloseSeasonPlayer>) -> Result<()> {
        instructions::arcade_instructions::handler_close_season_player(ctx)
    }

    pub fn withdraw_operator_revenue(
        ctx: Context<WithdrawOperatorRevenue>,
        lamports: u64,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_withdraw_operator_revenue(ctx, lamports)
    }

    pub fn set_protocol_pause(ctx: Context<SetProtocolPause>, paused: bool) -> Result<()> {
        instructions::governance_instructions::handler_set_protocol_pause(ctx, paused)
    }

    pub fn propose_protocol_authority(
        ctx: Context<ProposeProtocolAuthority>,
        pending_authority: Pubkey,
    ) -> Result<()> {
        instructions::governance_instructions::handler_propose_protocol_authority(
            ctx,
            pending_authority,
        )
    }

    pub fn accept_protocol_authority(ctx: Context<AcceptProtocolAuthority>) -> Result<()> {
        instructions::governance_instructions::handler_accept_protocol_authority(ctx)
    }

    pub fn update_team_destination(ctx: Context<UpdateTeamDestination>) -> Result<()> {
        instructions::governance_instructions::handler_update_team_destination(ctx)
    }

    pub fn write_map_catalog(
        ctx: Context<WriteMapCatalog>,
        args: WriteMapCatalogArgs,
    ) -> Result<()> {
        instructions::content_instructions::handler_write_map_catalog(ctx, args)
    }

    pub fn activate_campaign_map(ctx: Context<ActivateCampaignMap>) -> Result<()> {
        instructions::content_instructions::handler_activate_campaign_map(ctx)
    }

    pub fn activate_content_release(
        ctx: Context<ActivateContentRelease>,
        content_version: u32,
        daily_rules_version: u32,
        campaign_map_count: u8,
    ) -> Result<()> {
        instructions::content_instructions::handler_activate_content_release(
            ctx,
            content_version,
            daily_rules_version,
            campaign_map_count,
        )
    }

    pub fn prepare_campaign_run(
        ctx: Context<PrepareCampaignRun>,
        run_id: u64,
        map_id: u8,
        level: u8,
    ) -> Result<()> {
        instructions::content_instructions::handler_prepare_campaign_run(ctx, run_id, map_id, level)
    }

    pub fn delegate_active_run(ctx: Context<DelegateActiveRun>) -> Result<()> {
        instructions::run_lifecycle::handler_delegate_active_run(ctx)
    }

    pub fn request_row_vrf(ctx: Context<RequestRowVrf>, client_seed: [u8; 32]) -> Result<()> {
        instructions::run_lifecycle::handler_request_row_vrf(ctx, client_seed)
    }

    pub fn fulfill_row_vrf(
        ctx: Context<FulfillRowVrf>,
        randomness: [u8; 32],
        expected_request_counter: u32,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_fulfill_row_vrf(
            ctx,
            randomness,
            expected_request_counter,
        )
    }

    pub fn play_move(
        ctx: Context<PlayMove>,
        expected_action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::run_lifecycle::handler_play_move(
            ctx,
            expected_action,
            expected_move,
            row,
            start,
            destination,
            client_seed,
        )
    }

    pub fn apply_bonus(
        ctx: Context<ApplyBonus>,
        expected_action: u32,
        row: u8,
        column: u8,
        client_seed: [u8; 32],
    ) -> Result<()> {
        instructions::run_lifecycle::handler_apply_bonus(
            ctx,
            expected_action,
            row,
            column,
            client_seed,
        )
    }

    pub fn abandon_run(ctx: Context<AbandonRun>) -> Result<()> {
        instructions::run_lifecycle::handler_abandon_run(ctx)
    }

    pub fn force_finish_deadline(ctx: Context<ForceFinishDeadline>) -> Result<()> {
        instructions::run_lifecycle::handler_force_finish_deadline(ctx)
    }

    pub fn commit_run(ctx: Context<CommitRun>) -> Result<()> {
        instructions::run_lifecycle::handler_commit_run(ctx)
    }

    pub fn consume_campaign_run(ctx: Context<ConsumeCampaignRun>) -> Result<()> {
        instructions::run_lifecycle::handler_consume_campaign_run(ctx)
    }
}
