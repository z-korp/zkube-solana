pub mod error;
pub mod game;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;
pub use instructions::*;
pub use state::*;

declare_id!("5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA");

#[ephemeral]
#[program]
pub mod solana {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        args: InitializeProtocolArgs,
    ) -> Result<()> {
        instructions::v2_instructions::handler_initialize_protocol(ctx, args)
    }

    pub fn reset_legacy_devnet_state(
        ctx: Context<ResetLegacyDevnetState>,
        close_protocol: bool,
    ) -> Result<()> {
        instructions::devnet_reset_instructions::handler_reset_legacy_devnet_state(
            ctx,
            close_protocol,
        )
    }

    pub fn initialize_player(ctx: Context<InitializePlayer>) -> Result<()> {
        instructions::v2_instructions::handler_initialize_player(ctx)
    }

    pub fn initialize_economy(
        ctx: Context<InitializeEconomy>,
        args: InitializeEconomyArgs,
    ) -> Result<()> {
        instructions::economy_v2_instructions::handler_initialize_economy(ctx, args)
    }

    pub fn update_regular_prices(
        ctx: Context<ManageEconomyPricing>,
        args: UpdateRegularPricesArgs,
    ) -> Result<()> {
        instructions::economy_v2_instructions::handler_update_regular_prices(ctx, args)
    }

    pub fn schedule_sale(ctx: Context<ManageEconomyPricing>, args: ScheduleSaleArgs) -> Result<()> {
        instructions::economy_v2_instructions::handler_schedule_sale(ctx, args)
    }

    pub fn cancel_sale(ctx: Context<ManageEconomyPricing>) -> Result<()> {
        instructions::economy_v2_instructions::handler_cancel_sale(ctx)
    }

    pub fn publish_daily_rules(
        ctx: Context<PublishDailyRules>,
        args: PublishDailyRulesArgs,
    ) -> Result<()> {
        instructions::economy_v2_instructions::handler_publish_daily_rules(ctx, args)
    }

    pub fn purchase_stars<'info>(
        ctx: Context<'info, PurchaseStars<'info>>,
        pack_index: u8,
        expected_stars: u64,
        max_usdc_amount: u64,
    ) -> Result<()> {
        instructions::economy_v2_instructions::handler_purchase_stars(
            ctx,
            pack_index,
            expected_stars,
            max_usdc_amount,
        )
    }

    pub fn unlock_zone(ctx: Context<UnlockZone>) -> Result<()> {
        instructions::economy_v2_instructions::handler_unlock_zone(ctx)
    }

    pub fn claim_level_milestone(
        ctx: Context<ClaimLevelMilestone>,
        milestone_index: u8,
    ) -> Result<()> {
        instructions::economy_v2_instructions::handler_claim_level_milestone(ctx, milestone_index)
    }

    pub fn open_daily_challenge(ctx: Context<OpenDailyChallenge>, day_id: u32) -> Result<()> {
        instructions::economy_v2_instructions::handler_open_daily_challenge(ctx, day_id)
    }

    pub fn enter_daily(
        ctx: Context<EnterDaily>,
        run_id: u64,
        action_authority: Pubkey,
    ) -> Result<()> {
        instructions::economy_v2_instructions::handler_enter_daily(ctx, run_id, action_authority)
    }

    pub fn commit_daily_run(ctx: Context<CommitDailyRun>) -> Result<()> {
        instructions::economy_v2_instructions::handler_commit_daily_run(ctx)
    }

    pub fn consume_daily_receipt(ctx: Context<ConsumeDailyReceipt>) -> Result<()> {
        instructions::economy_v2_instructions::handler_consume_daily_receipt(ctx)
    }

    pub fn finalize_daily_challenge(ctx: Context<FinalizeDailyChallenge>) -> Result<()> {
        instructions::economy_v2_instructions::handler_finalize_daily_challenge(ctx)
    }

    pub fn cancel_daily_challenge(ctx: Context<CancelDailyChallenge>) -> Result<()> {
        instructions::economy_v2_instructions::handler_cancel_daily_challenge(ctx)
    }

    pub fn refund_daily_stars(ctx: Context<RefundDailyStars>) -> Result<()> {
        instructions::economy_v2_instructions::handler_refund_daily_stars(ctx)
    }

    pub fn close_daily_player(ctx: Context<CloseDailyPlayer>) -> Result<()> {
        instructions::economy_v2_instructions::handler_close_daily_player(ctx)
    }

    pub fn close_daily_challenge(ctx: Context<CloseDailyChallenge>) -> Result<()> {
        instructions::economy_v2_instructions::handler_close_daily_challenge(ctx)
    }

    pub fn open_weekly_challenge(ctx: Context<OpenWeeklyChallenge>, week_id: u32) -> Result<()> {
        instructions::economy_v2_instructions::handler_open_weekly_challenge(ctx, week_id)
    }

    pub fn rollup_daily_to_weekly(ctx: Context<RollupDailyToWeekly>) -> Result<()> {
        instructions::economy_v2_instructions::handler_rollup_daily_to_weekly(ctx)
    }

    pub fn finalize_weekly_challenge(ctx: Context<FinalizeWeeklyChallenge>) -> Result<()> {
        instructions::economy_v2_instructions::handler_finalize_weekly_challenge(ctx)
    }

    pub fn claim_weekly_stars(ctx: Context<ClaimWeeklyStars>) -> Result<()> {
        instructions::economy_v2_instructions::handler_claim_weekly_stars(ctx)
    }

    pub fn claim_weekly_cash(ctx: Context<ClaimWeeklyCash>) -> Result<()> {
        instructions::economy_v2_instructions::handler_claim_weekly_cash(ctx)
    }

    pub fn forfeit_weekly_cash(ctx: Context<ForfeitWeeklyCash>) -> Result<()> {
        instructions::economy_v2_instructions::handler_forfeit_weekly_cash(ctx)
    }

    pub fn close_weekly_player(ctx: Context<CloseWeeklyPlayer>) -> Result<()> {
        instructions::economy_v2_instructions::handler_close_weekly_player(ctx)
    }

    pub fn close_weekly_challenge(ctx: Context<CloseWeeklyChallenge>) -> Result<()> {
        instructions::economy_v2_instructions::handler_close_weekly_challenge(ctx)
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

    pub fn set_pricing_operator(
        ctx: Context<SetPricingOperator>,
        pricing_operator: Pubkey,
    ) -> Result<()> {
        instructions::governance_instructions::handler_set_pricing_operator(ctx, pricing_operator)
    }

    pub fn update_revenue_destinations(ctx: Context<UpdateRevenueDestinations>) -> Result<()> {
        instructions::governance_instructions::handler_update_revenue_destinations(ctx)
    }

    pub fn claim_achievement(ctx: Context<ClaimAchievement>, achievement_index: u8) -> Result<()> {
        instructions::progress_instructions::handler_claim_achievement(ctx, achievement_index)
    }

    pub fn claim_quest(ctx: Context<ClaimQuest>, quest_index: u8) -> Result<()> {
        instructions::progress_instructions::handler_claim_quest(ctx, quest_index)
    }

    pub fn rotate_run_shell_authority(
        ctx: Context<RotateRunShellAuthority>,
        run_id: u64,
        new_action_authority: Pubkey,
    ) -> Result<()> {
        instructions::v2_instructions::handler_rotate_run_shell_authority(
            ctx,
            run_id,
            new_action_authority,
        )
    }

    pub fn write_map_catalog(
        ctx: Context<WriteMapCatalog>,
        args: WriteMapCatalogArgs,
    ) -> Result<()> {
        instructions::v2_instructions::handler_write_map_catalog(ctx, args)
    }

    pub fn activate_campaign_map(ctx: Context<ActivateCampaignMap>) -> Result<()> {
        instructions::v2_instructions::handler_activate_campaign_map(ctx)
    }

    pub fn prepare_campaign_run(
        ctx: Context<PrepareCampaignRun>,
        run_id: u64,
        map_id: u8,
        level: u8,
        action_authority: Pubkey,
    ) -> Result<()> {
        instructions::v2_instructions::handler_prepare_campaign_run(
            ctx,
            run_id,
            map_id,
            level,
            action_authority,
        )
    }

    pub fn delegate_active_run(ctx: Context<DelegateActiveRun>) -> Result<()> {
        instructions::run_lifecycle::handler_delegate_active_run(ctx)
    }

    pub fn request_row_vrf(ctx: Context<RequestRowVrf>, client_seed: [u8; 32]) -> Result<()> {
        instructions::run_lifecycle::handler_request_row_vrf(ctx, client_seed)
    }

    pub fn fulfill_row_vrf(ctx: Context<FulfillRowVrf>, randomness: [u8; 32]) -> Result<()> {
        instructions::run_lifecycle::handler_fulfill_row_vrf(ctx, randomness)
    }

    pub fn play_move(
        ctx: Context<PlayMove>,
        expected_action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_play_move(
            ctx,
            expected_action,
            expected_move,
            row,
            start,
            destination,
        )
    }

    pub fn apply_bonus(
        ctx: Context<ApplyBonus>,
        expected_action: u32,
        row: u8,
        column: u8,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_apply_bonus(ctx, expected_action, row, column)
    }

    pub fn seal_run(ctx: Context<SealRun>) -> Result<()> {
        instructions::run_lifecycle::handler_seal_run(ctx)
    }

    pub fn abandon_run(ctx: Context<AbandonRun>) -> Result<()> {
        instructions::run_lifecycle::handler_abandon_run(ctx)
    }

    pub fn rotate_active_run_authority(
        ctx: Context<RotateActiveRunAuthority>,
        new_action_authority: Pubkey,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_rotate_active_run_authority(ctx, new_action_authority)
    }

    pub fn commit_run(ctx: Context<CommitRun>) -> Result<()> {
        instructions::run_lifecycle::handler_commit_run(ctx)
    }

    pub fn consume_run_receipt(ctx: Context<ConsumeRunReceipt>) -> Result<()> {
        instructions::run_lifecycle::handler_consume_run_receipt(ctx)
    }

    pub fn close_settled_active_run(
        ctx: Context<CloseSettledActiveRun>,
        run_id: u64,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_close_settled_active_run(ctx, run_id)
    }
}
