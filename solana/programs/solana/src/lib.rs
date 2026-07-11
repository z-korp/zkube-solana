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

    pub fn initialize_protocol_v1(
        ctx: Context<InitializeProtocolV1>,
        args: InitializeProtocolArgs,
    ) -> Result<()> {
        instructions::v2_instructions::handler_initialize_protocol_v1(ctx, args)
    }

    pub fn initialize_player_v1(ctx: Context<InitializePlayerV1>) -> Result<()> {
        instructions::v2_instructions::handler_initialize_player_v1(ctx)
    }

    pub fn propose_governance_v1(
        ctx: Context<ProposeGovernanceV1>,
        proposal_id: u64,
        action: GovernanceAction,
    ) -> Result<()> {
        instructions::governance_instructions::handler_propose_governance_v1(
            ctx,
            proposal_id,
            action,
        )
    }

    pub fn execute_governance_v1(ctx: Context<ExecuteGovernanceV1>) -> Result<()> {
        instructions::governance_instructions::handler_execute_governance_v1(ctx)
    }

    pub fn cancel_governance_v1(ctx: Context<CancelGovernanceV1>) -> Result<()> {
        instructions::governance_instructions::handler_cancel_governance_v1(ctx)
    }

    pub fn pause_protocol_v1(ctx: Context<PauseProtocolV1>) -> Result<()> {
        instructions::governance_instructions::handler_pause_protocol_v1(ctx)
    }

    pub fn pause_yield_strategy_v1(ctx: Context<PauseYieldStrategyV1>) -> Result<()> {
        instructions::governance_instructions::handler_pause_yield_strategy_v1(ctx)
    }

    pub fn accept_protocol_authority_v1(ctx: Context<AcceptProtocolAuthorityV1>) -> Result<()> {
        instructions::governance_instructions::handler_accept_protocol_authority_v1(ctx)
    }

    pub fn consume_sponsorship_v1(ctx: Context<ConsumeSponsorshipV1>) -> Result<()> {
        instructions::sponsorship_instructions::handler_consume_sponsorship_v1(ctx)
    }

    pub fn sweep_protocol_revenue_v1(ctx: Context<SweepProtocolRevenueV1>) -> Result<()> {
        instructions::treasury_instructions::handler_sweep_protocol_revenue_v1(ctx)
    }

    pub fn allocate_realized_yield_v1(ctx: Context<AllocateRealizedYieldV1>) -> Result<()> {
        instructions::treasury_instructions::handler_allocate_realized_yield_v1(ctx)
    }

    pub fn write_progress_catalog_v1(
        ctx: Context<WriteProgressCatalogV1>,
        args: WriteProgressCatalogArgs,
    ) -> Result<()> {
        instructions::progress_instructions::handler_write_progress_catalog_v1(ctx, args)
    }

    pub fn claim_achievement_v1(
        ctx: Context<ClaimAchievementV1>,
        achievement_index: u8,
    ) -> Result<()> {
        instructions::progress_instructions::handler_claim_achievement_v1(ctx, achievement_index)
    }

    pub fn claim_quest_v1(ctx: Context<ClaimQuestV1>, quest_index: u8) -> Result<()> {
        instructions::progress_instructions::handler_claim_quest_v1(ctx, quest_index)
    }

    pub fn rotate_run_shell_authority_v1(
        ctx: Context<RotateRunShellAuthorityV1>,
        run_id: u64,
        new_action_authority: Pubkey,
    ) -> Result<()> {
        instructions::v2_instructions::handler_rotate_run_shell_authority_v1(
            ctx,
            run_id,
            new_action_authority,
        )
    }

    pub fn unlock_map_with_stars_v1(ctx: Context<UnlockMapWithStarsV1>) -> Result<()> {
        instructions::campaign_instructions::handler_unlock_map_with_stars_v1(ctx)
    }

    pub fn purchase_map_with_usdc_v1(ctx: Context<PurchaseMapWithUsdcV1>) -> Result<()> {
        instructions::campaign_instructions::handler_purchase_map_with_usdc_v1(ctx)
    }

    pub fn create_daily_challenge_v1(
        ctx: Context<CreateDailyChallengeV1>,
        args: CreateDailyChallengeArgs,
    ) -> Result<()> {
        instructions::daily_instructions::handler_create_daily_challenge_v1(ctx, args)
    }

    pub fn fund_daily_challenge_v1(ctx: Context<FundDailyChallengeV1>, amount: u64) -> Result<()> {
        instructions::daily_instructions::handler_fund_daily_challenge_v1(ctx, amount)
    }

    pub fn enter_daily_with_stars_v1(
        ctx: Context<EnterDailyWithStarsV1>,
        run_id: u64,
        action_authority: Pubkey,
    ) -> Result<()> {
        instructions::daily_instructions::handler_enter_daily_with_stars_v1(
            ctx,
            run_id,
            action_authority,
        )
    }

    pub fn enter_daily_paid_v1(
        ctx: Context<EnterDailyPaidV1>,
        run_id: u64,
        action_authority: Pubkey,
    ) -> Result<()> {
        instructions::daily_instructions::handler_enter_daily_paid_v1(ctx, run_id, action_authority)
    }

    pub fn write_map_catalog_v1(
        ctx: Context<WriteMapCatalogV1>,
        args: WriteMapCatalogArgs,
    ) -> Result<()> {
        instructions::v2_instructions::handler_write_map_catalog_v1(ctx, args)
    }

    pub fn write_canonical_map_catalog_v1(
        ctx: Context<WriteCanonicalMapCatalogV1>,
        content_version: u32,
        map_id: u8,
    ) -> Result<()> {
        instructions::v2_instructions::handler_write_canonical_map_catalog_v1(
            ctx,
            content_version,
            map_id,
        )
    }

    pub fn commit_daily_run_v1(ctx: Context<CommitDailyRunV1>) -> Result<()> {
        instructions::daily_instructions::handler_commit_daily_run_v1(ctx)
    }

    pub fn consume_daily_receipt_v1(ctx: Context<ConsumeDailyReceiptV1>) -> Result<()> {
        instructions::daily_instructions::handler_consume_daily_receipt_v1(ctx)
    }

    pub fn finalize_daily_challenge_v1(ctx: Context<FinalizeDailyChallengeV1>) -> Result<()> {
        instructions::daily_instructions::handler_finalize_daily_challenge_v1(ctx)
    }

    pub fn claim_daily_prize_v1(ctx: Context<ClaimDailyPrizeV1>) -> Result<()> {
        instructions::daily_instructions::handler_claim_daily_prize_v1(ctx)
    }

    pub fn forfeit_unclaimed_daily_prizes_v1(
        ctx: Context<ForfeitUnclaimedDailyPrizesV1>,
    ) -> Result<()> {
        instructions::daily_instructions::handler_forfeit_unclaimed_daily_prizes_v1(ctx)
    }

    pub fn cancel_daily_challenge_v1(ctx: Context<CancelDailyChallengeV1>) -> Result<()> {
        instructions::daily_instructions::handler_cancel_daily_challenge_v1(ctx)
    }

    pub fn refund_daily_entry_v1(ctx: Context<RefundDailyEntryV1>) -> Result<()> {
        instructions::daily_instructions::handler_refund_daily_entry_v1(ctx)
    }

    pub fn reclaim_cancelled_sponsor_v1(ctx: Context<ReclaimCancelledSponsorV1>) -> Result<()> {
        instructions::daily_instructions::handler_reclaim_cancelled_sponsor_v1(ctx)
    }

    pub fn distribute_daily_rake_v1(ctx: Context<DistributeDailyRakeV1>) -> Result<()> {
        instructions::daily_instructions::handler_distribute_daily_rake_v1(ctx)
    }

    pub fn prepare_campaign_run_v1(
        ctx: Context<PrepareCampaignRunV1>,
        run_id: u64,
        map_id: u8,
        level: u8,
        action_authority: Pubkey,
    ) -> Result<()> {
        instructions::v2_instructions::handler_prepare_campaign_run_v1(
            ctx,
            run_id,
            map_id,
            level,
            action_authority,
        )
    }

    pub fn delegate_active_run_v1(ctx: Context<DelegateActiveRunV1>) -> Result<()> {
        instructions::run_lifecycle::handler_delegate_active_run_v1(ctx)
    }

    pub fn request_row_vrf_v1(ctx: Context<RequestRowVrfV1>, client_seed: [u8; 32]) -> Result<()> {
        instructions::run_lifecycle::handler_request_row_vrf_v1(ctx, client_seed)
    }

    pub fn fulfill_row_vrf_v1(ctx: Context<FulfillRowVrfV1>, randomness: [u8; 32]) -> Result<()> {
        instructions::run_lifecycle::handler_fulfill_row_vrf_v1(ctx, randomness)
    }

    pub fn play_move_v1(
        ctx: Context<PlayMoveV1>,
        expected_action: u32,
        expected_move: u16,
        row: u8,
        start: u8,
        destination: u8,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_play_move_v1(
            ctx,
            expected_action,
            expected_move,
            row,
            start,
            destination,
        )
    }

    pub fn apply_bonus_v1(
        ctx: Context<ApplyBonusV1>,
        expected_action: u32,
        row: u8,
        column: u8,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_apply_bonus_v1(ctx, expected_action, row, column)
    }

    pub fn seal_run_v1(ctx: Context<SealRunV1>) -> Result<()> {
        instructions::run_lifecycle::handler_seal_run_v1(ctx)
    }

    pub fn rotate_active_run_authority_v1(
        ctx: Context<RotateActiveRunAuthorityV1>,
        new_action_authority: Pubkey,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_rotate_active_run_authority_v1(
            ctx,
            new_action_authority,
        )
    }

    pub fn commit_run_v1(ctx: Context<CommitRunV1>) -> Result<()> {
        instructions::run_lifecycle::handler_commit_run_v1(ctx)
    }

    pub fn consume_run_receipt_v1(ctx: Context<ConsumeRunReceiptV1>) -> Result<()> {
        instructions::run_lifecycle::handler_consume_run_receipt_v1(ctx)
    }

    pub fn close_settled_active_run_v1(
        ctx: Context<CloseSettledActiveRunV1>,
        run_id: u64,
    ) -> Result<()> {
        instructions::run_lifecycle::handler_close_settled_active_run_v1(ctx, run_id)
    }
}
