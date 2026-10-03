# Repository working rules

README.md is the public product and contributor document. Working rules, the protocol reference and operator
procedures live here. Implementation detail belongs beside the code. No new Markdown documents; no operator
runbooks or approval policy in README.md.

## Working rules

- Read README.md first. Inspect program state and instructions for contract work, services for keeper work,
  and Unity only when client work is in scope. Source is not deployed state.
- Preserve unrelated and in-flight work. Use focused patches and fast text searches; no destructive
  restoration or blanket cleanup. The reference repositories at /home/djizus/zkube and
  /home/djizus/cycling-sim are read-only.
- All verification is offline. Prefix Solana, Anchor and chain commands with NO_DNA=1. No signer bytes, seed
  phrases, environment contents, keeper secrets, Android credentials or ignored program keypairs in output
  or commits.
- The read-only Devnet deployment fee payer is /home/djizus/cycling-sim/.devnet/deployer.json, public
  address 7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA. Do not access, copy, modify, expose, delete or
  commit that file during routine work.
- Signing or sending needs exact approval for instructions, accounts, signers, cluster and spend. A short
  approval applies only to the immediately preceding enumerated bundle with no drift. Governance, seeding,
  reimbursement, funding, deployment, initial keeper enablement and mainnet remain outside recurring
  authority. `operator_missing_fingerprint_loads_no_keypair` and
  `operator_rebuild_rejects_changed_instruction_bytes_before_loading_a_signer` guard the CLI.
- No recurring keeper authority exists. A release needs its own approved fingerprint, Devnet binding, signer
  and spend/write ceilings. `keeps writes fail-closed unless explicitly enabled` and
  `keeper_pass_reserves_write_slots_and_simulates_before_every_send` guard the boundary.
- Python tools report expected failures with their result/log path through unity/tools/cli.py. Unity Editor
  invocations, including one-off methods, go through unity/tools/build.py. Hold its lease throughout an
  operation and wait for an existing holder. Read the fresh completion result and log before interpreting an
  exit; verified completion followed by a teardown crash is success with a noisy exit.
  `test_both_test_platforms_share_one_preparation_and_lease` guards the shared test preparation and lease.
- Regenerate fixtures through unity/tools/build.py fixtures --fixture-action generate. Its native and
  program producers run in order, without concurrent writers.
- Start delegated work in named Herdr agent panes beside the caller, never as hidden background jobs, so
  the owner can watch and steer it; Development environment lists the commands. Outside Herdr, say so and ask.
- Reuse existing tool servers; stop a wedged process before replacing it and report its PID and reason.
  Report duplicate configuration. Request a region instead of parsing a huge page.
- Large scratch work belongs in ignored build/, not the RAM-backed temporary directory. Remove scratch when
  its step finishes; explain retained evidence and active work.
- Core version stays 1.0.0 until deployment or a real compatibility boundary requires a change. The program,
  keeper and client move together. Account versions and release schemas remain truthful;
  `fresh_bootstrap_interface_is_locked` and the codegen check guard the surface.
- Android work runs here; iOS work does not. Production candidates require explicit version codes and
  non-debug signing, guarded by `test_production_packages_require_explicit_version_and_non_debug_signing`
  and `test_production_without_version_fails_before_toolchain_work`. Prerequisites are checked first by
  `test_toolchain_checks_android_targets_and_bundletool_first`. The owner signs through ZKUBE_ANDROID_KEYSTORE,
  ZKUBE_ANDROID_KEYSTORE_PASS, ZKUBE_ANDROID_KEY_ALIAS and ZKUBE_ANDROID_KEY_PASS, applied in memory for that
  build only and never saved or echoed;
  `test_production_without_signing_fails_before_toolchain_work_naming_only_the_variable` and
  `SigningIsAppliedInMemoryForOneBuildAndNeverSavedOrEchoed` guard them. The store build runs on the x86_64
  emulator; the arm64-only money APK needs a physical device.

### Validation and defect classes

Run the checks for the areas a change touches before committing it. A red check outranks the work that
exposed it. Fix the recurring source of a defect in the same change, with the smallest mechanism that closes
that class:

- **Untested bounds:** every program capacity has allocation and compute coverage at its maximum;
  `every_program_capacity_has_an_sbf_test_at_its_maximum` inventories both guards.
- **Divergent mirrors:** one rule has one owner. Documents point to scripts and constants. Necessary
  cross-layer pairs have agreement tests, including `keeper_allowlist_is_exactly_its_plans`,
  `program_and_core_score_one_action_identically` and the codegen drift check.
- **Superseded vocabulary:** remove the dead model's code, copy and comments, and add its player-facing and
  documentation phrases to services/tests/supersession.test.ts. Adding a reversal retires the oldest entry;
  `keeps the reversal list bounded so a new rule retires the oldest` and `keeps reversed models out of
  authored source` guard that list.
- **Derivable arguments:** compute a value in its owner rather than trusting a duplicate argument; retained
  duplicates require an equality constraint and its rejection test.
- **Unanchored specification:** each normative rule names its enforcing test or constraint.
  `every_backticked_spec_identifier_resolves_in_the_tree` guards reference integrity.
- **Trajectory-shaped invariants:** test the rule, including future resets or expiry, rather than today's
  data shape; `the_visible_streak_does_not_change_ladder_awards` is one example.
- **Locked systems:** cutting or reshaping a locked system needs explicit owner approval and a specification
  amendment in the same change. Balance changes stay inside those rules.

## Development environment

| Tool | What it is for and how it is used here |
| --- | --- |
| Herdr | Terminal workspace for agents. Split a pane beside the caller with herdr pane split --current --direction right --no-focus, start a named agent with herdr agent start <name> --pane <id>, then send work with herdr agent prompt and follow it with herdr agent wait. |
| Solana documentation MCP | https://mcp.solana.com/mcp: current Solana, Anchor and MagicBlock documentation for program and client chain work. |
| Miniflare | Runs the built Worker and a real D1 database in the Workers runtime, offline, inside the pnpm tests. No wrangler command runs in routine work. |
| Playwright MCP | A headless browser (Brave, driven as Chromium) for browser checks. |
| Unity MCP relay | ~/.unity/relay/relay_linux --mcp, configured but disabled. Enable it only for work that drives a live Editor; builds, tests and imports still run through unity/tools/build.py. |
| Blender MCP | ~/.local/bin/blender-mcp, for art tooling when an art task needs Blender. |
| Skills | Shared skills live in ~/.agents/skills and are linked into each assistant's skill directory: herdr for pane control and solana-dev for program and client chain work. The plain-writing skill, stop-slop, is installed per assistant and applies to every player-facing string and document. |
| Unity | The editor pinned in unity/toolchain.json, under ~/Unity/Hub/Editor/<version>, installed through Unity Hub with Android Build Support. unity/tools/build.py is the only entry point. |
| Android emulator | The SDK emulator bundled with the pinned editor (Editor/Data/PlaybackEngines/AndroidPlayer/SDK/emulator) and AVD zkube_offline_api30 (API 30, google_apis, x86_64). Launch it windowed with emulator -avd zkube_offline_api30 -gpu host -accel on -port 5584; headless mode crashes. It runs the store build only, since the arm64 money APK needs a physical device. |
| Art environment | build/art/.venv (Pillow, fontTools) runs the art scripts; ffmpeg trims and converts captures. |

The emulator is shared. Coordinate before taking it and restore it afterwards:

- Seeker geometry is adb shell wm size 1200x2670 and wm density 460; wm size reset and wm density reset
  restore it.
- Uninstall the package before installing a new local build, since each build carries a new debug signature.
- Put back the clock (settings put global auto_time 1) and unroot adbd if you changed either.

## Deployment status

There is no live deployment. The abandoned Devnet release, its accounts, pools, keeper authority and launch
bundles supply no current authority. Fresh bootstrap requires exact approval; no migration exists. Mainnet
remains subject to counsel, economics and distribution review. Specification approval is not deployment or
spending approval.

| Area | Source status and guard |
| --- | --- |
| Core | One deterministic Rust engine at 1.0.0; `one_run_drives_campaign_and_daily` |
| Interface | 24 instructions, 7 account types; `fresh_bootstrap_interface_is_locked` |
| Accounts | Generated versions and bounded layouts; `target_accounts_fit_normal_solana_account_limits` |
| Campaign | Local play and synchronized reported stars; `record_campaign_stars_is_idempotent_and_touches_no_other_field` |
| Arcade | Prepaid entries and Score/Theme boards; `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` |
| Settlement | Boards sorted as runs are consumed, sealed at finalization, idempotent claims; `no_caller_can_choose_board_rows` |
| Keeper | A backstop of seven permissionless plan instructions, run every ten minutes from the Worker's Cron Trigger, writes disabled pending approval; `keeper_allowlist_is_exactly_its_plans` |
| Read model | Full standings and discovery hints in the same Worker, never an authority; `indexer_ranks_agree_with_the_core_board_order` |

## Product truth and locked rules

- **Two products, one client:** com.zkorp.zkube is zKube: Arena for the Solana dApp Store and Seeker;
  com.zkorp.zkube.store is zKube: Realms for Google Play. Unity and the Rust FFI are shared; store packages
  exclude money/chain assemblies and wallet plugins. `test_profiles_preserve_money_and_add_two_abi_store`,
  `test_both_package_manifests_use_the_identity_contract` and
  `test_metadata_rejects_every_money_assembly_and_tests` guard the identity contract.
- **Identity:** a connected Solana address identifies an Arena player, without embedded wallets or recovery
  codes. Its profile shows the address's Seeker ID (its .skr name) when one resolves, else the shortened
  address, and a verified-Seeker badge when the wallet holds a Seeker Genesis Token: cached display reads from
  mainnet that never gate play, carry no perk and that no Kredit, entry, prize or ladder rule reads. Realms shows
  the platform player account, Google Play Games on Android behind one interface for other platforms, with no
  name to edit; signed out or refused, the profile shows the emblem alone and everything stays playable.
  `money_campaign_needs_an_address_and_no_session`, `StoreShowsThePlayerAccountAndPlaysWithoutIt`,
  `SeekerIdsResolveFromTheirSkrRecordsOncePerAddress`, `AVerifiedSeekerHoldsAGenesisTokenWithABalance`,
  `SeekerLookupsNeverThrowAndShowNothingWhenTheyCannotResolve` and
  `TheProfileShowsTheSeekerIdAndBadgeWithoutWaitingForThem` guard immediate Campaign play, the account and the
  lookups.
- **Realms leaderboard:** signed in, each finished Daily's score goes to one platform leaderboard (Play Games on
  Android) and a Leaderboard button on the Daily card and the Daily result opens the platform's own screen; it is
  behind the platform-account interface. Signed out there is no button and no submission, and nothing else
  changes. `AFinishedDailyGoesToThePlatformLeaderboardOnlyWhenSignedIn` and
  `ASignedOutDailySubmitsNothingAndShowsNoLeaderboard` guard both.
- **Campaign is free and optional on Arena:** one shared local client plays it in both products. Realms
  alone overlays the realm purchase policy and adds a local Daily on the same day as Arena's.
  `store_gate_is_a_store_identity_policy_over_shared_progression`,
  `money_identity_cannot_start_a_local_daily` and
  `test_money_metadata_excludes_the_local_daily_and_store_policy` guard the split.
- **Campaign save:** the packed on-chain star array is the player's save, written by their own device and
  synchronized across devices. The program does not verify it, it has no effect on money, and emblems 1–12
  reflect that reported progress. `record_campaign_stars_is_idempotent_and_touches_no_other_field` and
  `sbf_featured_emblem_accepts_owner_and_only_unlocked_campaign_badges` guard the write and display gate.
- **One Daily:** every Arcade Daily is a realm plus an objective from the fixed protocol product, without
  authored dates or content accounts. A seeded without-replacement draw uses absolute day IDs; neither
  operator nor VRF chooses a pair. `daily_draw_is_reproducible_from_seed_and_day` guards independent
  recomputation.
- **Cadence:** play and payout never wait for a keeper. A Daily exists only for a day somebody entered, plus
  the launch day: the day's first transaction prepares it, and a repeat is a no-op. Only today's Daily can be
  prepared, suspended or not, so no account ever exists for a later day. A Daily has no status: the clock opens
  and closes its window, and it is finalized once it records when. Anyone finalizes it once its window has
  closed and every entry is resolved, or six hours later whatever is unresolved, which then counts as expired.
  `prepare_makes_only_todays_daily_once_and_a_repeat_is_a_checked_no_op`,
  `a_quiet_week_resolves_from_the_first_transaction_whoever_sends_it`,
  `a_day_with_an_abandoned_run_finalizes_on_the_first_claim_after_the_recovery_window` and
  `empty_dailies_are_bounded_finalize_empty_and_close_at_once` guard the program.
- **Carried cadence:** an entry is offered with today's preparation and up to two due finalizations, then with
  fewer, then without its optional claims, every distinct size once; each is priced and simulated once at the
  limit it states, and the client sends the first that fits one packet, that its payer can fund and that
  passes. Only the entry alone can fail the entry. Simulation cannot bound a state that changes after it, so
  the program does: a finalization runs only while the compute left covers its worst case, set by the rows its
  boards retain (fixed once it can finalize), and the core's reserve for the entry and delegation behind it;
  otherwise it yields unchanged to a later transaction, and the keeper sends every finalization at the
  transaction maximum. One whose predecessor has not reached it yet, because an earlier step of the same
  transaction yielded or for any other reason, waits the same way. `finalization_never_exceeds_its_worst_case`,
  `a_finalization_without_the_compute_it_could_need_yields_unchanged`,
  `optional_cadence_never_overruns_an_entry_after_a_concurrent_expiry_rollover`,
  `optional_cadence_survives_the_rollover_with_the_auditors_original_fields` and
  `a_dependent_optional_finalization_after_a_yield_never_fails_the_entry` guard the bound and the yields. A finalization of a Daily someone else has already finalized,
  closed or not, is a no-op that still requires the canonical accounts of the days it names, so a size that
  passed its simulation cannot fail later for that. A winner back on a quiet day seals days the same way, then
  claims. The waiting Dailies are read forward from the result root, which names the last finalized day,
  so a backlog of any length advances with every transaction.
  `the_largest_cadence_carrying_entry_fits_one_transaction` bounds each size the client can fall back to with
  room for delegation; `a_backlog_of_empty_dailies_finalizes_from_the_root_forward_whatever_its_length`,
  `an_optional_finalization_someone_else_already_made_never_fails_the_entry`,
  `AnEntryCarriesOnlyTheFinalizationsItsSimulationAccepts`, `AClaimItsSimulationRejectsStepsDownToTheEntryAlone`,
  `EveryDistinctSizeIsOfferedAndAClaimSizeOutlastsRejectedFinalizations`,
  `ASizeItsPayerCannotFundStepsDownInsteadOfFailingTheEntry`,
  `AWinnerSealsOnlyAsManyFinishedDaysAsFitOneTransaction`, `ABacklogOfAnyLengthIsReadFromTheRootForward`,
  `TheLargestCadenceCarryingEntryFitsOnePacket`, `TheCadenceIsReadFromTheChainOfPreparedDailiesOldestFirst` and
  `AWinnerBackOnAQuietDayFinalizesTheirDayThemselves` guard the program and the client.
- **Launch:** before launch only the authority prepares a Daily, in the one transaction that also seeds it and
  unpauses. A Daily left from before the launch day was never seeded or entered, is no member of the chain, and
  closes at once with its rent returned to cadence funding.
  `before_launch_only_the_authority_prepares_and_a_daily_from_before_the_launch_day_closes_at_once` guards both.
- **Suspension:** governance may suspend Dailies instantly for any duration, and shorten or cancel a suspension
  with immediate effect: nothing is ever prepared for the day it was due to end. Paid entry rejects on a
  suspended day, including one already entered, before any Kredit, vault or pot change. Today's Daily can
  still be prepared, empty, so that a finished day finalizes and its winners claim during the suspension. A
  prepared Daily nobody entered finalizes empty and sends everything it holds to the next prepared Daily, once,
  without spending a Kredit or remapping later days.
  `a_seeded_launch_day_suspended_before_any_entry_finalizes_empty_and_its_seed_moves_on`,
  `shortening_a_suspension_takes_effect_at_once_because_no_later_day_is_ever_prepared`,
  `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` and
  `suspension_window_handles_gaps_and_u32_limits` guard that behavior.
- **Funding edge:** preparation only moves forward, and each Daily records the Daily prepared before it. Entry
  backing and finalization rollover reach a Daily only from that recorded predecessor; a later suspension
  change never remaps an edge, and no caller chooses a successor.
  `the_funding_edge_is_the_recorded_predecessor_whatever_the_suspension`,
  `finalization_rejects_skipping_its_funding_successor` and
  `keeper_backstop_prepares_todays_daily_only_for_a_played_day_waiting_for_its_successor` guard the program and the keeper.
- **No future-content panel:** the app shows the current challenge and suspension notice, without previewing
  the following day's pair. `keeps reversed models out of authored source` guards the retired copy; nothing
  prepares a later day's account.
- **One difficulty table:** Campaign tier and Daily pressure draw from the same generated tier weights; no
  account or snapshot stores another copy. `CampaignAndDailyQueriesUseTheRustProgressionAndCatalogOwners`
  and codegen check the boundary.
- **Pressure:** one uncapped score ramp controls the multiplier; only the block-weight lookup clamps at the
  top tier. Objective increments do not feed it.
  `pressure_multiplier_is_uncapped_and_the_draw_clamps_at_the_top_row` and
  `theme_total_is_not_added_to_score` guard the formula.
- **Guardian:** each realm has one bonus, trigger and threshold in both modes. Triangular action scoring
  uses only the Daily pressure multiplier. `campaign_and_daily_share_guardian_rules` and
  `triangular_scoring_is_guardian_neutral_for_moves_and_bonus_actions` guard that ownership.
- **Thresholds:** only triggers reading a threshold carry one; all-block-sizes carries zero. Perfect clear
  is a constraint and reroll grant, not a guardian trigger. `bonus_trigger_threshold_is_valid` and
  `trigger_threshold_semantics_are_exhaustive` guard the sparse tags.
- **Opening:** guardian inventories start empty and starting height comes from the realm.
  `campaign_seed_is_fresh_per_attempt_and_replays_on_resume` and `daily_runs_start_without_guardian_charges`
  guard both constructors.
- **Two boards:** the same runs supply Score and Theme. Score ranks triangular daily points; Theme ranks the
  uncapped count of its drawn fact. Campaign uses the same increment capped at its requirement.
  `daily_objective_is_the_shared_kind_increment` and `every_constraint_kind_reads_its_declared_action_fact`
  guard those facts.
- **Theme is not Score:** objective_total never contributes to daily_score or pressure;
  `theme_total_is_not_added_to_score` guards that separation.
- **Classic:** an absent objective produces no Theme increments. Any board with no Theme qualifiers folds
  its half into Score; otherwise the pot splits equally. `classic_empty_theme_folds_the_whole_pool_into_score`
  and `rank_weighted_payouts_conserve_the_board_pool` guard the split and conservation.
- **Qualification:** each board requires its own metric to be positive; zero ties do not earn a place.
  `zero_metrics_do_not_qualify_for_either_board` guards both boards.
- **Payout width:** integer harmonic weights pay through the last rounded payout meeting entry price,
  floored at four before limiting to qualifiers. Trailing zero payouts are dropped, payouts floor to the
  protocol quantum and dust rolls forward. `rank_curve_keeps_four_places_and_renormalizes_fewer_qualifiers`
  and `optimized_payouts_match_the_original_at_every_supported_width` guard the exact arithmetic.
- **Retained capacity:** the width and denominator are computed without an arithmetic cap; a board never holds
  more than `ARENA_BOARD_CAPACITY` rows, during the day or after, and dropped shares roll over without
  renormalization. `bounded_payout_plan_keeps_the_full_width_and_denominator`,
  `finalization_cuts_to_the_paying_rows_and_returns_the_excess_rent`,
  `consume_keeps_both_boards_sorted_at_capacity` and
  `full_board_finalization_stays_below_one_million_compute_units` guard width, allocation and compute.
  Sizing searches stored harmonic denominators and then scans less than one stored step, with the same exact
  result as the rank-by-rank scan. `stored_denominators_size_wide_boards_exactly_as_the_rank_by_rank_scan` and
  `sizing_never_scans_more_than_one_stored_step_and_refuses_a_wider_field` guard the arithmetic.
- **Daily field:** a Daily admits at most `ARENA_DAILY_PLAYER_CAPACITY` (262,144) distinct players, the widest
  field the stored denominators cover, so every admitted field finalizes within one transaction's compute limit.
  The next new player that day is refused at entry before a Kredit is spent and can enter the next Daily;
  players already in keep unlimited entries. The owner approved the limit on 2026-10-02; raising it is a program
  upgrade with a longer table. `a_full_daily_admits_its_last_player_and_refuses_the_next` and
  `finalization_sizes_a_full_daily_field_in_one_transaction` guard the limit and its compute.
- **One row per player per board:** retain that player's best qualifying run with unlimited paid entries.
  Ordering is metric descending, earliest finalized achievement, then wallet bytes.
  `board_order_uses_metric_then_time_then_owner_bytes`,
  `retained_rows_equal_a_full_sort_in_any_consume_order` and
  `a_hostile_consume_order_at_capacity_still_yields_the_full_sort` guard ordering and uniqueness.
- **Prepaid entry:** a Kredit has one protocol price and is one-way: no withdrawal, transfer, cash-out,
  grant, discount or bonus. The shop's packs share that unit price. The owner buys the balance; device
  spending stays within that owner-set cap. `entry_split_is_exact_and_static` and
  `OneKreditButtonUsesTheOwnerPurchaseAndConfirmedBalance` guard accounting and purchase presentation.
- **Money routing:** purchase sends the operator share directly to the pinned team address; the vault holds
  prize money only. Spending never joins the competing pot: it waits in the Daily it was spent on and moves
  to the next prepared Daily when its own finalizes. The lobby shows a Daily's pot together with what the Daily
  before it still has to send, so the figure does not move when that Daily finalizes.
  `purchase_kredits_pays_the_protocol_destination_directly`,
  `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths`,
  `lamports_are_conserved_and_a_days_waiting_share_reaches_exactly_one_later_pot` and
  `TheLobbyPotDoesNotJumpWhenTheDailyBeforeItFinalizes` guard the transitions and the figure.
- **Entry resolution:** every paid entry becomes scored or expired, with no refund path. A run still
  unresolved six hours after its window can no longer score: finalization counts it expired, its owner's next
  entry retires it, and consuming it only releases the slot and returns its rent, once. Settlement never delays
  the next Daily. `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` and
  `a_day_with_an_abandoned_run_finalizes_on_the_first_claim_after_the_recovery_window` guard the lifecycle.
- **Boards:** global ranking has one owner, the program. Preparation creates both boards empty. Consuming a
  scored run is their only writer: it moves the player's earlier row up, inserts a new row, or at capacity
  drops the last row or leaves the result out, so the rows always equal a full sort of every qualifier's best.
  No instruction accepts a row. Finalization keeps the program-computed paying rows, appends their claim
  bits and seals both boards with their Daily. `no_caller_can_choose_board_rows`,
  `no_instruction_accepts_a_board_row`, `retained_rows_equal_a_full_sort_in_any_consume_order` and
  `finalization_cuts_to_the_paying_rows_and_returns_the_excess_rent` guard it.
- **Board rent:** cadence funding pays it all and gets it all back. A player's first entry of the day moves
  one row and claim bit of rent into each board, before the Kredit is spent, so an accepted entry always has
  room for its result and consume needs no payer. Finalization returns what the paying rows do not need; closing
  the Daily returns the rest.
  `board_rows_never_exceed_the_row_rent_their_entrants_paid` and
  `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` guard the invariant and the refusal.
- **Claims:** an explicit position is checked against its sealed board and payout is recomputed. A claim of
  an already-claimed or expired position is a no-op: no transfer, points or other changes. So is a claim on a
  Daily closed since, which the result root must hold and the player must still authorize: closing waits for
  the claim window, so nothing there is owed. A Daily that is not finalized has no sealed board and rejects;
  `ladder_points_are_credited_once_per_claim` and
  `a_claim_whose_daily_closed_since_never_fails_the_entry_it_rides` guard successful, failed and no-op
  outcomes.
- **Claim window:** both boards seal when their Daily is finalized, and rewards remain claimable for thirty
  days from that one moment. Closing the Daily after the window moves unclaimed money into the newest pot, not
  revenue; a Daily that paid nothing closes at once. `one_claim_clock_runs_from_the_dailys_finalization`,
  `ladder_points_are_credited_once_per_claim` and
  `closing_a_daily_moves_what_was_never_claimed_into_the_newest_pot_and_returns_only_rent` guard claims and
  closure.
- **Composed entry:** an entry carries the cadence that is due ahead of itself. When none is due it prepends at
  most two claims proven claimable by the client's reads; when some is, the optional claims wait for their own
  transaction. Stale claimed/expired positions are no-ops, without preflight or retry.
  `EntryComposesAtMostTwoProvenClaimsAndNoOpClaimsNeverRetry`,
  `AnEntryCarryingCadenceLeavesItsOptionalClaimsOut`,
  `ArcadePreparesDelegatesAndRequestsOpeningVrfWithUnavailableOptionalClaims` and
  `ClaimRejectsWrongBoardOwnerThenUsesClaimedBitmapOrFreshArchivalAbsence` guard entry and explicit
  recovery.
- **Protocol economics:** terms are core constants, emitted once. Authority seeding and later deposits use
  the same instruction; `entry_split_is_exact_and_static` and
  `sbf_first_deposit_funds_and_launches_the_first_daily` guard those boundaries.
- **Ladder:** cumulative integer log-rank points pay no money, never decay and run on no timer. They use
  each board's qualified field and accumulate a permanent highest tier.
  `committed_ladder_vectors_match_integer_ln` and
  `ladder_points_accumulate_and_promote` guard arithmetic and progression; native
  and program paths use the same core. Campaign stars and ladder tiers grant no SOL, entries, mint odds or
  prize eligibility.
- **Qualifying credit:** a positive flat award applies once per player, board and day on first
  qualification, including players outside the paying rows. It is never per entry.
  `qualifying_on_both_boards_credits_the_ladder_twice`, `qualifying_on_one_board_credits_the_ladder_once`
  and `a_qualifier_who_never_places_still_leaves_with_a_ladder_total` guard the transition.
- **Claimed ladder points:** placing points ride the claimed bit atomically with payout; failure changes
  neither and repetition adds neither. `ladder_points_are_credited_once_per_claim` guards the instruction.
- **Streak:** consecutive paid-entry days show attendance, not a multiplier. Same-day entries do not advance
  it and a missed day restarts it; `a_streak_counts_days_rather_than_entries` and
  `the_visible_streak_does_not_change_ladder_awards` guard those rules.
- **Governance-only future work:** a ladder reset is announced weeks ahead and compresses totals toward the
  mean at roughly k=0.6 while preserving highest tier. Championships are discretionary, unscheduled and
  funded separately from operator revenue, with amount or public formula announced first. Neither feature
  has a runtime authority path; `fresh_bootstrap_interface_is_locked` guards that boundary. Each needs exact
  approval.
- **Reroll:** one universal accepted action starts with one charge, caps at three and gains a charge on
  perfect clear. It changes the preview without spending guardian inventory, uses its own VRF output and
  replay event, and counts for deadline scoring even without a move.
  `perfect_clear_grants_or_discards_at_the_reroll_cap`,
  `reroll_request_is_an_accepted_action_that_awaits_its_own_vrf` and
  `sbf_reroll_request_callback_and_deadline_resolution_match_the_golden_vector` guard the split.

The global pressure step, score multipliers, ladder tier boundaries and flat qualifying credit remain
balance choices. Structural rules above remain locked.

## Protocol reference

### Campaign and deterministic execution

Campaign has ten realms of ten levels. The money play record is keyed by owner address; Realms is
walletless. The first level starts open; later levels require a predecessor star and later realms require
the previous guardian star. Completed levels remain replayable. Core functions derive packing, progression,
completion and emblem eligibility, checked by
`campaign_packing_roundtrips_and_local_results_preserve_the_maximum`,
`campaign_eligibility_handles_sparse_saves_and_unsupported_emblems` and
`CampaignAndDailyQueriesUseTheRustProgressionAndCatalogOwners`.

`record_campaign_stars` takes the full packed array and merges each level by maximum under the
owner-or-device-session authorization of `set_featured_emblem`. Apart from authorization and account
constraints, only malformed encoding rejects. `campaign_stars_merge_per_level_maximum_and_never_decrease`
and `record_campaign_stars_is_idempotent_and_touches_no_other_field` guard monotonic, field-isolated writes.
`emblem_unlocked` remains the display gate for reported progress.

On connect, merge the chain array into the local play record. A higher local maximum marks that same record
pending; a current funded device session writes it in the background. Retry on start or enable, without
blocking play or other transactions. No cloud, server, indexer or second progress store participates.
`campaign_record_write_never_gates_play_or_other_transactions`,
`campaign_record_retry_survives_restart_and_preserves_newer_stars` and
`campaign_record_enable_during_pending_attempt_retains_the_retry` guard concurrency and durable
acknowledgement.

Each attempt draws and persists fresh platform randomness before its first action. Resume replays the saved
seed and accepted log through Rust on that device; only lifetime stars cross devices. Lost devices replay
the level. `campaign_seed_is_fresh_per_attempt_and_replays_on_resume`,
`local_campaign_run_survives_process_death` and `campaign_action_is_accepted_only_after_durable_write` guard
both identities and acceptance after persistence. Tests may inject seeds.

Three independent sources—score, cumulative Shape and moment Blow—latch in any order, with one action able
to latch all three. Absent constraints earn no source; complete means all authored sources latched, while
exhaustion retains earlier stars. `constraint_stars_latch_in_any_order`,
`constraint_stars_latch_zero_to_three_on_one_action`, `absent_constraints_limit_the_earnable_source_mask`
and `exhausted_runs_keep_latched_stars` guard those transitions.

The core score ladder and tier derive the move budget; the catalog authors tier and both constraints, not
target or budget. Primary facts are cumulative with count at least two; secondary facts are moments, not the
primary fact or the realm guardian's own trigger. ComboOfAtLeast, ComboOfExactly, AllWidthsInMove, BigMove,
BonusLinesInMove and PerfectClear carry count one; Streak and BreakInMove retain their in-action N.
`campaign_move_budget_is_derived_from_the_ladder_and_tier`, `campaign_catalog_rejects_an_authored_budget`,
`campaign_rules_require_valid_constraint_classes_counts_and_distinct_facts`,
`codegen_enforces_constraint_class_per_slot` and `constraint_classes_and_tags_are_exhaustive_and_stable`
guard the catalog and engine. `committed_catalog_validates_and_emits_protocol_constants` checks its version.

One Rust Run owns grid, guardians, scoring, pressure, metrics, clocks, payouts and replay. The native host
owns safe codecs; zkube-core-ffi is the unsafe shell. The program reconstructs Arcade through that same
core, without Campaign projection fields. `one_run_drives_campaign_and_daily`,
`program_and_core_score_one_action_identically`, `arcade_reconstruction_rejects_campaign_rules`,
`shared_run_config_and_state_codecs_round_trip_both_rule_shapes` and
`ActualManagedNativeCallsMatchEveryTransitionAndTrace` guard engine and boundary agreement. `NoPresentation`
disables observations for consumers that do not need them;
`perfect_clear_observation_preserves_move_bonus_and_capped_state` guards the observed transition.

Replay commitments bind chain domain, challenge, rules hash, player, run ID and the fixed encoding tag, then
fold ordered VRF, action, bonus, abandon and deadline events. Permanent rows keep the commitment; action
logs can remain off-chain. `committed_daily_run_vector_recomputes_end_to_end` and
`committed_zero_action_deadline_vector_recomputes_end_to_end` guard the vectors. The Daily hash binds day,
core catalog version, realm guardian/height, objective and rules version;
`daily_rules_hash_binds_day_realm_objective_and_protocol_constants` guards its inputs.

One perfect-clear output derives the board reseed and preview for move and bonus alike;
`perfect_clear_continuation_is_one_rule_for_move_and_bonus` guards the continuation. At cutoff, an accepted
action scores its last committed state; untouched runs expire. Pending or late VRF output cannot score an
expired or orphaned run. `finish_run_predicates_are_exact` guards authorized Abandon before cutoff,
permissionless Deadline afterwards and exact idempotence. Opening VRF remains separate after Router
placement; delegation and terminal commit remain separate operations, guarded by
`sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths`. A row callback writes only its run and
schedules no commit, so its request names no Magic context or fee vault;
`the_row_callback_carries_only_its_run` guards the request and the callback's accounts.

Consuming a scored run logs RunScored: the day, the run and its row. A finalized board keeps only its paying
rows and daily player accounts close, so that log is the public record of every result. It grants nothing;
boards and claims never read it.

### Accounts, identity and recovery

Program account sizes, versions and rent come from their Rust owners and codegen.
`target_accounts_fit_normal_solana_account_limits`, `account_sizes_and_maximum_board_rent_are_explicit` and
`fresh_bootstrap_interface_is_locked` pin the interface. Daily content and timestamps derive from day ID; an
ActiveRun retains its rules snapshot. One day boundary serves both products: day D runs from 07:00 UTC to 07:00
UTC the next day, which is midnight at UTC-7, the daily reset of Google Play Games leaderboards. The core owns
which day an instant belongs to and when a day opens; the program, the keeper, the operator's launch window and
both clients ask it and never divide a timestamp themselves.
`every_day_runs_from_seven_utc_to_seven_utc`, `daily_window_is_derived_at_epoch_and_u32_day_bounds`,
`keeper_rule_boundaries_use_the_core_at_day_and_ordering_limits`, `EveryDayRunsFromSevenUtcToSevenUtc`,
`DailyWindowUsesTheCoreAcrossTheFullDayRange` and `TheLocalDailyTurnsOverAtSevenUtcWithTheCore` guard clocks.
Entries close at 06:59 UTC. A clock time in a document, a comment or a line of copy is one of the core's two,
never another literal; `every_utc_clock_time_in_authored_text_is_the_cores_day_window` guards every tracked
file, less five named presentation files that still carry the old cut-off. Authority rotation and team destination changes
require a program upgrade; the interface lock excludes runtime setters. `initialize_protocol` runs once and only
with the signature of the program's upgrade authority, read from the loader's ProgramData, beside the governance
authority it names; `an_untrusted_initializer_cannot_claim_the_protocol` guards the bootstrap.

PlayerState keeps separate Score/Theme best paying rank, wins and rewards; non-paying places do not become
profile records. Kredit balance, ladder total/highest tier, lifetime best daily score and streak remain
distinct. The profile carries no spare bytes: there is no migration, so a new field means a fresh bootstrap,
which reallocates. `competition_record_counts_only_prize_results` and `ladder_points_accumulate_and_promote`
guard those fields. An ArenaPlayer stores its two best results without repeating its wallet, and an ActiveRun
reads its bonus from its rules snapshot rather than a second copy;
`arena_player_keeps_best_replay_and_its_run_identity` and `program_and_core_score_one_action_identically`
guard both. Featured emblem and
ladder border change together; any previously earned tier remains wearable after a reset. Automatic emblem
selection chooses the strongest unlocked guardian, all-guardian or perfect-world emblem; all are
display-only. `sbf_featured_emblem_accepts_owner_and_only_unlocked_campaign_badges` guards selection.

| Boundary | Owner and recovery |
| --- | --- |
| Owner wallet | Identity, Kredit purchases and device fee/rent funding |
| Device session | One install key; atomic revoke-and-create renewal, bounded by owner funding |
| Cadence funding PDA | System-owned recyclable rent; signs only Daily preparation and finalization creation paths |
| ProtocolConfig | Launch/suspension and sequential finalized-result root |
| ActiveRun | Arcade state on Router-resolved ER, then consumed on Base |
| Local Campaign | Address-keyed or walletless play, durable seed/log and lifetime stars |

The install key survives address changes, disconnect and revocation. Renewal keeps the old public expiry
until acknowledgement, including after failure. `OneInstallKeyIsReusedAcrossWalletsAndRestarts`,
`RenewalRevokesAndCreatesTheSameTokenAtomicallyWithTheInstallKey`,
`DisconnectPreservesBothDurableSessionAndActiveKeyWhenJournalIsUnresolved`,
`RefillKeepsIdentityAndRevokeClosesTheTokenWhileRetainingTheInstallKey`,
`SignedRenewalResumesPublicSaveBeforeJournalRemoval` and
`FailedRenewalRetainsThePreviousExpiryAndInstallKey` guard lifecycle;
`oneInstallKeyIsSavedBeforeUseAndReusedAfterRestart` and `failedDurableSaveReturnsNoUsableKey` guard native
persistence.

What the owner's wallet puts on a device has one owner. The program states the accounts a first entry of the
day pays for, including the pinned delegation program's record, metadata and buffer; the codegen turns them
into rents; the client's DeviceFunding adds its own fees and the delegation charge. The funded target is one
first entry plus the run costs of the largest Kredit pack, and a device is ready to enter only when it holds
the cost of that entry. `first_entry_accounts_are_the_real_account_and_delegation_sizes`,
`sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` and
`ADeviceThatCannotPayItsFirstEntryIsAskedToRefillBeforeEntering` guard the sizes, the real entry cost and
the gate. The delegation charge is MagicBlock's published figure; a Devnet trial confirms it.

Each run and ArenaPlayer returns rent to its stored payer, even from another device. An ArenaPlayer closes
once its Daily is finalized: the boards were complete at that point and never read it again, and no entry or
consume can touch a finalized Daily, so nothing can bring it back or repeat its qualifying credit.
`a_closed_run_returns_rent_to_its_payer`, `a_closed_arena_player_returns_rent_to_its_payer` and
`a_closed_daily_player_cannot_come_back_on_a_finalized_or_archived_day` guard refunds and revival.
The cadence signer pays rent only for a Daily and its two boards, at preparation and at a player's first
entry; it is not a general fee sponsor.
`prepare_makes_only_todays_daily_once_and_a_repeat_is_a_checked_no_op` guards preparation.

Base, Router and resolved ER connections stay separate, and each endpoint is HTTPS unless it is this machine;
`AResolvedErEndpointMustBeHttpsLikeEveryOtherEndpoint` guards the client's one endpoint policy. Resolve
placement through `getDelegationStatus`.
Preserve copied-back terminal state until consumption; deterministic expiry and orphan reservation permit
cleanup without late scoring. Arcade has one durable slot and monotonic run IDs, guarded by
`arcade_reservation_and_orphan_share_one_monotonic_run_sequence`.
`undelegation_callback_is_constrained_to_its_buffer_pda` guards the canonical callback buffer and System
program constraints in the pinned SDK.

One identity epoch invalidates retained reads after reconciliation; superseded reads cancel.
`PendingPurchaseUsesRealReconcilerAndInvalidatesRetainedEconomyProjection` and
`NewPublicReadRejectsAnOldCallbackAndRetainedPublication` guard publication. `RunOperationReceipts` is the
retained operation for that identity epoch;
`MoneyRunReadFailureRetainsActualConfirmedReceiptAndReportsTheNewFailure`,
`TheLastOperationIsSharedAcrossPagesAndClearedOnReconnect`,
`MoneyRunSettlementUsesTheActualReconcilerAndKeepsOrderedCommitConsumeReceipts`,
`AConsumedRunsReceiptCanFinishWithoutClaimingItsNewSuccessor` and
`RunReceiptRejectsReuseWrongOwnerAndRunBeforeSending` guard receipt retention and settlement.

### Unity and generated boundaries

Shared presentation pages take data/actions through IAppPageSource. Identity slots supply store
purchase/name editing or money address/device/Kredit/claim/receipt controls.
`EverySharedPageRendersUnderBothIdentityImplementations`,
`DailyEntryRequiresConfirmationThenNativeInputSettlesBothMetricsOnce`,
`ForegroundPreservesArcadeWithoutDeviceKeysOrNewTransactions` and
`CampaignStaysVisibleWhenAnEarlierOverviewReadCompletes` guard the journeys and active page.

One parsed theme catalog and generated constraint captions serve pages and boards. One startup/configuration
path owns both products, and money-only schemas stay out of store packages.
`EveryRealmUsesItsImportedArtMusicAndNativeInventory`,
`SelectedSceneHasOneSharedStartupAndOnlyItsIdentityConfiguration`,
`UnconfiguredSceneHasReadableTextAndNoEnabledOperation` and
`TeardownDuringDelayedReadWaitsWithoutLateInputOrSigning` guard content and lifecycle. Native preferences
are shared across settings and board controls, checked by
`SettingsBeforeStartAreAppliedAndPersistAcrossControllerRecreation` and
`SlidersAndSwitchesUseIndependentLevelsAndRememberOnlyThisSettingsMount`. One menu track, the catalog's
menu-music slot (assets/common/sounds/musics/menu.mp3), plays under the tab pages at the music level and stops
for a result and the board; `MenuMusicPlaysUnderTheTabPagesAndStopsForAResultAndTheBoard` guards it.

Skins live in assets/skins/<id>/ and are listed in assets/catalog.json; Lumen is the only skin and the first is
the default. The codegen owns the slot and token list, emits it to C# and rejects a missing or unknown slot for
the UI or any realm. Each realm owns its block tints, light colours, ledge rail, map node set (locked, open,
current, cleared in bronze, silver and gold by its stars, and the guardian's ring) and its colourway of the two
product wordmarks (Home wears the day's Daily realm's), and skin.json places its key light, shafts and motes;
paintings are JPEG and every piece with alpha is PNG. Ladder borders and badges derive from the core's tier
count. build.py gives each skin UI kit and skin realm its own atlas with the
authored stretch borders. `every_skin_fills_every_ui_and_realm_slot`,
`every_realm_declares_its_own_block_tints_and_light`, `every_realm_places_its_key_light_shafts_and_motes`,
`paintings_are_jpeg_and_everything_with_alpha_is_png`,
`EverySkinMustCoverEveryRealm`, `test_skin_ui_and_realm_slots_import_into_their_own_atlases_with_borders`,
`the_cleared_tiers_are_three_pictures_in_every_realm` and `TheMapTellsItsNodesApartAndItsGuardianIsTheBoss` guard
the contract. Kit art carries no seam or stray highlight;
`NoSlicedKitPieceShowsASeamAtItsSliceLinesAtTwiceItsSize` and
`test_no_sliced_kit_piece_carries_a_stray_point_light` check the rendered and authored pixels.

Each guardian has ten full frames, a paws layer drawn over the rail it leans on, and a contact rail line; its
title and ten lines are authored per realm in the catalog. The talk scene types those lines on the realm's
ledge with the mouth flapping, then rests on the moment's mood; reduced motion shows the line at once.
`guardian_contact_names_every_frame_and_a_rail_inside_its_canvas`,
`every_guardian_says_every_line_and_none_is_empty`, `EveryMomentSpeaksItsAuthoredLine` and
`TheGuardianLeansOnTheRailOverTheBox` guard frames, lines and placement. Daily objectives take their words
from the constraint caption owner; `every_daily_objective_uses_its_constraint_caption` guards the pair.

A guardian is always drawn as its idle frame; a blink, talk or mood frame lays only its face over it, the
rectangle contact.json records, so every frame shares idle's body pixels on the board, the talk scene and the
pages. `EveryFrameOfEveryGuardianRendersInTheSameBoxAsIdle` guards the drawing and
`EveryGuardianFrameMatchesIdleOutsideItsRecordedFace` the art. The codegen owns the board's sound cues and
imports their clips; `EverySoundCueHasItsImportedClip` guards the pair.

The player renders in gamma colour space: the approved art and its soft alpha were composed that way, and
linear blending darkened near-transparent edges. `ThePlayerBlendsInGammaSpaceAsTheArtIsApproved` pins it.
Preparation clears the font engine's uninitialised kerning-pair flags, which otherwise dropped Label tracking
at random between checkouts; `EveryGeneratedFontSpacesEveryKerningPair` guards every generated font.
Compact-phone page tests run in the measured device safe areas of Tests/PlayMode/Presentation/Phones.cs
(360 x 572 and 417 x 882 dp), as `EveryPagesLastPieceScrollsAboveTheTabBarOnACompactPhone` does.

Each product's icon layers, legacy icon, splash scene and lockup come from the brand directory its identity names
in unity/toolchain.json, and build.py stages only that product's files. The splash is a full scene without words.
The launch window draws it until Unity's first frame, the launch screen continues it pixel-aligned and brings it
to life (the scene breathes in a slow zoom, motes rise, the lockup rises in and the loading line sweeps under it;
reduced motion holds them still), and a veil opens on the first page; startup then releases the window's splash.
`test_each_package_stages_only_its_own_icon_and_splash`, `test_each_package_launch_window_carries_its_own_splash`,
`TheSplashSitsWhereTheLaunchWindowDrawsItWithTheLoadingLineUnderItsLockup`,
`TheSceneBreathesItsMotesRiseAndItsLockupRisesIn` and
`TheSegmentSweepsUntilTheFirstPageThenAVeilClosesAndOpensOnThePage` guard identity, geometry, motion and handover.

Store saves derive Daily content from day and keep numeric metrics; money saves carry Campaign only.
`MoneySaveContainsOnlyCampaignDataAndDailyMetricsRemainNumbers`,
`LocalProductRoundTripPreservesProgressAndSavedRun` and
`FlushedProductPublicationReplacesWholeDocumentAndClearsStalePending` guard codecs and persistence. Local
row randomness is core SHA-256 of saved seed and little-endian counter;
`LocalRowRandomnessMatchesRustForSavedSeedsAndCounterBounds` guards reproducibility. Share formatting uses
platform number formatting, checked by `SharePreservesTheCallersPlatformFormatting`.

Rust emits native trajectories and program account/PDA/instruction/message scenarios.
`RustProgramInstructionsDecodeAndReencodeWithTheSharedBorshReader`,
`BoardRewardsValidateActualAnchorAccountsAndKeepClaimedPositionsVisible` and
`NativeFixtureJourneyUsesRealDragAndOrderedTrace` check real boundary bytes and pointer input. Test doubles
supply RPC envelopes and synthetic signatures; they are excluded from packages, guarded by
`test_metadata_rejects_test_drivers_and_retired_diagnostics`. Campaign merge/record responses include packed
progress and eligibility, while one Daily query supplies content and time.
`RemainingNativeQueriesMatchRustFixtureVectors` covers the other queries;
`nulls_aliasing_versions_and_lengths_are_rejected` and `rejected_calls_publish_nothing` guard the native
pointer boundary and atomic output.

The root assets directory is authoritative. unity/toolchain.json owns identity metadata;
unity/tools/build.py owns imports, fixtures, builds and each identity's dependency locks (the store's carry
its one own dependency, Play Games, named in unity/toolchain.json).
`test_money_lock_update_requires_both_resolved_modules` guards lock replacement. Services and tools/chain
share one workspace and configuration; `workspace_has_one_dependency_and_configuration_owner`,
`keeper_and_operator_share_chain_identity_and_launch_day_bounds` and
`workspace_build_loads_keeper_idl_and_native_rules_offline` guard configuration and build imports.

### Keeper and archival

ProtocolConfig advances a sequential result root from launch day, and finalization appends its Daily to it.
The next member is exactly the Daily whose recorded predecessor is the last member, and a Daily finalizes only
after that predecessor has, so no Daily can be passed over. The first member is the one Daily from launch
onward whose predecessor lies before launch. A Daily of the chain closes only once finalized, so the root covers it.
`archive_is_strictly_sequential`, `the_first_root_member_is_the_first_daily_of_the_chain_from_launch`,
`finalization_rejects_skipping_its_funding_successor` and
`closing_a_daily_moves_what_was_never_claimed_into_the_newest_pot_and_returns_only_rent` guard it. The ledger is the archive. No
notification service exists; a missed notification never changes a claim window, and any future notification
is only a courtesy.

One Cloudflare Worker (services/src/worker, schema in services/worker/schema.sql) holds the public read model
and the keeper over one D1 database. The read model ingests the program's Base transactions, by webhook and
by a bounded catch-up walk that closes any gap. An instruction counts wherever it ran, sent directly or called
by another program, and only where the runtime's own log shows that call and every caller above it succeeding:
the outer transaction's status says nothing about one inner call. A finalization is recorded from the
`DailyFinalized` log the program writes only when a Daily really finalizes, never from the instruction, so one
that found the Daily done or yielded records nothing; a Daily is known by its address, so a finalization is
recorded however late it comes. A transaction the model cannot interpret is kept as
unreadable: the walk goes past it, the model reports itself incomplete while one remains, and a readable copy
replaces the marker. A storage failure is not that: the walk stops, advances nothing and reads the transaction
again. It records every scored run from the `RunScored` log a
consume writes, counted only while the zKube program is the one running: full standings and any wallet's rank, including ranks below the paying rows and days already
closed. It is never an authority. The program's boards stay the leaderboard of record, claims read the chain,
its answers say so, and an honest delivery adds only what the walk would. A delivery is not a proof: whoever
holds the webhook secret, or the RPC the walk reads, can add or alter display rows and discovery hints, and
nothing else. No board, claim or keeper write reads them unverified, and the ranks below a board's rows are
display, not verified standings. Its ranking is the core's board
order. `indexer_records_every_scored_run_and_ranks_each_wallets_best_on_both_boards`,
`a_result_counts_only_when_the_zkube_program_logged_it`, `indexer_ranks_agree_with_the_core_board_order`,
`ingesting_again_or_in_another_order_leaves_the_same_rows`,
`discovery_and_results_count_an_instruction_however_it_was_invoked`,
`an_instruction_counts_only_where_the_programs_own_log_shows_it_succeeded`,
`a_finalization_however_late_is_recorded_and_one_unreadable_transaction_never_stops_the_walk`,
`a_storage_failure_is_retried_and_never_recorded_as_an_unreadable_transaction`,
`catch_up_walks_bounded_pages_and_reports_itself_incomplete_until_the_gap_closes`,
`public_reads_serve_full_standings_and_any_wallets_rank_without_claiming_authority` and
`the_webhook_needs_its_secret_and_only_adds_what_catch_up_would` guard it.

The client reads a sealed board from the chain and asks the read model only for what that board no longer
holds: the ranks after its rows and the player's own result below them. An answer is shown only where it agrees
with the board (the same qualified count, ranks after the board's rows, no result above its last row); with no
answer, or one that disagrees, the page shows the chain's board alone and nothing else changes. Claims never
read it. `YourResultBelowThePaidRowsComesFromTheReadModelAndTheBoardStandsAloneWithoutIt` and
`ABoardThatHoldsItsWholeFieldAsksTheReadModelNothing` guard the read.

The keeper pass runs only from the Worker's Cron Trigger. The request path is handed the database and the
webhook secret alone: no request can start a pass, reach the key or change the write switch.
`a_fetch_cannot_start_a_keeper_pass_reach_the_key_or_change_the_write_switch` guards that boundary.

The keeper is a backstop: nothing a player does waits for it. Its seven plans prepare today's Daily when a
played day is over with nothing to finalize into (never an empty Daily for its own sake), finalize, close Daily and player accounts and, for runs nobody came back to,
finish at the deadline, commit and consume. All seven instructions are permissionless and each is a no-op or a
checked rejection when a player's transaction got there first; `keeper_allowlist_is_exactly_its_plans`,
`an_expired_orphan_closes_without_period_accounts`,
`a_missed_funding_day_finalizes_after_its_window_and_rollover`,
`keeper_finalizes_by_the_clock_once_the_day_has_a_successor`,
`keeper_closes_a_daily_that_paid_nothing_at_once_and_the_others_after_their_claim_window` and
`keeper_settles_abandoned_runs_by_state_and_location_and_expires_none` guard those plans. With the keeper off,
an abandoned run's rent waits in its account for its owner, and a finished Daily's rent and unclaimed money
wait for whoever closes it; no entry, result or claim waits. Governance stays with the owner.

Instruction name, connection and priority have one metadata owner. The core owns day, suspension, pair
decoding and board ordering through WASM/native exports; `materializes every surviving keeper protocol
operation`, `keeps cadence, recovery and cleanup ordering stable`,
`pair_decode_covers_the_product_and_rejects_outside_indices`,
`board_order_uses_metric_then_time_then_owner_bytes`,
`keeper_rule_boundaries_use_the_core_at_day_and_ordering_limits` and
`BoardOrderingUsesTheCoreAtMetricAndTimestampBounds` guard the boundaries.

Writes are off unless the owner's stored approval equals the fingerprint the running Worker computes from its
deployed version, keeper key and launch day; any new deployment is a new version and plans only until it is
approved again. Program ID and IDL hash come from the build. `binds the Worker version, keeper key and launch
day while reporting build identity`, `pins loaded secret material to the configured public key` and `keeps
writes fail-closed unless explicitly enabled` guard release identity. RPC checks cover Devnet, HTTPS, owner,
bounded length, discriminator, version and field shape; plans stay in the recent cadence window. `requires
the Devnet genesis and handles an unavailable RPC`, `requires HTTPS outside localhost`,
`keeper_rpc_decoding_rejects_foreign_and_malformed_accounts`, `rejects a Router owner mismatch
before using the ER` and `uses the fresh Router location for a write connection` guard transport and
placement.

Run discovery follows play in flight: the players of recent Dailies with a paid run, and run accounts on Base.
It never reads the lifetime set of profiles and has no population ceiling. A run that cannot be read is carried
as unavailable and deferred to its recovery deadline while every other Daily and run is served.
`keeper_discovery_follows_play_in_flight_and_defers_one_unreachable_run` guards both. The keeper never treats
the read model as complete. A model that finished a catch-up walk within the last five minutes only shortens a
pass: the addresses it names are read from the chain, and one that is closed, foreign or malformed is dropped.
Each Daily counts its own unresolved paid entries, each of which is one run in flight; when the hints reach
fewer runs than a Daily counts, the keeper scans the chain in the same pass. It also scans at least once an hour
whatever the model says, and whenever the model is incomplete or stale.
`discovery_hints_follow_entry_consume_and_close_and_are_withheld_until_the_model_is_complete`,
`keeper_reads_hinted_accounts_from_the_chain_and_drops_every_hint_it_cannot_verify` and
`the_scheduled_pass_simulates_reserves_relays_and_settles_a_write_inside_the_worker` guard the hints, the
count and the hourly scan.

Every keeper message states its compute-unit limit: a first simulation under the transaction maximum sizes it,
and the message carrying that limit is the one simulated again and relayed.
`keeper_messages_carry_a_compute_budget_sized_from_simulation` guards the compiled message. A D1 lease admits
one pass at a time. Each pass simulates before relay and records the simulated spend in D1 before the bytes
leave. A write stays reserved until its outcome is definite: the cluster has confirmed that it landed, with
success or failure, or finalized blocks have passed the last one that could hold it and the cluster has no
record of it. Elapsed time settles nothing, and neither does a result only one node has processed.
While reserved it counts against every later pass's spend ceiling, and its payer spend against the wallet's
reserve floor. Each pass enforces
the write count, the spend ceiling and the reserve floor from KEEPER_LIMITS; rent a write takes from cadence
funding counts as spend. Each pass reports cadence funding against its worst case, two overlapping Dailies
with full boards, which is also what the launch plan seeds; topping it up stays the owner's decision.
`keeper_pass_reserves_write_slots_and_simulates_before_every_send`,
`keeper_simulation_failure_and_reserve_floor_prevent_relay`,
`keeper_spend_is_reserved_even_when_confirmation_is_uncertain` and
`keeper_reports_cadence_funding_against_two_overlapping_days_and_counts_its_rent_as_spend` guard the limits
and the report; `keeper_lease_admits_one_pass_at_a_time_and_only_a_dead_pass_loses_it`,
`keeper_ledger_reserves_before_relay_and_an_unsettled_write_counts_until_its_outcome_is_definite`,
`an_uncertain_write_holds_the_floor_for_the_rest_of_its_own_pass`,
`a_failure_only_one_node_has_processed_does_not_settle_a_write` and
`the_scheduled_pass_simulates_reserves_relays_and_settles_a_write_inside_the_worker` guard the lease, the
ledger and the pass in the Workers runtime.

No secret reaches a log. A credential that cannot be decoded fails with one fixed message naming only its
variable, and the Worker's single log sink removes every configured secret and cuts every URL down to its host.
`a_credential_that_cannot_be_decoded_leaves_nothing_of_itself_in_the_error`,
`no_secret_and_no_endpoint_path_or_query_reaches_a_log_line` and
`a_malformed_credential_or_a_failing_endpoint_puts_no_secret_in_the_workers_log` guard it.

## Operator procedures

Run commands from the repository root; tools/chain/cli.ts owns help and public plan parsing. The frozen
tools/chain/deployment/devnet-v4.json is historical evidence, not release input.
`chain_entrypoints_load_offline_under_tsx` checks offline loading. No command grants mainnet or recurring
keeper authority. The approval boundary above applies to every execution.

- **Release build:** NO_DNA=1 pnpm chain build-release is the one way a release program is built: offline,
  from the repository root and a clean target, with the compiler, platform tools, options, locked dependencies
  and compiler flags pinned in tools/chain/releaseBuild.ts. The build inherits only PATH and HOME, so no flag,
  wrapper, profile or target override reaches the compiler; it refuses to run where any cargo configuration
  exists outside the repository, whatever that file says, above the checkout's real path and the path it was
  given alike, and it builds in the real checkout. It checks cargo's own fingerprint of the flags the compiler
  received before it records anything under build/chain/release. A hash from any other build is not release
  evidence. `release_build_uses_only_the_pinned_tools_from_a_clean_target_and_records_what_built_it`,
  `release_build_gives_the_compiler_only_the_recorded_inputs_and_refuses_any_other_flag_set` and
  `a_checkout_reached_through_a_symlink_is_checked_and_built_where_it_really_lives` guard the recipe.
- **Deploy plan:** NO_DNA=1 pnpm chain plan deploy --bundle build/chain/deploy.json quotes that recorded build,
  at the hash the owner reviewed (ZKUBE_SBF_SHA256), using public payer/buffer/authority addresses.
  `a_deploy_plan_quotes_only_the_recorded_release_build_at_the_reviewed_hash`,
  `operator_plan_saves_one_public_bundle_without_loading_a_signer`,
  `deployment_instruction_bytes_and_accounts_match_the_rust_loader` and
  `operator_cli_options_and_exact_amounts_fail_closed` guard planning and the fresh-bootstrap scope.
- **Launch plan:** plan launch binds deployed program, keeper, day and cutoff. ZKUBE_LAUNCH_DAY_ID is the core's
  day, which opens at 07:00 UTC, and the cutoff must fall inside that day's entry window; it quotes paused
  protocol/vault initialization signed by the upgrade authority, cadence funding, and one atomic transaction that
  prepares the launch Daily, seeds it and unpauses.
  `plans the full fresh bootstrap and one atomic launch transaction`,
  `operator_release_checks_devnet_and_programdata` and `refuses planning after the exact launch cutoff`
  guard ordering, release verification and cutoff.
- **Top-up plan:** plan top-up uses the public launch bundle and explicit SOL/lamports amounts through the
  program deposit path, into today's Daily only. `operator_top_up_rejects_seeded_balance_drift_and_a_closed_window` and `routes a
  chosen amount to the exact selected prize-pool PDA` guard target and drift.
- **Suspension plan:** plan set-suspension uses the pinned authority and chosen day; `sets the explicit
  suspension boundary and seeds cadence funding` guards the instruction.
- **Execute:** after exact approval, ZKUBE_APPROVAL and execute --bundle rebuild the public plan before
  loading signer files. `operator_missing_fingerprint_loads_no_keypair`,
  `operator_rebuild_rejects_changed_instruction_bytes_before_loading_a_signer` and
  `operator_signer_read_errors_do_not_echo_file_contents` guard that boundary. One pipeline signs,
  simulates, persists, relays and confirms, covered by
  `operator_signed_simulation_and_durable_receipt_precede_relay` and
  `operator_fee_spend_reserve_and_simulation_failures_prevent_relay`.
  `operator_receipts_resume_without_repeating_confirmed_transactions` and
  `operator_pending_receipts_relay_the_same_bytes_without_loading_a_signer` guard interruption. --until
  selects an inclusive printed index;
  `operator_until_stops_after_the_requested_transaction_and_resumes_that_prefix` and
  `operator_until_is_an_inclusive_bounded_index_and_activation_requires_the_keeper` guard staging.
- **Worker release:** pnpm build writes dist/worker, which services/worker/wrangler.toml deploys as built. A
  deployment needs its own approval and always starts planning only: each pass logs its release fingerprint.
  Review that read-only pass, then separately approve enablement by storing the fingerprint in the
  keeper_approval row; deleting the row stops writes at the next pass.
  `staged_launch_ready_requires_the_paused_protocol_and_no_launch_daily` and `keeps writes fail-closed unless
  explicitly enabled` guard that order.

### Gate G1 — physical-device wallet compatibility

Run every row on physical Seed Vault Wallet/Seeker, Phantom/Android and Solflare/Android through the Kotlin
MWA plugin. Only passive capability inspection is within read-only work; every later row needs an exact
approved bundle, including unsent or zero-value signatures.

| Step | Required observation |
| --- | --- |
| Capability inspection | Sign-only version-zero transactions supported |
| Connect | Authorized address matches the wallet UI |
| Reject | Typed rejection without partial state |
| Restart | Authorization recovers without a stale account |
| Background/resume | Connection stays valid or explicitly reauthorizes |
| Switch address | No cross-owner state |
| Sign-only | Wallet signs without submitting |
| Message integrity | Instructions, accounts, blockhash and signer roles remain exact |
| Device partial signature | Existing device signature survives owner signing |

Stop/go requires sign-only support, unchanged message bytes and preserved device signatures. Failure needs
an explicit architecture decision, without a sign-and-send fallback.
`OwnerWalletRejectsChangedMessagesAndMissingSignatures` and
`DevicePartialSignatureSurvivesOwnerApprovalAndMissingOrChangedSignaturesFail` guard the client checks;
`OwnerPurchaseUsesExactQuoteSimulationAndDurableCommitBeforeSend` checks pinned fee/budget approval. Record
date, device/OS, wallet/plugin versions, capabilities and result/error class without secrets. Passing G1 is
compatibility evidence, not deployment, publication or mainnet approval.
