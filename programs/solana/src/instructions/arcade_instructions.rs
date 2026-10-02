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
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,

    /// CHECK: Canonical Daily PDA allocated and serialized by this instruction.
    #[account(mut, seeds = [ARENA_DAILY_SEED, day_id.to_le_bytes().as_ref()], bump)]
    pub arena_daily: UncheckedAccount<'info>,
    /// CHECK: The Daily's Score board, allocated as an empty header below.
    #[account(mut, seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()], bump)]
    pub score_board: UncheckedAccount<'info>,
    /// CHECK: The Daily's Theme board, allocated as an empty header below.
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

pub fn handler_prepare_arena_daily(ctx: Context<PrepareArenaDaily>, day_id: u32) -> Result<()> {
    let daily_info = ctx.accounts.arena_daily.to_account_info();
    // A Daily that already exists is left exactly as it is: whoever prepares
    // it second, in the same block or a later one, succeeds and changes
    // nothing. The seeds above still tie all three accounts to `day_id`.
    if *daily_info.owner == crate::ID {
        let existing = ArenaDaily::try_deserialize(&mut &daily_info.try_borrow_data()?[..])?;
        require!(
            existing.version == ACCOUNT_VERSION
                && existing.day_id == day_id
                && *ctx.accounts.score_board.owner == crate::ID
                && *ctx.accounts.theme_board.owner == crate::ID,
            ErrorCode::InvalidOwner
        );
        return Ok(());
    }
    // Only today's Daily can be prepared, suspended or not: no account ever
    // exists for a later day, so nothing commits the future.
    require!(
        day_id == day_id_at(Clock::get()?.unix_timestamp)?,
        ErrorCode::InvalidPeriod
    );
    // Before launch the authority alone prepares, in its launch transaction:
    // nobody else can spend cadence rent on a Daily that may never be seeded.
    require!(
        ctx.accounts.protocol.launch_day_id != 0
            || ctx.accounts.caller.key() == ctx.accounts.protocol.authority,
        ErrorCode::Unauthorized
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
        predecessor_day: ctx.accounts.protocol.record_prepared_daily(day_id)?,
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
        bump: ctx.bumps.arena_daily,
    };
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
    // Both boards exist from preparation: consuming a run is their only writer.
    for (info, kind, bump) in [
        (
            ctx.accounts.score_board.to_account_info(),
            DailyBoardKind::Score,
            ctx.bumps.score_board,
        ),
        (
            ctx.accounts.theme_board.to_account_info(),
            DailyBoardKind::Theme,
            ctx.bumps.theme_board,
        ),
    ] {
        create_cadence_account(
            &ctx.accounts.cadence_funding.to_account_info(),
            ctx.bumps.cadence_funding,
            &info,
            &[
                ARENA_BOARD_SEED,
                daily_info.key.as_ref(),
                kind.seed(),
                &[bump],
            ],
            ArenaBoard::HEADER_SIZE,
            ArenaBoard::HEADER_SIZE,
            &ctx.accounts.system_program.to_account_info(),
        )?;
        ArenaBoard {
            version: ACCOUNT_VERSION,
            arena_daily: daily_info.key(),
            day_id,
            kind,
            bump,
            ..ArenaBoard::default()
        }
        .try_serialize(&mut &mut info.try_borrow_mut_data()?[..])?;
    }
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
    // The pot a deposit joins is always the day's own: today's Daily, before
    // it finalizes. The first deposit launches the protocol on it.
    require!(
        ctx.accounts.arena_daily.day_id == current
            && !ctx.accounts.arena_daily.finalized()
            && now < day_window(current)?.1,
        ErrorCode::InvalidPeriod
    );
    if launches {
        require!(ctx.accounts.protocol.paused, ErrorCode::InvalidState);
        require!(
            ctx.accounts.arena_daily.ledger.funded_lamports()? == 0
                && !ctx.accounts.arena_daily.predecessor_rollover_applied,
            ErrorCode::InvalidState
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
    #[account(mut, seeds = [ARENA_BOARD_SEED, current_daily.key().as_ref(), DailyBoardKind::Score.seed()], bump = score_board.bump,
        constraint = score_board.bound_to(current_daily.key(), DailyBoardKind::Score) @ ErrorCode::InvalidOwner)]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(mut, seeds = [ARENA_BOARD_SEED, current_daily.key().as_ref(), DailyBoardKind::Theme.seed()], bump = theme_board.bump,
        constraint = theme_board.bound_to(current_daily.key(), DailyBoardKind::Theme) @ ErrorCode::InvalidOwner)]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    /// CHECK: Canonical System-owned zero-data payer; pays each entrant's board rows.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = cadence_funding.data_is_empty() && !cadence_funding.executable @ ErrorCode::InvalidOwner)]
    pub cadence_funding: UncheckedAccount<'info>,
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
        ctx.accounts.current_daily.day_id == day_id,
        ErrorCode::InvalidPeriod
    );
    require!(
        zkube_core::daily_is_scheduled(day_id, ctx.accounts.protocol.suspended_until_day),
        ErrorCode::DailyNotScheduled
    );
    // A Daily is open when the clock is inside its window. Nothing opens it,
    // and nothing can enter one that has finalized.
    require!(
        now >= day_window(day_id)?.0
            && now < day_window(day_id)?.1
            && !ctx.accounts.current_daily.finalized(),
        ErrorCode::InvalidPeriod
    );
    // A run the player never settled stops being able to score at its
    // recovery deadline. Their next entry retires it: no one has to expire it.
    let stale = ctx.accounts.player_state.active_run_id;
    if stale != 0 {
        require!(
            now >= ctx
                .accounts
                .player_state
                .active_run_deadline_at
                .checked_add(STUCK_RUN_RECOVERY_SECONDS)
                .ok_or(ErrorCode::ArithmeticOverflow)?,
            ErrorCode::ActiveRunExists
        );
        ctx.accounts.player_state.expire_arcade_run(stale)?;
    }
    if ctx.accounts.arena_player.version == 0 {
        ctx.accounts.arena_player.set_inner(ArenaPlayer::initialize(
            ctx.accounts.current_daily.key(),
            ctx.accounts.owner_authority.key(),
            ctx.accounts.payer.key(),
            ctx.bumps.arena_player,
        ));
        // The core sizes a board exactly for this many players and no more,
        // so a full Daily refuses a new player before any Kredit is spent.
        require!(
            ctx.accounts.current_daily.unique_players < ARENA_DAILY_PLAYER_CAPACITY,
            ErrorCode::DailyFull
        );
        ctx.accounts.current_daily.unique_players = ctx
            .accounts
            .current_daily
            .unique_players
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        // A board row needs rent before the run that earns it is consumed.
        // Paying it here means an entry the boards cannot hold rejects before
        // its Kredit is spent, and consume never needs a payer.
        let funded = Rent::get()?.minimum_balance(ArenaBoard::funded_space(
            ctx.accounts.current_daily.unique_players,
        ));
        for board in [
            ctx.accounts.score_board.to_account_info(),
            ctx.accounts.theme_board.to_account_info(),
        ] {
            let shortfall = funded.saturating_sub(board.lamports());
            if shortfall > 0 {
                invoke_signed(
                    &system_instruction::transfer(
                        ctx.accounts.cadence_funding.key,
                        board.key,
                        shortfall,
                    ),
                    &[
                        ctx.accounts.cadence_funding.to_account_info(),
                        board,
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    &[&[CADENCE_FUNDING_SEED, &[ctx.bumps.cadence_funding]]],
                )?;
            }
        }
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
    // The prize share waits in today's Daily, outside today's pot, and moves
    // to the next Daily when this one finalizes.
    move_program_lamports(
        &ctx.accounts.credit_vault.to_account_info(),
        &ctx.accounts.current_daily.to_account_info(),
        split.next_daily_lamports,
    )?;
    ctx.accounts
        .credit_vault
        .record_spend(split.next_daily_lamports)?;
    ctx.accounts
        .current_daily
        .ledger
        .add_next_pot(split.next_daily_lamports)?;
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
    #[account(mut, seeds = [ARENA_BOARD_SEED, active_run.daily_challenge.as_ref(), DailyBoardKind::Score.seed()], bump = score_board.bump,
        constraint = score_board.bound_to(active_run.daily_challenge, DailyBoardKind::Score) @ ErrorCode::InvalidOwner)]
    pub score_board: Option<Box<Account<'info, ArenaBoard>>>,
    #[account(mut, seeds = [ARENA_BOARD_SEED, active_run.daily_challenge.as_ref(), DailyBoardKind::Theme.seed()], bump = theme_board.bump,
        constraint = theme_board.bound_to(active_run.daily_challenge, DailyBoardKind::Theme) @ ErrorCode::InvalidOwner)]
    pub theme_board: Option<Box<Account<'info, ArenaBoard>>>,
}

pub fn handler_consume_arena_run(ctx: Context<ConsumeArenaRun>) -> Result<()> {
    let active = &ctx.accounts.active_run;
    if ctx.accounts.player_state.orphan_run_id == active.run_id {
        return ctx.accounts.player_state.release_orphan(active.run_id);
    }
    // Past its recovery deadline a run can no longer score, and its Daily
    // counts it expired when it finalizes. Consuming it then only frees the
    // player's slot and returns the run's rent, once: the account closes.
    if Clock::get()?.unix_timestamp
        >= active
            .deadline_at
            .checked_add(STUCK_RUN_RECOVERY_SECONDS)
            .ok_or(ErrorCode::ArithmeticOverflow)?
    {
        require!(
            ctx.accounts.player_state.arcade_reservation_matches(
                active.run_id,
                active.daily_challenge,
                active.deadline_at,
            ),
            ErrorCode::InvalidRunId
        );
        return ctx.accounts.player_state.release_arcade_run(active.run_id);
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
        require!(!daily.finalized(), ErrorCode::InvalidState);
        let changes =
            daily.record_scored_entry(player, &mut ctx.accounts.player_state, candidate)?;
        emit!(RunScored {
            day_id: daily.day_id,
            run_id: active.run_id,
            row: candidate,
        });
        for (change, kind, board) in [
            (changes[0], DailyBoardKind::Score, &ctx.accounts.score_board),
            (changes[1], DailyBoardKind::Theme, &ctx.accounts.theme_board),
        ] {
            let previous = match change {
                BestRow::Kept => continue,
                BestRow::First => None,
                BestRow::Improved(previous) => Some(previous),
            };
            let board = board.as_ref().ok_or(ErrorCode::InvalidState)?;
            retain_board_row(
                &board.to_account_info(),
                kind,
                previous.as_ref(),
                &candidate,
            )?;
        }
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
pub struct FinalizeArenaDaily<'info> {
    #[account(mut, seeds = [PROTOCOL_CONFIG_SEED], bump = protocol.bump,
        constraint = protocol.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub protocol: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()], bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
    pub arena_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_DAILY_SEED, following_daily.day_id.to_le_bytes().as_ref()], bump = following_daily.bump)]
    pub following_daily: Box<Account<'info, ArenaDaily>>,
    #[account(mut, seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Score.seed()], bump = score_board.bump,
        constraint = score_board.bound_to(arena_daily.key(), DailyBoardKind::Score) @ ErrorCode::InvalidOwner)]
    pub score_board: Box<Account<'info, ArenaBoard>>,
    #[account(mut, seeds = [ARENA_BOARD_SEED, arena_daily.key().as_ref(), DailyBoardKind::Theme.seed()], bump = theme_board.bump,
        constraint = theme_board.bound_to(arena_daily.key(), DailyBoardKind::Theme) @ ErrorCode::InvalidOwner)]
    pub theme_board: Box<Account<'info, ArenaBoard>>,
    /// CHECK: Canonical System-owned zero-data PDA; receives the rent the
    /// finalized boards no longer need.
    #[account(mut, seeds = [CADENCE_FUNDING_SEED], bump,
        owner = system_program::ID @ ErrorCode::InvalidOwner,
        constraint = cadence_funding.data_is_empty() && !cadence_funding.executable @ ErrorCode::InvalidOwner)]
    pub cadence_funding: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

/// Finalizes a Daily by the clock alone. Anyone may send it: a winner's claim
/// or the next day's first entry carries it, and a Daily already finalized is
/// left as it is.
pub fn handler_finalize_arena_daily(ctx: Context<FinalizeArenaDaily>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts
        .arena_daily
        .require_funding_successor(&ctx.accounts.following_daily)?;
    if ctx.accounts.arena_daily.finalized() {
        return Ok(());
    }
    let (_, closes_at, recovery_ends_at) = day_window(ctx.accounts.arena_daily.day_id)?;
    // Until the recovery deadline a run in flight can still score, so the
    // day waits for it. After it nothing can, and the day never waits on
    // anyone resolving an abandoned run.
    require!(
        ctx.accounts.arena_daily.predecessor_rollover_applied
            && now >= closes_at
            && (ctx.accounts.arena_daily.resolved() || now >= recovery_ends_at),
        ErrorCode::InvalidPeriod
    );
    require!(
        !ctx.accounts.following_daily.predecessor_rollover_applied
            && !ctx.accounts.following_daily.finalized(),
        ErrorCode::InvalidState
    );
    let source_info = ctx.accounts.arena_daily.to_account_info();
    let successor_info = ctx.accounts.following_daily.to_account_info();
    let source = &mut ctx.accounts.arena_daily;
    let settlement = source.settle_into(&mut ctx.accounts.following_daily, now)?;
    require_spendable(&source_info, settlement.held_lamports)?;
    move_program_lamports(&source_info, &successor_info, settlement.forwarded_lamports)?;
    let pools = settlement.pools;
    let (score_plan, theme_plan) = (settlement.score, settlement.theme);
    // The boards are already complete: every scored run was placed when it
    // was consumed. Keep the paying rows, add their claim bits, and return
    // the rent of everything else to cadence funding.
    let cadence = ctx.accounts.cadence_funding.to_account_info();
    for (board, qualified, pool, plan) in [
        (
            &mut ctx.accounts.score_board,
            source.score_qualified_players,
            pools.score,
            score_plan,
        ),
        (
            &mut ctx.accounts.theme_board,
            source.theme_qualified_players,
            pools.theme,
            theme_plan,
        ),
    ] {
        let info = board.to_account_info();
        let retained = ArenaBoard::open_rows(info.data_len())?;
        require!(
            u32::try_from(retained).is_ok_and(|rows| rows
                == qualified.min(u32::try_from(ARENA_BOARD_CAPACITY).unwrap_or(u32::MAX)))
                && plan.count <= qualified,
            ErrorCode::AccountingInvariant
        );
        seal_arena_board(board, qualified, pool, plan);
        let rows_end = ArenaBoard::open_space(
            usize::try_from(plan.count).map_err(|_| ErrorCode::ArithmeticOverflow)?,
        )?;
        let space = ArenaBoard::account_space(plan.count)?;
        info.resize(space)?;
        info.try_borrow_mut_data()?[rows_end..].fill(0);
        let rent = Rent::get()?.minimum_balance(space);
        let excess = info
            .lamports()
            .checked_sub(rent)
            .ok_or(ErrorCode::AccountingInvariant)?;
        move_program_lamports(&info, &cadence, excess)?;
    }
    // Dailies finalize in the order of their chain, which is the order of the
    // result root: the day joins it here, with nothing left to archive.
    let result_hash = daily_result_hash(
        source,
        &ctx.accounts.score_board,
        &ctx.accounts.score_board.to_account_info(),
        &ctx.accounts.theme_board,
        &ctx.accounts.theme_board.to_account_info(),
    )?;
    ctx.accounts
        .protocol
        .append_daily(source.day_id, source.predecessor_day, result_hash)
}

#[derive(Accounts)]
#[instruction(board: DailyBoardKind)]
pub struct ClaimDailyPrize<'info> {
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, arena_daily.day_id.to_le_bytes().as_ref()],
        bump = arena_daily.bump,
        constraint = arena_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = arena_daily.finalized() @ ErrorCode::InvalidState
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
    if now > daily_claim_deadline(&ctx.accounts.arena_daily)?
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
        constraint = arena_daily.finalized()
            || arena_daily.never_launched(protocol.launch_day_id) @ ErrorCode::InvalidState
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
    /// The newest prepared Daily, which receives what was never claimed.
    /// Needed only when something is left to move.
    #[account(
        mut,
        seeds = [ARENA_DAILY_SEED, newest_daily.day_id.to_le_bytes().as_ref()],
        bump = newest_daily.bump,
        constraint = newest_daily.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion,
        constraint = newest_daily.day_id == protocol.last_prepared_day @ ErrorCode::InvalidPeriod,
        constraint = !newest_daily.finalized() @ ErrorCode::InvalidState
    )]
    pub newest_daily: Option<Box<Account<'info, ArenaDaily>>>,
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

/// Closes a finalized Daily and its boards once its claim window has passed,
/// or at once when it paid nothing. What was never claimed moves into the
/// newest prepared Daily's pot; only rent returns to cadence funding. A Daily
/// prepared for a day before the launch never joined the chain: it holds
/// nothing but rent and closes at once.
pub fn handler_close_arena_daily(ctx: Context<CloseArenaDaily>) -> Result<()> {
    let daily = &ctx.accounts.arena_daily;
    if !daily.finalized() {
        return Ok(());
    }
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
        daily.ledger.payout_lamports == 0
            || Clock::get()?.unix_timestamp > daily_claim_deadline(daily)?,
        ErrorCode::InvalidState
    );
    let claimed = ctx
        .accounts
        .score_board
        .claimed_lamports
        .checked_add(ctx.accounts.theme_board.claimed_lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let unclaimed = daily
        .ledger
        .payout_lamports
        .checked_sub(claimed)
        .ok_or(ErrorCode::AccountingInvariant)?;
    if unclaimed > 0 {
        let source = ctx.accounts.arena_daily.to_account_info();
        let newest = ctx
            .accounts
            .newest_daily
            .as_mut()
            .ok_or(ErrorCode::InvalidState)?;
        require_keys_neq!(newest.key(), source.key(), ErrorCode::InvalidState);
        require_spendable(&source, unclaimed)?;
        move_program_lamports(&source, &newest.to_account_info(), unclaimed)?;
        newest.ledger.add_rollover(unclaimed)?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CloseArenaPlayer<'info> {
    /// CHECK: The exact parent address, finalized or already closed; read in
    /// the handler.
    pub arena_daily: UncheckedAccount<'info>,
    #[account(mut, close = rent_recipient,
        seeds = [ARENA_PLAYER_SEED, arena_player.challenge.as_ref(), arena_player.player.as_ref()], bump = arena_player.bump,
        constraint = arena_player.version == ACCOUNT_VERSION @ ErrorCode::InvalidVersion)]
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
    // Boards are complete at finalization and never read this account
    // again, and no entry or consume can touch a finalized Daily, so nothing
    // can bring the account back or repeat its qualifying credit. A run of
    // its player still unresolved then was counted expired by the clock.
    let account = ctx.accounts.arena_daily.to_account_info();
    let closed =
        *account.owner == system_program::ID && account.data_is_empty() && !account.executable;
    let finalized = *account.owner == crate::ID
        && ArenaDaily::try_deserialize(&mut &account.try_borrow_data()?[..])
            .is_ok_and(|daily| daily.finalized());
    require!(closed || finalized, ErrorCode::InvalidState);
    Ok(())
}

/// Allocates only the Daily and its two board PDAs at preparation.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn campaign_and_daily_share_guardian_rules() {
        for realm in zkube_core::REALM_RULES {
            let daily = RealmRuleSnapshot::from_core(realm);
            assert_eq!(daily.guardian.to_core().unwrap(), realm.guardian);
            assert_eq!(daily.starting_rows, realm.starting_height);
        }
    }
}
