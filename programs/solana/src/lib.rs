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

    #[cfg(any())]
    mod superseded_cube_weekly_interface {
        use super::*;

        pub fn funded_enter_daily(ctx: Context<FundedEnterDaily>, run_id: u64) -> Result<()> {
            instructions::player_funding_instructions::handler_funded_enter_daily(ctx, run_id)
        }

        pub fn funded_rollup_daily_to_weekly(
            ctx: Context<FundedRollupDailyToWeekly>,
        ) -> Result<()> {
            instructions::player_funding_instructions::handler_funded_rollup_daily_to_weekly(ctx)
        }

        pub fn initialize_economy(
            ctx: Context<InitializeEconomy>,
            args: InitializeEconomyArgs,
        ) -> Result<()> {
            instructions::economy_instructions::handler_initialize_economy(ctx, args)
        }

        pub fn update_regular_prices(
            ctx: Context<ManageEconomyPricing>,
            args: UpdateRegularPricesArgs,
        ) -> Result<()> {
            instructions::economy_instructions::handler_update_regular_prices(ctx, args)
        }

        pub fn update_cube_packs(
            ctx: Context<ManageEconomyPricing>,
            args: UpdateCubePacksArgs,
        ) -> Result<()> {
            instructions::economy_instructions::handler_update_cube_packs(ctx, args)
        }

        pub fn schedule_revenue_split(
            ctx: Context<ManageEconomyPricing>,
            args: ScheduleRevenueSplitArgs,
        ) -> Result<()> {
            instructions::economy_instructions::handler_schedule_revenue_split(ctx, args)
        }

        pub fn schedule_sale(
            ctx: Context<ManageEconomyPricing>,
            args: ScheduleSaleArgs,
        ) -> Result<()> {
            instructions::economy_instructions::handler_schedule_sale(ctx, args)
        }

        pub fn cancel_sale(ctx: Context<ManageEconomyPricing>) -> Result<()> {
            instructions::economy_instructions::handler_cancel_sale(ctx)
        }

        pub fn publish_daily_rules(
            ctx: Context<PublishDailyRules>,
            args: PublishDailyRulesArgs,
        ) -> Result<()> {
            instructions::economy_instructions::handler_publish_daily_rules(ctx, args)
        }

        pub fn purchase_cubes<'info>(
            ctx: Context<'info, PurchaseCubes<'info>>,
            pack_index: u8,
            expected_cubes: u64,
            expected_lamports: u64,
        ) -> Result<()> {
            instructions::economy_instructions::handler_purchase_cubes(
                ctx,
                pack_index,
                expected_cubes,
                expected_lamports,
            )
        }

        pub fn open_daily_challenge(ctx: Context<OpenDailyChallenge>, day_id: u32) -> Result<()> {
            instructions::economy_instructions::handler_open_daily_challenge(ctx, day_id)
        }

        pub fn enter_daily(ctx: Context<EnterDaily>, run_id: u64) -> Result<()> {
            instructions::economy_instructions::handler_enter_daily(ctx, run_id)
        }

        pub fn commit_daily_run(ctx: Context<CommitDailyRun>) -> Result<()> {
            instructions::economy_instructions::handler_commit_daily_run(ctx)
        }

        pub fn consume_daily_run(ctx: Context<ConsumeDailyRun>) -> Result<()> {
            instructions::economy_instructions::handler_consume_daily_run(ctx)
        }

        pub fn finalize_daily_challenge(ctx: Context<FinalizeDailyChallenge>) -> Result<()> {
            instructions::economy_instructions::handler_finalize_daily_challenge(ctx)
        }

        pub fn cancel_daily_challenge(ctx: Context<CancelDailyChallenge>) -> Result<()> {
            instructions::economy_instructions::handler_cancel_daily_challenge(ctx)
        }

        pub fn refund_daily_cubes(ctx: Context<RefundDailyCubes>) -> Result<()> {
            instructions::economy_instructions::handler_refund_daily_cubes(ctx)
        }

        pub fn close_daily_player(ctx: Context<CloseDailyPlayer>) -> Result<()> {
            instructions::economy_instructions::handler_close_daily_player(ctx)
        }

        pub fn close_daily_challenge(ctx: Context<CloseDailyChallenge>) -> Result<()> {
            instructions::economy_instructions::handler_close_daily_challenge(ctx)
        }

        pub fn open_weekly_challenge(
            ctx: Context<OpenWeeklyChallenge>,
            weekly_id: u32,
        ) -> Result<()> {
            instructions::economy_instructions::handler_open_weekly_challenge(ctx, weekly_id)
        }

        pub fn fund_weekly(ctx: Context<FundWeekly>, lamports: u64) -> Result<()> {
            instructions::economy_instructions::handler_fund_weekly(ctx, lamports)
        }

        pub fn rollup_daily_to_weekly(ctx: Context<RollupDailyToWeekly>) -> Result<()> {
            instructions::economy_instructions::handler_rollup_daily_to_weekly(ctx)
        }

        pub fn finalize_weekly_challenge(ctx: Context<FinalizeWeeklyChallenge>) -> Result<()> {
            instructions::economy_instructions::handler_finalize_weekly_challenge(ctx)
        }

        pub fn claim_weekly_cubes(ctx: Context<ClaimWeeklyCubes>) -> Result<()> {
            instructions::economy_instructions::handler_claim_weekly_cubes(ctx)
        }

        pub fn claim_weekly_sol(ctx: Context<ClaimWeeklySol>) -> Result<()> {
            instructions::economy_instructions::handler_claim_weekly_sol(ctx)
        }

        pub fn forfeit_weekly_sol(ctx: Context<ForfeitWeeklySol>) -> Result<()> {
            instructions::economy_instructions::handler_forfeit_weekly_sol(ctx)
        }

        pub fn close_weekly_player(ctx: Context<CloseWeeklyPlayer>) -> Result<()> {
            instructions::economy_instructions::handler_close_weekly_player(ctx)
        }

        pub fn close_weekly_challenge(ctx: Context<CloseWeeklyChallenge>) -> Result<()> {
            instructions::economy_instructions::handler_close_weekly_challenge(ctx)
        }
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

    pub fn schedule_arcade_terms(
        ctx: Context<ScheduleArcadeTerms>,
        args: ScheduleArcadeTermsArgs,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_schedule_arcade_terms(ctx, args)
    }

    pub fn open_weekly_jackpot(ctx: Context<OpenWeeklyJackpot>, week_id: u32) -> Result<()> {
        instructions::arcade_instructions::handler_open_weekly_jackpot(ctx, week_id)
    }

    pub fn open_arena_daily(ctx: Context<OpenArenaDaily>, day_id: u32) -> Result<()> {
        instructions::arcade_instructions::handler_open_arena_daily(ctx, day_id)
    }

    pub fn enter_arena_v1(
        ctx: Context<EnterArenaV1>,
        run_id: u64,
        expected_entry_lamports: u64,
    ) -> Result<()> {
        instructions::arcade_instructions::handler_enter_arena_v1(
            ctx,
            run_id,
            expected_entry_lamports,
        )
    }

    pub fn prepare_practice_run_v1(ctx: Context<PreparePracticeRunV1>, run_id: u64) -> Result<()> {
        instructions::arcade_instructions::handler_prepare_practice_run_v1(ctx, run_id)
    }

    pub fn consume_arena_run(ctx: Context<ConsumeArenaRun>) -> Result<()> {
        instructions::arcade_instructions::handler_consume_arena_run(ctx)
    }

    pub fn consume_practice_run(ctx: Context<ConsumePracticeRun>) -> Result<()> {
        instructions::arcade_instructions::handler_consume_practice_run(ctx)
    }

    pub fn refund_stuck_arena_entry(ctx: Context<RefundStuckArenaEntry>) -> Result<()> {
        instructions::arcade_instructions::handler_refund_stuck_arena_entry(ctx)
    }

    pub fn rollup_arena_to_weekly(ctx: Context<RollupArenaToWeekly>) -> Result<()> {
        instructions::arcade_instructions::handler_rollup_arena_to_weekly(ctx)
    }

    pub fn finalize_arena_daily(ctx: Context<FinalizeArenaDaily>) -> Result<()> {
        instructions::arcade_instructions::handler_finalize_arena_daily(ctx)
    }

    pub fn finalize_weekly_jackpot(ctx: Context<FinalizeWeeklyJackpot>) -> Result<()> {
        instructions::arcade_instructions::handler_finalize_weekly_jackpot(ctx)
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

    pub fn commit_run(ctx: Context<CommitRun>) -> Result<()> {
        instructions::run_lifecycle::handler_commit_run(ctx)
    }

    pub fn consume_campaign_run(ctx: Context<ConsumeCampaignRun>) -> Result<()> {
        instructions::run_lifecycle::handler_consume_campaign_run(ctx)
    }
}
