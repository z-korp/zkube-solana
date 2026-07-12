use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::v2::*;

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ProposeGovernanceV1<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [YIELD_POLICY_SEED],
        bump = yield_policy.bump,
        constraint = protocol.yield_policy == yield_policy.key() @ ErrorCode::InvalidOwner,
        constraint = yield_policy.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub yield_policy: Box<Account<'info, YieldStrategyPolicy>>,
    #[account(
        seeds = [TREASURY_LEDGER_SEED],
        bump = treasury_ledger.bump,
        constraint = protocol.treasury_ledger == treasury_ledger.key() @ ErrorCode::InvalidOwner,
        constraint = treasury_ledger.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    #[account(
        init,
        payer = authority,
        space = 8 + GovernanceProposal::INIT_SPACE,
        seeds = [GOVERNANCE_PROPOSAL_SEED, proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Box<Account<'info, GovernanceProposal>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_propose_governance_v1(
    ctx: Context<ProposeGovernanceV1>,
    proposal_id: u64,
    action: GovernanceAction,
) -> Result<()> {
    require!(
        proposal_id == ctx.accounts.protocol.next_governance_proposal_id,
        ErrorCode::InvalidGovernanceProposal
    );
    validate_governance_action(
        &ctx.accounts.protocol,
        &ctx.accounts.yield_policy,
        &ctx.accounts.treasury_ledger,
        action,
    )?;
    let now = Clock::get()?.unix_timestamp;
    let execute_after = now
        .checked_add(i64::from(ctx.accounts.protocol.governance_delay_seconds))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let expires_at = execute_after
        .checked_add(i64::from(
            ctx.accounts.protocol.governance_execution_window_seconds,
        ))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.proposal.set_inner(GovernanceProposal {
        version: ACCOUNT_VERSION_V1,
        protocol: ctx.accounts.protocol.key(),
        proposal_id,
        proposer: ctx.accounts.authority.key(),
        action,
        created_at: now,
        execute_after,
        expires_at,
        executed_at: 0,
        cancelled_at: 0,
        bump: ctx.bumps.proposal,
    });
    ctx.accounts.protocol.next_governance_proposal_id = proposal_id
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    emit!(GovernanceProposalCreated {
        proposal: ctx.accounts.proposal.key(),
        proposal_id,
        proposer: ctx.accounts.authority.key(),
        execute_after,
        expires_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteGovernanceV1<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [GOVERNANCE_PROPOSAL_SEED, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
        constraint = proposal.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = proposal.protocol == protocol.key() @ ErrorCode::InvalidGovernanceProposal
    )]
    pub proposal: Box<Account<'info, GovernanceProposal>>,
    #[account(
        mut,
        seeds = [YIELD_POLICY_SEED],
        bump = yield_policy.bump,
        constraint = protocol.yield_policy == yield_policy.key() @ ErrorCode::InvalidOwner,
        constraint = yield_policy.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub yield_policy: Box<Account<'info, YieldStrategyPolicy>>,
    #[account(
        seeds = [TREASURY_LEDGER_SEED],
        bump = treasury_ledger.bump,
        constraint = protocol.treasury_ledger == treasury_ledger.key() @ ErrorCode::InvalidOwner,
        constraint = treasury_ledger.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub treasury_ledger: Box<Account<'info, TreasuryLedger>>,
    pub caller: Signer<'info>,
}

pub fn handler_execute_governance_v1(ctx: Context<ExecuteGovernanceV1>) -> Result<()> {
    require!(
        ctx.accounts.proposal.is_pending(),
        ErrorCode::InvalidGovernanceProposal
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.proposal.execute_after,
        ErrorCode::GovernanceTimelockActive
    );
    require!(
        now <= ctx.accounts.proposal.expires_at,
        ErrorCode::GovernanceProposalExpired
    );
    let action = ctx.accounts.proposal.action;
    validate_governance_action(
        &ctx.accounts.protocol,
        &ctx.accounts.yield_policy,
        &ctx.accounts.treasury_ledger,
        action,
    )?;
    validate_governance_action_accounts(action, ctx.remaining_accounts)?;
    apply_governance_action(
        &mut ctx.accounts.protocol,
        &mut ctx.accounts.yield_policy,
        action,
    )?;
    ctx.accounts.proposal.executed_at = now;
    emit!(GovernanceProposalExecuted {
        proposal: ctx.accounts.proposal.key(),
        proposal_id: ctx.accounts.proposal.proposal_id,
        caller: ctx.accounts.caller.key(),
        executed_at: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelGovernanceV1<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [GOVERNANCE_PROPOSAL_SEED, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
        constraint = proposal.protocol == protocol.key() @ ErrorCode::InvalidGovernanceProposal
    )]
    pub proposal: Box<Account<'info, GovernanceProposal>>,
    pub authority: Signer<'info>,
}

pub fn handler_cancel_governance_v1(ctx: Context<CancelGovernanceV1>) -> Result<()> {
    require!(
        ctx.accounts.proposal.is_pending(),
        ErrorCode::InvalidGovernanceProposal
    );
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.proposal.cancelled_at = now;
    emit!(GovernanceProposalCancelled {
        proposal: ctx.accounts.proposal.key(),
        proposal_id: ctx.accounts.proposal.proposal_id,
        cancelled_at: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct PauseProtocolV1<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub authority: Signer<'info>,
}

pub fn handler_pause_protocol_v1(ctx: Context<PauseProtocolV1>) -> Result<()> {
    require!(!ctx.accounts.protocol.paused, ErrorCode::InvalidState);
    ctx.accounts.protocol.paused = true;
    Ok(())
}

#[derive(Accounts)]
pub struct PauseYieldStrategyV1<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [YIELD_POLICY_SEED],
        bump = yield_policy.bump,
        constraint = protocol.yield_policy == yield_policy.key() @ ErrorCode::InvalidOwner,
        constraint = yield_policy.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub yield_policy: Box<Account<'info, YieldStrategyPolicy>>,
    pub authority: Signer<'info>,
}

pub fn handler_pause_yield_strategy_v1(ctx: Context<PauseYieldStrategyV1>) -> Result<()> {
    require!(
        ctx.accounts.yield_policy.deposits_enabled || !ctx.accounts.yield_policy.emergency_exit,
        ErrorCode::InvalidState
    );
    ctx.accounts.yield_policy.deposits_enabled = false;
    ctx.accounts.yield_policy.emergency_exit = true;
    emit!(YieldStrategyEmergencyPaused {
        authority: ctx.accounts.authority.key(),
        yield_policy: ctx.accounts.yield_policy.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptProtocolAuthorityV1<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION_V1 @ ErrorCode::InvalidVersion,
        constraint = protocol.pending_authority == pending_authority.key() @ ErrorCode::Unauthorized
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    pub pending_authority: Signer<'info>,
}

pub fn handler_accept_protocol_authority_v1(ctx: Context<AcceptProtocolAuthorityV1>) -> Result<()> {
    ctx.accounts.protocol.authority = ctx.accounts.pending_authority.key();
    ctx.accounts.protocol.pending_authority = Pubkey::default();
    Ok(())
}

fn validate_governance_action(
    protocol: &ProtocolConfig,
    yield_policy: &YieldStrategyPolicy,
    treasury_ledger: &TreasuryLedger,
    action: GovernanceAction,
) -> Result<()> {
    match action {
        GovernanceAction::SetPendingAuthority { new_authority } => require!(
            new_authority != Pubkey::default() && new_authority != protocol.authority,
            ErrorCode::InvalidGovernanceProposal
        ),
        GovernanceAction::SetPaymasterPolicy {
            paymaster,
            daily_transaction_limit,
            daily_paid_attempt_limit,
            ..
        } => require!(
            paymaster != Pubkey::default()
                && daily_transaction_limit > 0
                && daily_paid_attempt_limit > 0,
            ErrorCode::InvalidGovernanceProposal
        ),
        GovernanceAction::ConfigureYieldStrategy {
            strategy_version,
            adapter_program,
            market,
            reserve,
            receipt_mint,
            max_principal,
            max_exposure_bps,
            min_liquid_reserve_bps,
            max_slippage_bps,
            max_loss_bps,
        } => require!(
            strategy_version > yield_policy.strategy_version
                && adapter_program != Pubkey::default()
                && market != Pubkey::default()
                && reserve != Pubkey::default()
                && receipt_mint != Pubkey::default()
                && max_principal > 0
                && (1..=MAX_YIELD_EXPOSURE_BPS).contains(&max_exposure_bps)
                && (MIN_YIELD_LIQUID_RESERVE_BPS..=10_000).contains(&min_liquid_reserve_bps)
                && max_slippage_bps <= MAX_YIELD_SLIPPAGE_BPS
                && max_loss_bps <= MAX_YIELD_LOSS_BPS
                && treasury_ledger.strategy_principal == 0,
            ErrorCode::InvalidGovernanceProposal
        ),
        GovernanceAction::SetYieldStrategyStatus {
            deposits_enabled,
            emergency_exit,
        } => require!(
            !deposits_enabled || (!emergency_exit && yield_policy.is_configured()),
            ErrorCode::InvalidGovernanceProposal
        ),
        GovernanceAction::SetYieldAllocation { reward_bps } => {
            require!(reward_bps <= 10_000, ErrorCode::InvalidGovernanceProposal);
        }
        GovernanceAction::SetRevenueAllocation { reward_bps } => {
            require!(reward_bps <= 10_000, ErrorCode::InvalidGovernanceProposal);
        }
        GovernanceAction::SetContentVersion { content_version } => require!(
            content_version > protocol.content_version,
            ErrorCode::InvalidGovernanceProposal
        ),
        GovernanceAction::SetProgressVersion { progress_version } => require!(
            progress_version > protocol.progress_version,
            ErrorCode::InvalidGovernanceProposal
        ),
        GovernanceAction::SetGovernanceTiming {
            delay_seconds,
            execution_window_seconds,
        } => validate_governance_timing(delay_seconds, execution_window_seconds)?,
        GovernanceAction::Unpause => {
            require!(protocol.paused, ErrorCode::InvalidGovernanceProposal);
        }
    }
    Ok(())
}

fn apply_governance_action(
    protocol: &mut ProtocolConfig,
    yield_policy: &mut YieldStrategyPolicy,
    action: GovernanceAction,
) -> Result<()> {
    match action {
        GovernanceAction::SetPendingAuthority { new_authority } => {
            protocol.pending_authority = new_authority;
        }
        GovernanceAction::SetPaymasterPolicy {
            paymaster,
            daily_transaction_limit,
            daily_paid_attempt_limit,
            paymaster_cap,
        } => {
            protocol.paymaster = paymaster;
            protocol.sponsorship_daily_tx_limit = daily_transaction_limit;
            protocol.sponsorship_daily_paid_attempt_limit = daily_paid_attempt_limit;
            protocol.paymaster_cap = paymaster_cap;
        }
        GovernanceAction::ConfigureYieldStrategy {
            strategy_version,
            adapter_program,
            market,
            reserve,
            receipt_mint,
            max_principal,
            max_exposure_bps,
            min_liquid_reserve_bps,
            max_slippage_bps,
            max_loss_bps,
        } => {
            yield_policy.strategy_version = strategy_version;
            yield_policy.adapter_program = adapter_program;
            yield_policy.market = market;
            yield_policy.reserve = reserve;
            yield_policy.receipt_mint = receipt_mint;
            yield_policy.max_principal = max_principal;
            yield_policy.max_exposure_bps = max_exposure_bps;
            yield_policy.min_liquid_reserve_bps = min_liquid_reserve_bps;
            yield_policy.max_slippage_bps = max_slippage_bps;
            yield_policy.max_loss_bps = max_loss_bps;
            yield_policy.deposits_enabled = false;
            yield_policy.emergency_exit = false;
        }
        GovernanceAction::SetYieldStrategyStatus {
            deposits_enabled,
            emergency_exit,
        } => {
            yield_policy.deposits_enabled = deposits_enabled;
            yield_policy.emergency_exit = emergency_exit;
        }
        GovernanceAction::SetYieldAllocation { reward_bps } => {
            yield_policy.yield_reward_bps = reward_bps;
        }
        GovernanceAction::SetRevenueAllocation { reward_bps } => {
            protocol.revenue_reward_bps = reward_bps;
        }
        GovernanceAction::SetContentVersion { content_version } => {
            protocol.content_version = content_version;
        }
        GovernanceAction::SetProgressVersion { progress_version } => {
            protocol.progress_version = progress_version;
        }
        GovernanceAction::SetGovernanceTiming {
            delay_seconds,
            execution_window_seconds,
        } => {
            protocol.governance_delay_seconds = delay_seconds;
            protocol.governance_execution_window_seconds = execution_window_seconds;
        }
        GovernanceAction::Unpause => protocol.paused = false,
    }
    Ok(())
}

fn validate_governance_action_accounts<'info>(
    action: GovernanceAction,
    remaining_accounts: &'info [AccountInfo<'info>],
) -> Result<()> {
    if let GovernanceAction::SetProgressVersion { progress_version } = action {
        let catalog_info = remaining_accounts
            .first()
            .ok_or(ErrorCode::InvalidProgressCatalog)?;
        let (expected, _) = Pubkey::find_program_address(
            &[
                PROGRESS_CATALOG_SEED,
                progress_version.to_le_bytes().as_ref(),
            ],
            &crate::ID,
        );
        require_keys_eq!(
            catalog_info.key(),
            expected,
            ErrorCode::InvalidProgressCatalog
        );
        require_keys_eq!(
            *catalog_info.owner,
            crate::ID,
            ErrorCode::InvalidProgressCatalog
        );
        let catalog = Account::<ProgressCatalog>::try_from(catalog_info)?;
        require!(
            catalog.version == ACCOUNT_VERSION_V1 && catalog.progress_version == progress_version,
            ErrorCode::InvalidProgressCatalog
        );
    }
    Ok(())
}

pub fn validate_governance_timing(delay_seconds: u32, execution_window_seconds: u32) -> Result<()> {
    require!(
        (MIN_GOVERNANCE_DELAY_SECONDS..=MAX_GOVERNANCE_DELAY_SECONDS).contains(&delay_seconds)
            && (MIN_GOVERNANCE_DELAY_SECONDS..=MAX_GOVERNANCE_DELAY_SECONDS)
                .contains(&execution_window_seconds),
        ErrorCode::InvalidGovernanceProposal
    );
    Ok(())
}

#[event]
pub struct GovernanceProposalCreated {
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub proposer: Pubkey,
    pub execute_after: i64,
    pub expires_at: i64,
}

#[event]
pub struct GovernanceProposalExecuted {
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub caller: Pubkey,
    pub executed_at: i64,
}

#[event]
pub struct GovernanceProposalCancelled {
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub cancelled_at: i64,
}

#[event]
pub struct YieldStrategyEmergencyPaused {
    pub authority: Pubkey,
    pub yield_policy: Pubkey,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn governance_timing_is_bounded() {
        assert!(validate_governance_timing(3_600, 3_600).is_ok());
        assert!(validate_governance_timing(3_599, 3_600).is_err());
        assert!(validate_governance_timing(MAX_GOVERNANCE_DELAY_SECONDS + 1, 3_600).is_err());
    }

    #[test]
    fn sensitive_updates_validate_and_apply_as_one_action() {
        let mut protocol = protocol_fixture();
        let mut yield_policy = yield_policy_fixture();
        let treasury_ledger = treasury_ledger_fixture();
        let next_paymaster = Pubkey::new_unique();
        let action = GovernanceAction::SetPaymasterPolicy {
            paymaster: next_paymaster,
            daily_transaction_limit: 7,
            daily_paid_attempt_limit: 2,
            paymaster_cap: 500,
        };
        assert!(
            validate_governance_action(&protocol, &yield_policy, &treasury_ledger, action).is_ok()
        );
        apply_governance_action(&mut protocol, &mut yield_policy, action).unwrap();
        assert_eq!(protocol.paymaster, next_paymaster);
        assert_eq!(protocol.sponsorship_daily_tx_limit, 7);
        assert_eq!(protocol.sponsorship_daily_paid_attempt_limit, 2);
        assert_eq!(protocol.paymaster_cap, 500);
    }

    #[test]
    fn progress_activation_is_monotonic_and_governed() {
        let mut protocol = protocol_fixture();
        let mut yield_policy = yield_policy_fixture();
        let treasury_ledger = treasury_ledger_fixture();
        let action = GovernanceAction::SetProgressVersion {
            progress_version: 2,
        };
        assert!(
            validate_governance_action(&protocol, &yield_policy, &treasury_ledger, action).is_ok()
        );
        apply_governance_action(&mut protocol, &mut yield_policy, action).unwrap();
        assert_eq!(protocol.progress_version, 2);
        assert!(validate_governance_action(
            &protocol,
            &yield_policy,
            &treasury_ledger,
            GovernanceAction::SetProgressVersion {
                progress_version: 2,
            },
        )
        .is_err());
    }

    #[test]
    fn yield_strategy_stays_disabled_until_bounded_governance_activation() {
        let mut protocol = protocol_fixture();
        let mut yield_policy = yield_policy_fixture();
        let mut treasury_ledger = treasury_ledger_fixture();
        let configure = GovernanceAction::ConfigureYieldStrategy {
            strategy_version: 1,
            adapter_program: Pubkey::new_unique(),
            market: Pubkey::new_unique(),
            reserve: Pubkey::new_unique(),
            receipt_mint: Pubkey::new_unique(),
            max_principal: 1_000_000,
            max_exposure_bps: 2_500,
            min_liquid_reserve_bps: 7_500,
            max_slippage_bps: 25,
            max_loss_bps: 100,
        };
        assert!(
            validate_governance_action(&protocol, &yield_policy, &treasury_ledger, configure)
                .is_ok()
        );
        apply_governance_action(&mut protocol, &mut yield_policy, configure).unwrap();
        assert!(yield_policy.is_configured());
        assert_eq!(yield_policy.strategy_version, 1);
        assert!(!yield_policy.deposits_enabled);
        assert!(
            validate_governance_action(&protocol, &yield_policy, &treasury_ledger, configure)
                .is_err()
        );

        let enable = GovernanceAction::SetYieldStrategyStatus {
            deposits_enabled: true,
            emergency_exit: false,
        };
        assert!(
            validate_governance_action(&protocol, &yield_policy, &treasury_ledger, enable).is_ok()
        );
        apply_governance_action(&mut protocol, &mut yield_policy, enable).unwrap();
        assert!(yield_policy.deposits_enabled);
        assert!(!yield_policy.emergency_exit);

        let allocation = GovernanceAction::SetYieldAllocation { reward_bps: 7_500 };
        assert!(
            validate_governance_action(&protocol, &yield_policy, &treasury_ledger, allocation)
                .is_ok()
        );
        apply_governance_action(&mut protocol, &mut yield_policy, allocation).unwrap();
        assert_eq!(yield_policy.yield_reward_bps, 7_500);
        assert!(validate_governance_action(
            &protocol,
            &yield_policy,
            &treasury_ledger,
            GovernanceAction::SetYieldAllocation { reward_bps: 10_001 }
        )
        .is_err());

        let invalid = GovernanceAction::ConfigureYieldStrategy {
            strategy_version: 2,
            adapter_program: Pubkey::new_unique(),
            market: Pubkey::new_unique(),
            reserve: Pubkey::new_unique(),
            receipt_mint: Pubkey::new_unique(),
            max_principal: 1,
            max_exposure_bps: MAX_YIELD_EXPOSURE_BPS + 1,
            min_liquid_reserve_bps: MIN_YIELD_LIQUID_RESERVE_BPS,
            max_slippage_bps: 0,
            max_loss_bps: 0,
        };
        assert!(
            validate_governance_action(&protocol, &yield_policy, &treasury_ledger, invalid)
                .is_err()
        );

        let reconfigure = GovernanceAction::ConfigureYieldStrategy {
            strategy_version: 2,
            adapter_program: Pubkey::new_unique(),
            market: Pubkey::new_unique(),
            reserve: Pubkey::new_unique(),
            receipt_mint: Pubkey::new_unique(),
            max_principal: 1_000_000,
            max_exposure_bps: 2_500,
            min_liquid_reserve_bps: 7_500,
            max_slippage_bps: 25,
            max_loss_bps: 100,
        };
        treasury_ledger.strategy_principal = 1;
        assert!(validate_governance_action(
            &protocol,
            &yield_policy,
            &treasury_ledger,
            reconfigure
        )
        .is_err());
    }

    fn protocol_fixture() -> ProtocolConfig {
        ProtocolConfig {
            version: ACCOUNT_VERSION_V1,
            authority: Pubkey::new_unique(),
            pending_authority: Pubkey::default(),
            paymaster: Pubkey::new_unique(),
            team_vault: Pubkey::new_unique(),
            paymaster_vault: Pubkey::new_unique(),
            treasury_vault: Pubkey::new_unique(),
            reward_vault: Pubkey::new_unique(),
            paymaster_cap: 100,
            revenue_reward_bps: 0,
            sponsorship_daily_tx_limit: 10,
            sponsorship_daily_paid_attempt_limit: 2,
            payment_mint: Pubkey::new_unique(),
            payment_token_program: Pubkey::new_unique(),
            payment_vault: Pubkey::new_unique(),
            yield_policy: Pubkey::new_unique(),
            treasury_ledger: Pubkey::new_unique(),
            content_version: 1,
            progress_version: 1,
            governance_delay_seconds: 3_600,
            governance_execution_window_seconds: 86_400,
            next_governance_proposal_id: 1,
            paused: false,
            bump: 1,
        }
    }

    fn yield_policy_fixture() -> YieldStrategyPolicy {
        YieldStrategyPolicy::initialize(Pubkey::new_unique(), 1)
    }

    fn treasury_ledger_fixture() -> TreasuryLedger {
        TreasuryLedger::initialize(Pubkey::new_unique(), Pubkey::new_unique(), 1)
    }
}
