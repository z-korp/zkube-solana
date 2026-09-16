//! Native-SOL Arena entry, period funding, resolution, and claim settlement.

use crate::error::ErrorCode;
use crate::instructions::player_authorization::require_player_authorization;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::{invoke, invoke_signed},
    system_instruction, system_program,
};
use session_keys::SessionTokenV2;

#[derive(Accounts)]
#[instruction(day_id: u32)]
pub struct PrepareArenaDaily<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = day_id > protocol.last_daily_id @ ErrorCode::InvalidPeriod)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,

    /// CHECK: Canonical Daily PDA allocated and serialized by this instruction.
    #[account(mut, seeds = [ARENA_DAILY_SEED, day_id.to_le_bytes().as_ref()], bump)]
    pub arena_daily: UncheckedAccount<'info>,
    /// CHECK: Canonical System-owned zero-data payer; signs only this rent path.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = cadence_funding.data_is_empty() && !cadence_funding.executable @ ErrorCode::InvalidOwner)]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_prepare_arena_daily(ctx: Context<PrepareArenaDaily>, day_id: u32) -> Result<()> {
    let today = day_id_at(Clock::get()?.unix_timestamp)?;
    require!(
        prepare_period_is_allowed(
            day_id,
            today,
            ctx.accounts.protocol.launch_day_id,
            ctx.accounts.protocol.suspended_until_day,
        ),
        ErrorCode::InvalidPeriod
    );
    let content = zkube_core::daily_pair_with::<SolanaSha256>(day_id);
    let realm = zkube_core::REALM_RULES[usize::from(content.0 - 1)];
    let rules_hash = zkube_core::daily_rules_hash_with::<SolanaSha256>(
        day_id,
        realm.guardian,
        realm.starting_height,
        content.1,
    )
    .0;
    let daily = ArenaDaily {
        version: ACCOUNT_VERSION,
        day_id,
        status: PeriodStatus::Funding,
        predecessor_rollover_applied: false,
        rules_hash,
        finalized_at: 0,
        ledger: PoolLedger::default(),
        entries_paid: 0,
        entries_scored: 0,
        entries_expired: 0,
        unique_players: 0,
        score_qualified_players: 0,
        theme_qualified_players: 0,
        claims_expired: false,
        bump: ctx.bumps.arena_daily,
    };
    let daily_info = ctx.accounts.arena_daily.to_account_info();
    create_cadence_account(
        &ctx.accounts.cadence_funding.to_account_info(),
        ctx.bumps.cadence_funding,
        &daily_info,
        &[
            ARENA_DAILY_SEED,
            &day_id.to_le_bytes(),
            &[ctx.bumps.arena_daily],
        ],
        8 + ArenaDaily::INIT_SPACE,
        8 + ArenaDaily::INIT_SPACE,
        &ctx.accounts.system_program.to_account_info(),
    )?;
    daily.try_serialize(&mut &mut daily_info.try_borrow_mut_data()?[..])?;
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateArenaDaily<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,

    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Funding @ ErrorCode::InvalidState)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    pub caller: Signer<'info>,
}

pub fn handler_activate_arena_daily(ctx: Context<ActivateArenaDaily>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let current = day_id_at(now)?;
    require!(
        ctx.accounts.arena_daily.day_id >= ctx.accounts.protocol.suspended_until_day,
        ErrorCode::DailyNotScheduled
    );
    let scheduled = scheduled_daily_window(&ctx.accounts.protocol, current)?;
    require!(
        ctx.accounts.arena_daily.day_id == scheduled.0
            || ctx.accounts.arena_daily.day_id == scheduled.1,
        ErrorCode::InvalidPeriod
    );
    ctx.accounts.arena_daily.status = PeriodStatus::Open;
    Ok(())
}

#[derive(Accounts)]
pub struct SkipSuspendedArenaDaily<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        close = cadence_funding,
        seeds = [ARENA_DAILY_SEED, suspended_daily.day_id.to_le_bytes().as_ref()],
        bump = suspended_daily.bump,
        constraint = suspended_daily.status == PeriodStatus::Funding @ ErrorCode::InvalidState
    )]
    pub suspended_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, successor_daily.day_id.to_le_bytes().as_ref()],
        bump = successor_daily.bump,
        constraint = successor_daily.status == PeriodStatus::Funding @ ErrorCode::InvalidState,
        constraint = !successor_daily.predecessor_rollover_applied @ ErrorCode::InvalidState
    )]
    pub successor_daily: Box<Account<'info, ArenaDaily>>,
    /// CHECK: Canonical recyclable cadence-rent destination.
    #[account(
        mut,
        seeds = [CADENCE_FUNDING_SEED],
        bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = cadence_funding.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_skip_suspended_arena_daily(ctx: Context<SkipSuspendedArenaDaily>) -> Result<()> {
    let threshold = ctx.accounts.protocol.suspended_until_day;
    require!(
        threshold > 0
            && ctx.accounts.suspended_daily.day_id < threshold
            && ctx.accounts.successor_daily.day_id == threshold,
        ErrorCode::DailyNotScheduled
    );
    let rollover = ctx.accounts.suspended_daily.ledger.funded_lamports()?;
    require_spendable(&ctx.accounts.suspended_daily.to_account_info(), rollover)?;
    move_program_lamports(
        &ctx.accounts.suspended_daily.to_account_info(),
        &ctx.accounts.successor_daily.to_account_info(),
        rollover,
    )?;
    ctx.accounts.successor_daily.ledger.rollover_in_lamports = ctx
        .accounts
        .successor_daily
        .ledger
        .rollover_in_lamports
        .checked_add(rollover)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.successor_daily.predecessor_rollover_applied = true;
    Ok(())
}

#[derive(Accounts)]
pub struct DepositArenaDaily<'info> {
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_deposit_arena_daily(ctx: Context<DepositArenaDaily>, lamports: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let current = day_id_at(now)?;
    require!(lamports > 0, ErrorCode::InvalidState);
    let launches = ctx.accounts.protocol.launch_day_id == 0;
    if launches {
        require!(ctx.accounts.protocol.paused, ErrorCode::InvalidState);
        require!(
            ctx.accounts.arena_daily.day_id == current,
            ErrorCode::InvalidPeriod
        );
        require!(
            ctx.accounts.arena_daily.ledger.funded_lamports()? == 0,
            ErrorCode::InvalidState
        );
        require!(
            ctx.accounts.arena_daily.status == PeriodStatus::Funding
                && !ctx.accounts.arena_daily.predecessor_rollover_applied,
            ErrorCode::InvalidState
        );
    } else {
        require!(
            scheduled_daily_window(&ctx.accounts.protocol, current).is_ok_and(
                |(first, following)| ctx.accounts.arena_daily.day_id == first
                    || ctx.accounts.arena_daily.day_id == following
            ),
            ErrorCode::InvalidPeriod
        );
        require!(
            matches!(
                ctx.accounts.arena_daily.status,
                PeriodStatus::Funding | PeriodStatus::Open
            ) && now < day_window(ctx.accounts.arena_daily.day_id)?.1,
            ErrorCode::InvalidPeriod
        );
    }
    transfer_from_signer(
        &ctx.accounts.authority,
        &ctx.accounts.arena_daily.to_account_info(),
        &ctx.accounts.system_program,
        lamports,
    )?;
    ctx.accounts.arena_daily.ledger.add_seed(lamports)?;
    if launches {
        ctx.accounts.arena_daily.predecessor_rollover_applied = true;
        ctx.accounts.protocol.launch_day_id = current;
        ctx.accounts.protocol.last_daily_id =
            current.checked_sub(1).ok_or(ErrorCode::InvalidPeriod)?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct PurchaseKredits<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(
        mut,
        seeds = [CREDIT_VAULT_SEED],
        bump = credit_vault.bump,
        constraint = credit_vault.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = credit_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner
    )]
    pub credit_vault: Box<Account<'info, CreditVault>>,
    /// CHECK: Exact protocol destination, validated as a System wallet.
    #[account(mut, address = protocol.team_destination @ ErrorCode::InvalidOwner,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = team_destination.data_is_empty() && !team_destination.executable @ ErrorCode::InvalidOwner)]
    pub team_destination: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_purchase_kredits(ctx: Context<PurchaseKredits>, kredit_count: u32) -> Result<()> {
    require!(
        ctx.accounts.protocol.launch_day_id > 0,
        ErrorCode::InvalidState
    );
    require!(kredit_count > 0, ErrorCode::InvalidState);
    let split = zkube_core::split_arena_entry(ARENA_ENTRY_LAMPORTS)
        .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    let count = u64::from(kredit_count);
    let prize_lamports = split
        .next_daily_lamports
        .checked_mul(count)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let operator_lamports = split
        .operator_lamports
        .checked_mul(count)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    transfer_from_signer(
        &ctx.accounts.owner,
        &ctx.accounts.credit_vault.to_account_info(),
        &ctx.accounts.system_program,
        prize_lamports,
    )?;
    transfer_from_signer(
        &ctx.accounts.owner,
        &ctx.accounts.team_destination.to_account_info(),
        &ctx.accounts.system_program,
        operator_lamports,
    )?;
    ctx.accounts.credit_vault.record_purchase(prize_lamports)?;
    ctx.accounts.player_state.record_kredit_purchase(count)?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct EnterArena<'info> {
    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = !protocol.paused @ ErrorCode::ProtocolPaused)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,

    #[account(mut, seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, current_daily.day_id.to_le_bytes().as_ref()], bump = current_daily.bump,)]
    pub current_daily: Box<Account<'info, ArenaDaily>>,
    #[account(init_if_needed, payer = payer, space = 8 + ArenaPlayer::INIT_SPACE,
        seeds = [ARENA_PLAYER_SEED, current_daily.key().as_ref(), owner_authority.key().as_ref()], bump)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()], bump = following_daily.bump,)]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [CREDIT_VAULT_SEED], bump = credit_vault.bump,
        constraint = credit_vault.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = credit_vault.protocol == protocol.key() @ ErrorCode::InvalidOwner)]
    pub credit_vault: Box<Account<'info, CreditVault>>,
    #[account(init, payer = payer, space = 8 + ActiveRun::INIT_SPACE,
        seeds = [ACTIVE_RUN_SEED, b"active", owner_authority.key().as_ref(), run_id.to_le_bytes().as_ref()], bump)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Durable identity pinned by PlayerState and all player PDAs.
    #[account(mut)]
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_enter_arena<'info>(
    ctx: Context<'info, EnterArena<'info>>,
    run_id: u64,
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    require!(
        ctx.accounts.protocol.launch_day_id > 0,
        ErrorCode::InvalidState
    );
    let now = Clock::get()?.unix_timestamp;
    let day_id = day_id_at(now)?;
    require!(
        ctx.accounts.current_daily.day_id == day_id && ctx.accounts.following_daily.day_id > day_id,
        ErrorCode::InvalidPeriod
    );
    require!(
        ctx.accounts.current_daily.status == PeriodStatus::Open
            && matches!(
                ctx.accounts.following_daily.status,
                PeriodStatus::Funding | PeriodStatus::Open
            )
            && now >= day_window(ctx.accounts.current_daily.day_id)?.0
            && now < day_window(ctx.accounts.current_daily.day_id)?.1,
        ErrorCode::InvalidPeriod
    );
    if ctx.accounts.arena_player.version == 0 {
        ctx.accounts.arena_player.set_inner(ArenaPlayer::initialize(
            ctx.accounts.current_daily.key(),
            ctx.accounts.owner_authority.key(),
            ctx.accounts.payer.key(),
            ctx.bumps.arena_player,
        ));
        ctx.accounts.current_daily.unique_players = ctx
            .accounts
            .current_daily
            .unique_players
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    require!(
        ctx.accounts.arena_player.version == ACCOUNT_VERSION
            && ctx.accounts.arena_player.challenge == ctx.accounts.current_daily.key()
            && ctx.accounts.arena_player.player == ctx.accounts.owner_authority.key()
            && ctx.accounts.arena_player.active_paid_run_id == 0,
        ErrorCode::InvalidOwner
    );
    require!(
        ctx.accounts.player_state.kredit_balance > 0,
        ErrorCode::InsufficientKredits
    );
    let split = zkube_core::split_arena_entry(ARENA_ENTRY_LAMPORTS)
        .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    require!(
        ctx.accounts.credit_vault.available_prize_lamports >= split.next_daily_lamports,
        ErrorCode::AccountingInvariant
    );
    require_spendable(
        &ctx.accounts.credit_vault.to_account_info(),
        split.next_daily_lamports,
    )?;
    move_program_lamports(
        &ctx.accounts.credit_vault.to_account_info(),
        &ctx.accounts.following_daily.to_account_info(),
        split.next_daily_lamports,
    )?;
    ctx.accounts
        .credit_vault
        .record_spend(split.next_daily_lamports)?;
    ctx.accounts
        .following_daily
        .ledger
        .add_entry(split.next_daily_lamports)?;
    ctx.accounts.current_daily.entries_paid = ctx
        .accounts
        .current_daily
        .entries_paid
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts.arena_player.paid_entries = ctx
        .accounts
        .arena_player
        .paid_entries
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    ctx.accounts
        .player_state
        .record_paid_entry(ctx.accounts.current_daily.day_id)?;
    ctx.accounts.arena_player.active_paid_run_id = run_id;
    let daily_key = ctx.accounts.current_daily.key();
    let deadline_at = day_window(ctx.accounts.current_daily.day_id)?.1;
    ctx.accounts
        .player_state
        .reserve_arcade_run(run_id, daily_key, deadline_at)?;
    let owner = ctx.accounts.owner_authority.key();
    let domain = zkube_core::ChainDomain(ctx.accounts.protocol.replay_domain);
    let player_id = zkube_core::derive_player_id_with::<SolanaSha256>(domain, owner.to_bytes());
    let content = zkube_core::daily_pair_with::<SolanaSha256>(ctx.accounts.current_daily.day_id);
    let realm = zkube_core::REALM_RULES[usize::from(content.0 - 1)];
    ctx.accounts.active_run.set_inner(ActiveRun {
        version: ACCOUNT_VERSION,
        owner,
        rent_payer: ctx.accounts.payer.key(),
        daily_challenge: daily_key,
        run_id,
        lifecycle: RunLifecycle::Prepared,
        rules_hash: ctx.accounts.current_daily.rules_hash,
        map_id: content.0,
        rules: RealmRuleSnapshot::from_core(realm),
        daily_theme: DailyThemeSnapshot::from_core(content.1),
        reroll_charges: 1,
        replay_hash: zkube_core::ReplayCommitment::initial_with::<SolanaSha256>(
            domain,
            zkube_core::ChallengeId(daily_key.to_bytes()),
            zkube_core::RulesHash(ctx.accounts.current_daily.rules_hash),
            player_id,
            run_id,
        )
        .to_bytes(),
        deadline_at,
        bump: ctx.bumps.active_run,
        ..ActiveRun::default()
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ConsumeArenaRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, active_run.owner.as_ref()], bump = player_state.bump,
        constraint = player_state.owner == active_run.owner @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.key() == active_run.daily_challenge @ ErrorCode::InvalidOwner)]
    pub arena_daily: Option<Box<Account<'info, ArenaDaily>>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, active_run.daily_challenge.as_ref(), active_run.owner.as_ref()], bump = arena_player.bump,
        constraint = arena_player.player == active_run.owner @ ErrorCode::Unauthorized)]
    pub arena_player: Option<Box<Account<'info, ArenaPlayer>>>,
    #[account(mut, close = rent_recipient, seeds = [ACTIVE_RUN_SEED, b"active", active_run.owner.as_ref(), active_run.run_id.to_le_bytes().as_ref()], bump = active_run.bump,
        constraint = active_run.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub active_run: Box<Account<'info, ActiveRun>>,
    /// CHECK: Exact original payer persisted on the closing account.
    #[account(mut, address = active_run.rent_payer @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
}

pub fn handler_consume_arena_run(ctx: Context<ConsumeArenaRun>) -> Result<()> {
    let active = &ctx.accounts.active_run;
    if ctx.accounts.player_state.orphan_run_id == active.run_id {
        return ctx.accounts.player_state.release_orphan(active.run_id);
    }
    let daily = ctx
        .accounts
        .arena_daily
        .as_mut()
        .ok_or(ErrorCode::InvalidState)?;
    let player = ctx
        .accounts
        .arena_player
        .as_mut()
        .ok_or(ErrorCode::InvalidState)?;
    require!(
        active.lifecycle == RunLifecycle::Finished
            && active.finished_at > 0
            && active.finished_at <= day_window(daily.day_id)?.1
            && active.pending_vrf_counter == 0,
        ErrorCode::InvalidState
    );
    require!(
        ctx.accounts.player_state.arcade_reservation_matches(
            active.run_id,
            active.daily_challenge,
            active.deadline_at,
        ) && player.active_paid_run_id == active.run_id,
        ErrorCode::InvalidRunId
    );
    player.active_paid_run_id = 0;
    if active.action_counter == 0 {
        daily.record_expired_entry(player)?;
    } else {
        let candidate = ArenaBoardEntry {
            player: active.owner,
            score: active.daily_score,
            objective_total: active.objective_total,
            finalized_at: active.finished_at,
            replay_hash: active.replay_hash,
        };
        daily.record_scored_entry(player, &mut ctx.accounts.player_state, candidate)?;
        daily.entries_scored = daily
            .entries_scored
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        player.resolved_entries = player
            .resolved_entries
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    ctx.accounts.player_state.release_arcade_run(active.run_id)
}

#[derive(Accounts)]
pub struct ExpireUnresolvedArenaRun<'info> {
    #[account(mut, seeds = [PLAYER_STATE_SEED, owner.key().as_ref()], bump = player_state.bump,
        constraint = player_state.owner == owner.key() @ ErrorCode::Unauthorized,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion)]
    pub player_state: Box<Account<'info, PlayerState>>,
    #[account(mut, address = player_state.active_run_daily,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_PLAYER_SEED, arena_daily.key().as_ref(), owner.key().as_ref()], bump = arena_player.bump,
        constraint = arena_player.player == owner.key() @ ErrorCode::Unauthorized)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    /// CHECK: Wallet identity pinned by PlayerState.
    pub owner: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_expire_unresolved_arena_run(ctx: Context<ExpireUnresolvedArenaRun>) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp
            >= ctx
                .accounts
                .player_state
                .active_run_deadline_at
                .checked_add(STUCK_RUN_RECOVERY_SECONDS)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
        ErrorCode::InvalidPeriod
    );
    let run_id = ctx.accounts.player_state.active_run_id;
    require!(run_id != 0, ErrorCode::InvalidRunId);
    let player = &mut ctx.accounts.arena_player;
    require!(player.active_paid_run_id == run_id, ErrorCode::InvalidRunId);
    ctx.accounts.arena_daily.record_expired_entry(player)?;
    player.active_paid_run_id = 0;
    ctx.accounts.player_state.expire_arcade_run(run_id)
}

#[derive(Accounts)]
pub struct FinalizeArenaDaily<'info> {
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()], bump = following_daily.bump,
        constraint = !following_daily.predecessor_rollover_applied @ ErrorCode::InvalidState)]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    /// CHECK: Exact-sized Score board allocated and serialized below.
    #[account(mut, seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()], bump)]
    pub score_board: UncheckedAccount<'info>,
    /// CHECK: Exact-sized Theme board allocated and serialized below.
    #[account(mut, seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()], bump)]
    pub theme_board: UncheckedAccount<'info>,
    /// CHECK: Canonical System-owned zero-data payer; signs only this rent path.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = cadence_funding.data_is_empty() && !cadence_funding.executable @ ErrorCode::InvalidOwner)]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_finalize_arena_daily(ctx: Context<FinalizeArenaDaily>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        matches!(
            ctx.accounts.arena_daily.status,
            PeriodStatus::Open | PeriodStatus::Funding
        ) && ctx.accounts.arena_daily.predecessor_rollover_applied
            && now >= day_window(ctx.accounts.arena_daily.day_id)?.1
            && ctx.accounts.arena_daily.resolved(),
        ErrorCode::InvalidPeriod
    );
    require!(
        ctx.accounts.following_daily.day_id > ctx.accounts.arena_daily.day_id,
        ErrorCode::InvalidPeriod
    );
    let pool = ctx.accounts.arena_daily.ledger.available_lamports()?;
    let pools = daily_board_pools(pool, ctx.accounts.arena_daily.theme_qualified_players);
    let score_plan = board_payout_plan(
        pools.score,
        ctx.accounts.arena_daily.score_qualified_players,
    )?;
    let theme_plan = board_payout_plan(
        pools.theme,
        ctx.accounts.arena_daily.theme_qualified_players,
    )?;
    let source_info = ctx.accounts.arena_daily.to_account_info();
    let successor_info = ctx.accounts.following_daily.to_account_info();
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    for (info, kind, count, bump) in [
        (
            &score_info,
            DailyBoardKind::Score,
            score_plan.count,
            ctx.bumps.score_board,
        ),
        (
            &theme_info,
            DailyBoardKind::Theme,
            theme_plan.count,
            ctx.bumps.theme_board,
        ),
    ] {
        create_cadence_account(
            &ctx.accounts.cadence_funding.to_account_info(),
            ctx.bumps.cadence_funding,
            info,
            &[
                ARENA_BOARD_SEED,
                source_info.key.as_ref(),
                kind.seed(),
                &[bump],
            ],
            ArenaBoard::construction_space(count, 0)?,
            ArenaBoard::account_space(count)?,
            &ctx.accounts.system_program.to_account_info(),
        )?;
    }
    let mut score_board = ArenaBoard::default();
    let mut theme_board = ArenaBoard::default();
    let source = &mut ctx.accounts.arena_daily;
    let successor = &mut ctx.accounts.following_daily;
    require_spendable(&source_info, pool)?;
    require!(!source.claims_expired, ErrorCode::InvalidState);
    let paid_lamports = score_plan
        .paid_lamports
        .checked_add(theme_plan.paid_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let rollover_lamports = score_plan
        .rollover_lamports
        .checked_add(theme_plan.rollover_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        paid_lamports.checked_add(rollover_lamports) == Some(pool),
        ErrorCode::AccountingInvariant
    );
    move_program_lamports(&source_info, &successor_info, rollover_lamports)?;
    source.ledger.settle(paid_lamports, rollover_lamports)?;
    successor.ledger.add_rollover(rollover_lamports)?;
    successor.predecessor_rollover_applied = true;
    initialize_arena_board(
        &mut score_board,
        ArenaBoardInitialization {
            daily: source_info.key(),
            day_id: source.day_id,
            kind: DailyBoardKind::Score,
            qualified_count: source.score_qualified_players,
            pool_lamports: pools.score,
            plan: score_plan,
            finalized_at: now,
            bump: ctx.bumps.score_board,
        },
    );
    initialize_arena_board(
        &mut theme_board,
        ArenaBoardInitialization {
            daily: source_info.key(),
            day_id: source.day_id,
            kind: DailyBoardKind::Theme,
            qualified_count: source.theme_qualified_players,
            pool_lamports: pools.theme,
            plan: theme_plan,
            finalized_at: now,
            bump: ctx.bumps.theme_board,
        },
    );
    require!(
        score_info.data_len() == ArenaBoard::construction_space(score_plan.count, 0)?
            && theme_info.data_len() == ArenaBoard::construction_space(theme_plan.count, 0)?,
        ErrorCode::AccountingInvariant
    );
    source.status = PeriodStatus::Finalized;
    source.finalized_at = now;
    score_board.try_serialize(&mut &mut score_info.try_borrow_mut_data()?[..])?;
    theme_board.try_serialize(&mut &mut theme_info.try_borrow_mut_data()?[..])?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(kind: DailyBoardKind)]
pub struct SubmitArenaBoardChunk<'info> {
    #[account(
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), kind.seed()],
        bump = arena_board.bump,
        constraint = arena_board.kind == kind @ ErrorCode::InvalidOwner,
        constraint = arena_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner
    )]
    pub arena_board: Box<Account<'info, ArenaBoard>>,
    pub caller: Signer<'info>,
}

pub fn handler_submit_arena_board_chunk<'info>(
    ctx: Context<'info, SubmitArenaBoardChunk<'info>>,
    kind: DailyBoardKind,
    entries: Vec<SubmittedBoardEntry>,
) -> Result<()> {
    require!(
        !ctx.accounts.arena_board.sealed()
            && !entries.is_empty()
            && entries.len() <= ARENA_BOARD_CHUNK_CAPACITY
            && entries.len() == ctx.remaining_accounts.len(),
        ErrorCode::BoardIncomplete
    );
    let board_info = ctx.accounts.arena_board.to_account_info();
    ctx.accounts.arena_board.validate(
        ctx.accounts.arena_daily.key(),
        kind,
        board_info.data_len(),
    )?;
    let appended = u32::try_from(entries.len()).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let next_cursor = ctx
        .accounts
        .arena_board
        .cursor
        .checked_add(appended)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        next_cursor <= ctx.accounts.arena_board.payout_count,
        ErrorCode::BoardIncomplete
    );

    board_info.resize(ArenaBoard::construction_space(
        ctx.accounts.arena_board.payout_count,
        next_cursor,
    )?)?;
    let mut previous = if ctx.accounts.arena_board.cursor == 0 {
        None
    } else {
        Some(read_board_entry(
            &board_info,
            ctx.accounts.arena_board.cursor - 1,
        )?)
    };
    for (offset, (submitted, source_info)) in entries
        .into_iter()
        .zip(ctx.remaining_accounts.iter())
        .enumerate()
    {
        require_keys_eq!(*source_info.owner, crate::ID, ErrorCode::InvalidOwner);
        let source = {
            let data = source_info.try_borrow_data()?;
            let mut bytes: &[u8] = &data;
            ArenaPlayer::try_deserialize(&mut bytes)?
        };
        let (expected_key, _) = Pubkey::find_program_address(
            &[
                ARENA_PLAYER_SEED,
                ctx.accounts.arena_daily.key().as_ref(),
                source.player.as_ref(),
            ],
            &crate::ID,
        );
        require_keys_eq!(source_info.key(), expected_key, ErrorCode::InvalidOwner);
        require!(
            source.version == ACCOUNT_VERSION
                && source.challenge == ctx.accounts.arena_daily.key()
                && source.resolved(),
            ErrorCode::InvalidState
        );
        let entry = verify_submitted_board_entry(kind, submitted, &source)?;
        if let Some(prior) = previous {
            verify_next_board_entry(kind, &prior, &entry)?;
        }
        let position = ctx
            .accounts
            .arena_board
            .cursor
            .checked_add(u32::try_from(offset).map_err(|_| ErrorCode::ArithmeticOverflow)?)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        write_board_entry(&board_info, position, &entry)?;
        previous = Some(entry);
    }
    ctx.accounts.arena_board.cursor = next_cursor;
    if next_cursor == ctx.accounts.arena_board.payout_count {
        require!(
            board_info.data_len() == ArenaBoard::account_space(next_cursor)?,
            ErrorCode::BoardIncomplete
        );

        ctx.accounts.arena_board.sealed_at = Clock::get()?.unix_timestamp;
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(board: DailyBoardKind)]
pub struct ClaimDailyPrize<'info> {
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), board.seed()],
        bump = arena_board.bump,
        constraint = arena_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = arena_board.kind == board @ ErrorCode::InvalidOwner
    )]
    pub arena_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        mut,
        seeds = [PLAYER_STATE_SEED, owner_authority.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.schema_valid() @ ErrorCode::InvalidVersion,
        constraint = player_state.owner == owner_authority.key() @ ErrorCode::Unauthorized
    )]
    pub player_state: Box<Account<'info, PlayerState>>,
    /// CHECK: Durable wallet identity and the only reward destination.
    #[account(mut)]
    pub owner_authority: UncheckedAccount<'info>,
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub actor: Signer<'info>,
}

pub fn handler_claim_daily_prize(
    ctx: Context<ClaimDailyPrize>,
    board: DailyBoardKind,
    position: u32,
) -> Result<()> {
    require_player_authorization(
        ctx.accounts.owner_authority.key(),
        ctx.accounts.actor.key(),
        ctx.accounts.session_token.as_ref(),
    )?;
    let board_info = ctx.accounts.arena_board.to_account_info();
    // The program computed and stored the payout plan when it allocated this
    // board. Claims recheck the sealed board's structural and ledger binding;
    // the immutable plan is not rebuilt once per claim.
    validate_finalized_board_binding(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.arena_board,
        board_info.data_len(),
        board,
    )?;
    let now = Clock::get()?.unix_timestamp;
    let prize = arcade_prize_at_position(
        &ctx.accounts.arena_board,
        &board_info,
        ctx.accounts.owner_authority.key(),
        position,
    )?;
    if ctx.accounts.arena_daily.claims_expired
        || now > board_claim_deadline(ctx.accounts.arena_board.sealed_at)?
        || board_bitmap_is_set(&board_info, &ctx.accounts.arena_board, prize.position)?
    {
        return Ok(());
    }
    let source = ctx.accounts.arena_daily.to_account_info();
    let destination = ctx.accounts.owner_authority.to_account_info();
    validate_wallet(&destination, ctx.accounts.player_state.owner)?;
    require_spendable(&source, prize.amount)?;
    let claimed_lamports = ctx
        .accounts
        .arena_board
        .claimed_lamports
        .checked_add(prize.amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        claimed_lamports <= ctx.accounts.arena_board.paid_lamports,
        ErrorCode::AccountingInvariant
    );
    let points = zkube_core::ladder_points(
        ctx.accounts.arena_board.qualified_count,
        u32::from(prize.rank),
    )
    .map_err(|_| error!(ErrorCode::AccountingInvariant))?;
    ctx.accounts
        .player_state
        .daily_record_mut(board)
        .record_prize(prize.rank, prize.amount)?;
    ctx.accounts.player_state.record_ladder_points(points)?;
    move_program_lamports(&source, &destination, prize.amount)?;
    set_board_bitmap(&board_info, &ctx.accounts.arena_board, prize.position)?;
    ctx.accounts.arena_board.claimed_lamports = claimed_lamports;
    ctx.accounts.arena_board.claimed_count = ctx
        .accounts
        .arena_board
        .claimed_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireDailyClaims<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState,
        constraint = protocol.last_daily_id >= arena_daily.day_id @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()],
        bump = score_board.bump,
        constraint = score_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = score_board.kind == DailyBoardKind::Score @ ErrorCode::InvalidOwner
    )]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()],
        bump = theme_board.bump,
        constraint = theme_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = theme_board.kind == DailyBoardKind::Theme @ ErrorCode::InvalidOwner
    )]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()],
        bump = following_daily.bump,
        constraint = following_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = matches!(following_daily.status, PeriodStatus::Funding | PeriodStatus::Open) @ ErrorCode::InvalidState
    )]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    pub caller: Signer<'info>,
}

pub fn handler_expire_daily_claims(ctx: Context<ExpireDailyClaims>) -> Result<()> {
    require!(
        !ctx.accounts.arena_daily.claims_expired,
        ErrorCode::InvalidState
    );
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    validate_finalized_board_binding(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.score_board,
        score_info.data_len(),
        DailyBoardKind::Score,
    )?;
    validate_finalized_board_binding(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.theme_board,
        theme_info.data_len(),
        DailyBoardKind::Theme,
    )?;
    require!(
        ctx.accounts.score_board.sealed()
            && ctx.accounts.theme_board.sealed()
            && ctx.accounts.score_board.claimed_lamports <= ctx.accounts.score_board.paid_lamports
            && ctx.accounts.theme_board.claimed_lamports <= ctx.accounts.theme_board.paid_lamports,
        ErrorCode::BoardIncomplete
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now > daily_claim_deadline(&ctx.accounts.score_board, &ctx.accounts.theme_board,)?,
        ErrorCode::InvalidState
    );
    let current_day = day_id_at(now)?;
    require!(
        ctx.accounts.following_daily.day_id
            == next_scheduled_daily(&ctx.accounts.protocol, current_day)?,
        ErrorCode::InvalidPeriod
    );
    let claimed = ctx
        .accounts
        .score_board
        .claimed_lamports
        .checked_add(ctx.accounts.theme_board.claimed_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let expired = ctx
        .accounts
        .arena_daily
        .ledger
        .payout_lamports
        .checked_sub(claimed)
        .ok_or(ErrorCode::AccountingInvariant)?;
    require!(
        claimed.checked_add(expired).and_then(
            |value| value.checked_add(ctx.accounts.arena_daily.ledger.rollover_out_lamports)
        ) == Some(ctx.accounts.arena_daily.ledger.funded_lamports()?),
        ErrorCode::AccountingInvariant
    );
    let source = ctx.accounts.arena_daily.to_account_info();
    let successor = ctx.accounts.following_daily.to_account_info();
    require_spendable(&source, expired)?;
    move_program_lamports(&source, &successor, expired)?;
    ctx.accounts.following_daily.ledger.add_rollover(expired)?;
    ctx.accounts.arena_daily.claims_expired = true;
    Ok(())
}

#[derive(Accounts)]
pub struct ArchiveArenaDaily<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()],
        bump = score_board.bump,
        constraint = score_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = score_board.kind == DailyBoardKind::Score @ ErrorCode::InvalidOwner
    )]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()],
        bump = theme_board.bump,
        constraint = theme_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = theme_board.kind == DailyBoardKind::Theme @ ErrorCode::InvalidOwner
    )]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    pub caller: Signer<'info>,
}

pub fn handler_archive_arena_daily(ctx: Context<ArchiveArenaDaily>) -> Result<()> {
    require!(ctx.accounts.arena_daily.resolved(), ErrorCode::InvalidState);
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    validate_finalized_board_binding(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.score_board,
        score_info.data_len(),
        DailyBoardKind::Score,
    )?;
    validate_finalized_board_binding(
        &ctx.accounts.arena_daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.theme_board,
        theme_info.data_len(),
        DailyBoardKind::Theme,
    )?;
    let result_hash = daily_result_hash(
        &ctx.accounts.arena_daily,
        &ctx.accounts.score_board,
        &score_info,
        &ctx.accounts.theme_board,
        &theme_info,
    )?;
    ctx.accounts
        .protocol
        .append_daily(ctx.accounts.arena_daily.day_id, result_hash)?;
    Ok(())
}

#[derive(Accounts)]
pub struct CloseArenaDaily<'info> {
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion
    )]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        close = cadence_funding,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.status == PeriodStatus::Finalized @ ErrorCode::InvalidState,
        constraint = protocol.last_daily_id >= arena_daily.day_id @ ErrorCode::InvalidState
    )]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(
        mut,
        close = cadence_funding,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()],
        bump = score_board.bump,
        constraint = score_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = score_board.kind == DailyBoardKind::Score @ ErrorCode::InvalidOwner
    )]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(
        mut,
        close = cadence_funding,
        seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()],
        bump = theme_board.bump,
        constraint = theme_board.arena_daily == arena_daily.key() @ ErrorCode::InvalidOwner,
        constraint = theme_board.kind == DailyBoardKind::Theme @ ErrorCode::InvalidOwner
    )]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    /// CHECK: The only destination for cadence-account rent. It is a
    /// canonical System-owned zero-data PDA and exposes no withdrawal path.
    #[account(
        mut,
        seeds = [CADENCE_FUNDING_SEED],
        bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = cadence_funding.data_is_empty() @ ErrorCode::InvalidOwner
    )]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_arena_daily(ctx: Context<CloseArenaDaily>) -> Result<()> {
    let daily = &ctx.accounts.arena_daily;
    let score_info = ctx.accounts.score_board.to_account_info();
    let theme_info = ctx.accounts.theme_board.to_account_info();
    validate_finalized_board_binding(
        daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.score_board,
        score_info.data_len(),
        DailyBoardKind::Score,
    )?;
    validate_finalized_board_binding(
        daily,
        ctx.accounts.arena_daily.key(),
        &ctx.accounts.theme_board,
        theme_info.data_len(),
        DailyBoardKind::Theme,
    )?;
    require!(
        daily.resolved()
            && daily.claims_expired
            && Clock::get()?.unix_timestamp
                > daily_claim_deadline(&ctx.accounts.score_board, &ctx.accounts.theme_board,)?
            && ctx.accounts.score_board.sealed()
            && ctx.accounts.theme_board.sealed(),
        ErrorCode::InvalidState
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CloseArenaPlayer<'info> {
    /// CHECK: The exact parent address is required to be closed in the handler.
    pub arena_daily: UncheckedAccount<'info>,
    #[account(mut, close = rent_recipient,
        seeds = [ARENA_PLAYER_SEED, arena_player.challenge.as_ref(), arena_player.player.as_ref()], bump = arena_player.bump,
        constraint = arena_player.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_player.active_paid_run_id == 0 @ ErrorCode::ActiveRunExists,
        constraint = arena_player.resolved() @ ErrorCode::InvalidState)]
    pub arena_player: Box<Account<'info, ArenaPlayer>>,
    /// CHECK: Exact original payer persisted on the closing account.
    #[account(mut, address = arena_player.rent_payer @ ErrorCode::InvalidOwner)]
    pub rent_recipient: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

pub fn handler_close_arena_player(ctx: Context<CloseArenaPlayer>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.arena_daily.key(),
        ctx.accounts.arena_player.challenge,
        ErrorCode::InvalidOwner
    );
    let account = ctx.accounts.arena_daily.to_account_info();
    require!(
        *account.owner == system_program::ID && account.data_is_empty() && !account.executable,
        ErrorCode::InvalidState
    );
    Ok(())
}

/// Allocates only the Daily and payout-board PDAs selected by the two callers.
/// A prior System transfer to an unallocated PDA cannot prevent its creation.
fn create_cadence_account<'info>(
    funding: &AccountInfo<'info>,
    funding_bump: u8,
    account: &AccountInfo<'info>,
    account_seeds: &[&[u8]],
    space: usize,
    funded_space: usize,
    system: &AccountInfo<'info>,
) -> Result<()> {
    require!(
        *account.owner == system_program::ID && account.data_is_empty() && !account.executable,
        ErrorCode::InvalidOwner
    );
    let rent = Rent::get()?.minimum_balance(funded_space);
    let funding_bump = [funding_bump];
    let funding_seeds: &[&[u8]] = &[CADENCE_FUNDING_SEED, &funding_bump];
    let space = u64::try_from(space).map_err(|_| ErrorCode::ArithmeticOverflow)?;
    if account.lamports() == 0 {
        invoke_signed(
            &system_instruction::create_account(funding.key, account.key, rent, space, &crate::ID),
            &[funding.clone(), account.clone(), system.clone()],
            &[funding_seeds, account_seeds],
        )?;
    } else {
        let shortfall = rent.saturating_sub(account.lamports());
        if shortfall > 0 {
            invoke_signed(
                &system_instruction::transfer(funding.key, account.key, shortfall),
                &[funding.clone(), account.clone(), system.clone()],
                &[funding_seeds],
            )?;
        }
        invoke_signed(
            &system_instruction::allocate(account.key, space),
            &[account.clone(), system.clone()],
            &[account_seeds],
        )?;
        invoke_signed(
            &system_instruction::assign(account.key, &crate::ID),
            &[account.clone(), system.clone()],
            &[account_seeds],
        )?;
    }
    Ok(())
}

fn transfer_from_signer<'info>(
    signer: &Signer<'info>,
    destination: &AccountInfo<'info>,
    system: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    invoke(
        &system_instruction::transfer(&signer.key(), destination.key, amount),
        &[
            signer.to_account_info(),
            destination.clone(),
            system.to_account_info(),
        ],
    )?;
    Ok(())
}

fn move_program_lamports(
    source: &AccountInfo<'_>,
    destination: &AccountInfo<'_>,
    amount: u64,
) -> Result<()> {
    require!(
        source.is_writable && destination.is_writable,
        ErrorCode::InvalidState
    );
    let source_balance = source.lamports();
    require!(source_balance >= amount, ErrorCode::InsufficientFunds);
    **source.try_borrow_mut_lamports()? = source_balance
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    **destination.try_borrow_mut_lamports()? = destination
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    Ok(())
}

fn require_spendable(account: &AccountInfo<'_>, amount: u64) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(account.data_len());
    require!(
        account.lamports().saturating_sub(rent) >= amount,
        ErrorCode::InsufficientFunds
    );
    Ok(())
}

fn validate_wallet(account: &AccountInfo<'_>, expected: Pubkey) -> Result<()> {
    require_keys_eq!(account.key(), expected, ErrorCode::InvalidOwner);
    require!(
        account.is_writable && *account.owner == system_program::ID && account.data_is_empty(),
        ErrorCode::InvalidOwner
    );
    Ok(())
}

fn prepare_period_is_allowed(
    requested: u32,
    current: u32,
    launch: u32,
    suspended_until_day: u32,
) -> bool {
    if requested < suspended_until_day {
        return false;
    }
    let first = current.max(suspended_until_day);
    let Some(following) = first.checked_add(1) else {
        return false;
    };
    let in_live_window = requested <= current || requested == first || requested == following;
    if launch > 0 {
        requested >= launch && in_live_window
    } else {
        requested == first || requested == following
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launched_period_preparation_can_rebuild_only_bounded_history() {
        assert!(prepare_period_is_allowed(100, 104, 100, 0));
        assert!(prepare_period_is_allowed(104, 104, 100, 0));
        assert!(prepare_period_is_allowed(105, 104, 100, 0));
        assert!(!prepare_period_is_allowed(99, 104, 100, 0));
        assert!(!prepare_period_is_allowed(106, 104, 100, 0));
        assert!(!prepare_period_is_allowed(105, 104, 100, 106));
    }

    #[test]
    fn prelaunch_preparation_remains_current_or_successor_only() {
        assert!(prepare_period_is_allowed(104, 104, 0, 0));
        assert!(prepare_period_is_allowed(105, 104, 0, 0));
        assert!(!prepare_period_is_allowed(103, 104, 0, 0));
        assert!(!prepare_period_is_allowed(106, 104, 0, 0));
    }

    #[test]
    fn campaign_and_daily_share_guardian_rules() {
        for realm in zkube_core::REALM_RULES {
            let daily = RealmRuleSnapshot::from_core(realm);
            assert_eq!(daily.guardian.to_core().unwrap(), realm.guardian);
            assert_eq!(daily.starting_rows, realm.starting_height);
        }
    }
}
