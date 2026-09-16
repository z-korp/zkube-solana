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
  `test_toolchain_checks_android_targets_and_bundletool_first`.

### Validation and defect classes

The change gate finishes a commit; the release gate finishes a phase or any artifact leaving the machine.
The default and all select release. validate.sh owns the gate definitions.
`test_change_gate_keeps_common_checks_and_editmode_without_packages`,
`test_change_gate_runs_sbf_for_staged_unstaged_and_untracked_program_changes`,
`test_clean_change_gate_checks_the_last_commit` and
`test_release_and_all_run_sbf_both_test_platforms_and_both_packages` guard selection.

```bash
NO_DNA=1 ./validate.sh change
NO_DNA=1 ./validate.sh release
```

A red gate outranks the work that exposed it. Fix the recurring source of a defect in the same change, with
the smallest mechanism that closes that class:

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

## Deployment status

There is no live deployment. The abandoned Devnet release, its accounts, pools, keeper authority and launch
bundles supply no current authority. Fresh bootstrap requires exact approval; no migration exists. Mainnet
remains subject to counsel, economics and distribution review. Specification approval is not deployment or
spending approval.

| Area | Source status and guard |
| --- | --- |
| Core | One deterministic Rust engine at 1.0.0; `one_run_drives_campaign_and_daily` |
| Interface | 30 instructions, 7 account types; `fresh_bootstrap_interface_is_locked` |
| Accounts | Generated versions and bounded layouts; `target_accounts_fit_normal_solana_account_limits` |
| Campaign | Local play and synchronized reported stars; `record_campaign_stars_is_idempotent_and_touches_no_other_field` |
| Arcade | Prepaid entries and Score/Theme boards; `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` |
| Settlement | Growing exact-sized boards and idempotent claims; `ladder_points_are_credited_once_per_claim` |
| Keeper | Thirteen permissionless plan instructions, writes disabled pending approval; `keeper_allowlist_is_exactly_its_plans` |

## Product truth and locked rules

- **Two products, one client:** com.zkorp.zkube is zKube: Arena for the Solana dApp Store and Seeker;
  com.zkorp.zkube.store is zKube: Realms for Google Play. Unity and the Rust FFI are shared; store packages
  exclude money/chain assemblies and wallet plugins. `test_profiles_preserve_money_and_add_two_abi_store`,
  `test_both_package_manifests_use_the_identity_contract` and
  `test_metadata_rejects_every_money_assembly_and_tests` guard the identity contract.
- **Identity:** a connected Solana address identifies an Arena player, without embedded wallets or recovery
  codes. Realms starts with Player, editable in Profile. `money_campaign_needs_an_address_and_no_session`
  and `StoreStartsWithDefaultNameAndEditsItInProfile` guard immediate Campaign play and local naming.
- **Campaign is free and optional on Arena:** one shared local client plays it in both products. Realms
  alone overlays the realm purchase policy and adds a local UTC Daily.
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
- **Suspension:** governance may suspend Dailies instantly for any duration. Prepaid funding crosses the gap
  once to the first eligible prepared successor, without spending a Kredit or remapping later days.
  `a_suspended_day_is_skipped_once_and_its_funding_reaches_the_next_scheduled_day` and
  `suspension_window_handles_gaps_and_u32_limits` guard that behavior.
- **No future-content panel:** the app shows the current challenge and suspension notice, without previewing
  the following day's pair. `keeps reversed models out of authored source` guards the retired copy; the
  keeper can still prepare its account.
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
- **Retained capacity:** the width and denominator are computed without an arithmetic cap; retained rows use
  `ARENA_BOARD_CAPACITY` and writes use `ARENA_BOARD_CHUNK_CAPACITY`, with dropped shares rolling over without renormalization.
  `bounded_payout_plan_keeps_the_full_width_and_denominator`,
  `cadence_funding_creates_exact_boards_through_the_full_capacity` and
  `full_board_finalization_stays_below_one_million_compute_units` guard width, allocation and compute.
- **One row per player per board:** retain that player's best qualifying run with unlimited paid entries.
  Ordering is metric descending, earliest finalized achievement, then wallet bytes.
  `board_order_uses_metric_then_time_then_owner_bytes` and
  `sbf_board_chunks_verify_rows_cursor_and_program_computed_sealing_on_both_boards` guard ordering and
  uniqueness.
- **Prepaid entry:** a Kredit has one protocol price and is one-way: no withdrawal, transfer, cash-out,
  grant, discount or bonus. The shop's packs share that unit price. The owner buys the balance; device
  spending stays within that owner-set cap. `entry_split_is_exact_and_static` and
  `OneKreditButtonUsesTheOwnerPurchaseAndConfirmedBalance` guard accounting and purchase presentation.
- **Money routing:** purchase sends the operator share directly to the pinned team address; the vault holds
  prize money only. Spending funds the following paid Daily, never the competing pot.
  `purchase_kredits_pays_the_protocol_destination_directly` and
  `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` guard both transitions.
- **Entry resolution:** every paid entry becomes scored or expired, with no refund path. Settlement does not
  delay the next prepared Daily's opening. `sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths`
  and `keeper_preparation_advances_past_archived_days_and_keeps_the_recent_window` guard lifecycle and
  preparation.
- **Board construction:** finalization funds exact final rent; each existing chunk grows by exactly its
  rows, without exceeding finalized width. Sealing requires the final size, verified results, global
  ordering and the program-computed count. `cadence_funding_creates_exact_boards_through_the_full_capacity`
  and `sbf_board_chunks_verify_rows_cursor_and_program_computed_sealing_on_both_boards` guard construction.
- **Claims:** an explicit position is checked against its sealed board and payout is recomputed. A claim of
  an already-claimed or expired position is a no-op: no transfer, points or other changes. Unsealed boards
  reject; `ladder_points_are_credited_once_per_claim` guards successful, failed and no-op outcomes.
- **Claim window:** rewards remain claimable for thirty days from each board's sealing. After both windows
  and archival, unclaimed money expires into the next pot, not revenue.
  `ladder_points_are_credited_once_per_claim` and
  `sbf_daily_archive_and_close_return_only_rent_to_cadence_funding` guard claims and root-gated closure.
- **Composed entry:** prepend at most two claims proven claimable by the client's reads, then entry in the
  same transaction. Stale claimed/expired positions are no-ops, without preflight or retry.
  `EntryComposesAtMostTwoProvenClaimsAndNoOpClaimsNeverRetry`,
  `ArcadePreparesDelegatesAndRequestsOpeningVrfWithUnavailableOptionalClaims` and
  `ClaimRejectsWrongBoardOwnerThenUsesClaimedBitmapOrFreshArchivalAbsence` guard entry and explicit
  recovery.
- **Protocol economics:** terms are core constants, emitted once. Authority seeding and later deposits use
  the same instruction; `entry_split_is_exact_and_static` and
  `sbf_first_deposit_funds_and_activates_the_first_daily` guard those boundaries.
- **Ladder:** cumulative integer log-rank points pay no money, never decay and run on no timer. They use
  each board's qualified field and accumulate a permanent highest tier.
  `committed_ladder_vectors_match_integer_ln` and
  `ladder_points_accumulate_and_promote_without_consuming_padding` guard arithmetic and progression; native
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
`sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths`.

### Accounts, identity and recovery

Program account sizes, versions and rent come from their Rust owners and codegen.
`target_accounts_fit_normal_solana_account_limits`, `account_sizes_and_maximum_board_rent_are_explicit` and
`fresh_bootstrap_interface_is_locked` pin the interface. Daily content and timestamps derive from day ID; an
ActiveRun retains its rules snapshot. `daily_window_is_derived_at_epoch_and_u32_day_bounds` and
`DailyWindowUsesTheCoreAcrossTheFullDayRange` guard clocks. Authority rotation and team destination changes
require a program upgrade; the interface lock excludes runtime setters.

PlayerState keeps separate Score/Theme best paying rank, wins and rewards; non-paying places do not become
profile records. Kredit balance, ladder total/highest tier, lifetime best daily score and streak remain
distinct. Reserved bytes stay zero. `competition_record_counts_only_prize_results` and
`ladder_points_accumulate_and_promote_without_consuming_padding` guard those fields. Featured emblem and
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

Each run and ArenaPlayer returns rent to its stored payer, even from another device.
`a_closed_run_returns_rent_to_its_payer` and `a_closed_arena_player_returns_rent_to_its_payer` guard
refunds. `sbf_cadence_funding_can_prepare_a_missing_post_launch_daily` and
`cadence_funding_creates_exact_boards_through_the_full_capacity` guard the two cadence rent paths. Full
board rent is funded at finalization; construction adds no funding or extra write plan. The cadence signer
is not a general fee sponsor.

Base, Router and resolved ER connections stay separate. Resolve placement through `getDelegationStatus`.
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
`SlidersAndSwitchesUseIndependentLevelsAndRememberOnlyThisSettingsMount`.

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
unity/tools/build.py owns imports, fixtures, builds and money dependency locks.
`test_money_lock_update_requires_both_resolved_modules` guards lock replacement. Services and tools/chain
share one workspace and configuration; `workspace_has_one_dependency_and_configuration_owner`,
`keeper_and_operator_share_chain_identity_and_launch_day_bounds` and
`workspace_build_loads_keeper_idl_and_native_rules_offline` guard configuration and build imports.

### Keeper and archival

ProtocolConfig advances a sequential result root from launch day. Daily closure requires root coverage;
`archive_is_strictly_sequential` and `sbf_daily_archive_and_close_return_only_rent_to_cadence_funding` guard
it. The ledger is the archive; indexing is a separate deployment decision. The keeper has no inbound HTTP or
notification service; a missed notification never changes a claim window. Notification controls remain
parked; any future notification is only a courtesy.

Cadence prepares, activates or calls `skip_suspended_arena_daily`, finalizes, constructs boards, archives, expires claims and closes
Daily/player accounts. Last-resort recovery finishes deadline runs, commits, consumes or expires unreachable
runs. All thirteen instructions are permissionless; `keeper_allowlist_is_exactly_its_plans`,
`an_expired_orphan_closes_without_period_accounts` and
`a_missed_funding_day_finalizes_after_its_window_and_rollover` guard those plans. Governance stays with the
owner; a keeper outage does not remove player claim authority.

Instruction name, connection and priority have one metadata owner. The core owns day, suspension, pair
decoding and board ordering through WASM/native exports; `materializes every surviving keeper protocol
operation`, `keeps monetary, archive, and cleanup ordering stable`,
`pair_decode_covers_the_product_and_rejects_outside_indices`,
`board_order_uses_metric_then_time_then_owner_bytes`,
`keeper_rule_boundaries_use_the_core_at_day_and_ordering_limits` and
`BoardOrderingUsesTheCoreAtMetricAndTimestampBounds` guard the boundaries.

Writes require explicit enablement and the approved fingerprint of immutable image, keeper key and launch
day; program ID and IDL hash come from the build. `binds the image, keeper key and launch day while
reporting build identity`, `pins loaded secret material to the configured public key` and `keeps writes
fail-closed unless explicitly enabled` guard release identity. RPC checks cover Devnet, HTTPS, owner,
bounded length, discriminator, version and field shape; plans stay in the recent cadence window. `requires
the Devnet genesis and handles an unavailable RPC`, `requires HTTPS outside localhost`,
`keeper_rpc_decoding_rejects_foreign_malformed_and_unbounded_accounts`, `rejects a Router owner mismatch
before using the ER` and `uses the fresh Router location for a write connection` guard transport and
placement.

The loop simulates before relay, reserves simulated spend even after uncertain confirmation, and enforces
general writes, board writes, aggregate recyclable board rent and reserve floor from KEEPER_LIMITS.
`keeper_pass_reserves_write_slots_and_simulates_before_every_send`,
`keeper_simulation_failure_and_reserve_floor_prevent_relay`,
`keeper_spend_is_reserved_even_when_confirmation_is_uncertain`,
`keeper_board_writes_stop_at_the_separate_pass_limit` and
`keeper_board_rent_ceiling_bounds_the_sum_of_finalizations_in_one_pass` guard the limits.

## Operator procedures

Run commands from the repository root; tools/chain/cli.ts owns help and public plan parsing. The frozen
tools/chain/deployment/devnet-v4.json is historical evidence, not release input.
`chain_entrypoints_load_offline_under_tsx` checks offline loading. No command grants mainnet or recurring
keeper authority. The approval boundary above applies to every execution.

- **Deploy plan:** NO_DNA=1 pnpm chain plan deploy --bundle build/chain/deploy.json quotes the frozen SBF
  using public payer/buffer/authority addresses.
  `operator_plan_saves_one_public_bundle_without_loading_a_signer`,
  `deployment_instruction_bytes_and_accounts_match_the_rust_loader` and
  `operator_cli_options_and_exact_amounts_fail_closed` guard planning and the fresh-bootstrap scope.
- **Launch plan:** plan launch binds deployed program, keeper, day and cutoff; it quotes paused
  protocol/vault initialization, cadence funding, two Daily preparations and atomic seed/unpause/activation.
  `plans the full fresh bootstrap and one atomic launch transaction`,
  `operator_release_checks_devnet_and_programdata` and `refuses planning after the exact launch cutoff`
  guard ordering, release verification and cutoff.
- **Top-up plan:** plan top-up uses the public launch bundle and explicit SOL/lamports amounts through the
  program deposit path. `operator_top_up_rejects_seeded_balance_drift_and_a_closed_window` and `routes a
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
- **Keeper release:** NO_DNA=1 pnpm release:deploy builds or selects an immutable image, saves
  build/keeper-release.json, stages disabled writes and deploys. Review its read-only pass and fingerprint
  before separately approving enablement;
  `staged_launch_ready_requires_the_paused_protocol_and_both_unfunded_days` and
  `keeper_release_deploy_saves_the_image_binding_and_disables_writes_before_deployment` guard that order.

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
