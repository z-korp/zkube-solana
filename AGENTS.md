# Agent working rules — zkube-solana

These rules govern coding agents and operators in this repository. They do not
add approval prompts to the shipped product.

`README.md` is the public product and contributor document. Agent rules, the
protocol reference below, and operator procedures live here. Implementation
detail belongs in code comments next to the code. Do not add new Markdown
documents, and do not move approval policy or operator runbooks into `README.md`.

## Agent tooling discipline

- Python tools use `unity/tools/cli.py` to report
  expected failures with the result/log path instead of a traceback.
  Regenerate Unity fixtures with `unity/tools/build.py fixtures --fixture-action generate`, which
  orders native and program producers; do not run writers concurrently.
- Every Unity Editor invocation goes through `unity/tools/build.py`, including
  one-off methods via `exec --method`. One invocation holds the Editor lease
  through its entire operation. A held lease means wait.
  Read the fresh log and completion result before interpreting a nonzero exit;
  verified completion followed by a teardown crash is success with a noisy exit.
  `test_both_test_platforms_share_one_preparation_and_lease` guards the shared
  preparation and lease for EditMode and PlayMode.
- Reuse the session's MCP servers. Stop a wedged server before replacing it and
  report its PID and reason. Report duplicate configuration entries to the owner.
  Request a region or screenshot instead of parsing a multi-megabyte page DOM.
- `/tmp` is RAM-backed. Large scratch work belongs in ignored `build/`, and is
  removed when its step finishes. Never extract packages into `/tmp`; retain
  only scratch data still needed by active work and explain what is kept.

## Deployment status — read this first

Android builds are local validation artifacts by default. A production candidate
requires an explicit version code and non-debug signing;
`test_production_packages_require_explicit_version_and_non_debug_signing` and
`test_production_without_version_fails_before_toolchain_work` guard that label.
`test_toolchain_checks_android_targets_and_bundletool_first` checks prerequisites
before native compilation or Editor work.

**There is no live deployment.** The v4 Devnet protocol was deliberately
abandoned on 2026-08-08 and its accounts, pools, keeper release, and launch
bundles are dead. Nothing on chain is authoritative, nothing needs preserving,
and no migration path exists or should be written. The next deployment is a
fresh bootstrap of v5 and requires its own exact approval.

Every keeper release fingerprint, launch-plan fingerprint,
and recurring write authority approved before that date is void. None of them
carries over.

Source implements v5 partially. Current state:

| Area | Status |
| --- | --- |
| Deterministic core 1.0.0 | Built — `objective_total`, constraint-latched Campaign stars, capped reroll inventory and grants, harmonic payout width, and the cycle-keyed realm × objective draw |
| Program surface | Built — 30 instructions and 7 account types; Arcade-only run lifecycle and one Campaign save write |
| Entry accounting | Built — 9,000,000 lamports to the following Daily, 1,000,000 directly to the team destination at purchase |
| `PlayerState` | Built — 206 bytes; the player's reported Campaign stars, separate Score and Theme Daily records, Kredit balance, ladder total and highest tier, worn ladder border, entry streak, and 18 reserved bytes validated as zero |
| Daily settlement | Built — exact-sized Score/Theme board accounts, verified chunk construction, direct claims, auto-claim on entry, per-board thirty-day expiry from sealing, and exact rollover |
| Kredits and Daily draw | Built — prepaid purchase/spend paths and protocol-derived realm × objective selection |
| Points ladder | Built — integer Q64 `ln` in the core, streak-neutral points applied atomically with each Daily claim |

## Product truth

- The Unity client ships two Android identities (owner scope decision,
  2026-09-09): `com.zkorp.zkube` (**zKube: Arena**) targets the Solana dApp Store
  and Seeker; `com.zkorp.zkube.store` (**zKube: Realms**) targets Google Play as an
  AAB with arm64-v8a and x86_64. The store identity starts with the name Player,
  editable in Profile, plus a UTC Daily and native-billing Campaign unlock.
  `StoreStartsWithDefaultNameAndEditsItInProfile` guards immediate play and naming.
  Solana assemblies and wallet plugins are excluded from the store package.
  Unity is the only client; all gameplay uses the Rust core over the FFI. The wallet, Kredit and on-chain rules below govern the money
  identity. Do not start iOS work on this Linux machine.
- The connected Solana address is the player identity. There are no embedded
  wallets and no recovery codes.
- Campaign runs locally through the shared local run client in both Android
  identities. The money identity requires a connected address only; the store
  identity uses no wallet. Local lifetime-best stars are authoritative for play,
  and the money identity synchronizes them through the compact on-chain record.
  `money_campaign_needs_an_address_and_no_session` guards address-only play.
  Campaign remains free on the money identity and does not gate Arcade.
  Realms 4–10 retain the store purchase policy;
  `store_gate_is_a_store_identity_policy_over_shared_progression` guards it.
- Entries are prepaid as Kredits at exactly 0.01 SOL each. A Kredit is one-way:
  no withdrawal, transfer, or cash-out. The owner funds the balance and a device
  session may spend within it, which is an owner-set spending cap rather than a
  removal of the owner-signature boundary. A Kredit is never granted,
  discounted, or bundled as a bonus, so every entry contributes identical
  lamports and no entry dilutes another.
- Spending a Kredit routes 9,000,000 lamports to the following Daily and
  1,000,000 to operator revenue. The operator share goes directly to the protocol team destination at purchase, so the
  credit vault holds prize money only. Nothing is withheld from a daily pot for
  any other purpose, and no entry can increase the pot it competes for.
- The Daily pot splits Score 50% and Theme 50% over the same runs. Both boards
  require a positive metric to qualify. Payout weights are proportional to
  `1/rank` and a board pays down to the last place still meeting the entry
  price, floored at four places, with trailing zero-lamport places dropped.
  Payouts floor to 0.001 SOL and dust rolls forward.
- Settlement is claim-based. Each board's reward stays claimable for thirty
  days from that board's sealing and then expires into the next daily pot,
  never into operator revenue.
- Entries remain open until the single 23:59 UTC freeze. At that time a run with an accepted action
  scores its last committed state; an untouched or unrecoverable run expires and
  can never score late.
- Daily content is the fixed product of ten Campaign realms and sixteen
  protocol objectives, not a calendar or mutable catalog. Each day draws one
  pair by an independently recomputable selection; dailies may be suspended at
  any time. The ladder is cumulative log-rank
  points, pays no SOL, never decays, and resets only by an announced decision.
  Neither mode grants SOL, entries, prize eligibility, or mint odds.
- The owner funds the device session's recyclable fee-and-rent allowance
  directly. A separately seeded System-owned zero-data
  cadence funding PDA recycles Daily account rent after the on-chain archive
  root in ProtocolConfig commits each finalized result. The cadence funding PDA
  signs only the System account-creation calls in prepare_arena_daily and
  finalize_arena_daily; `sbf_cadence_funding_can_prepare_a_missing_post_launch_daily`
  and `keeper_allowlist_is_exactly_its_plans` guard the boundary.
  There is no Kora or generic paymaster.
- Arcade retains its durable run slot and monotonic run-ID sequence for
  cross-device recovery. An unfinished Campaign trial stays on its own device
  as a seed and accepted action log; `local_campaign_run_survives_process_death`
  guards recovery through the core in both identities. A player can play one
  local trial alongside an Arcade run. Base, Router, and resolved ER connections
  remain separate; resolve ER placement with `getDelegationStatus`.
- Fly runs only the independently funded Daily keeper, which has no inbound
  HTTP surface. The Unity client has no server signer.
  There is no keeper push stack. Client notification controls remain parked;
  a reward is collectable in the app for thirty days regardless, so any future
  notification can only ever be a courtesy.
- Mainnet requires counsel, economic, and distribution review. Nothing in this
  document authorizes it.

## v5 specification

Approved 2026-08-08. This is the specification the source is being built
towards; the table under "Deployment status" says which parts exist today. Where
this section and any older statement elsewhere in this document disagree, this
section wins — report the contradiction rather than following the older text.

Specification approval is not implementation, deployment, rules-change, or
economics approval; each of those still requires its own exact enumerated
approval under the transaction policy below.

Three deliberate reversals of earlier product truth — a persistent ladder, a
purchasable soft currency, and claim-based settlement — were reviewed together
and approved on 2026-08-08.

**Campaign amendment approved 2026-09-15.** The owner reversed the on-chain
Campaign lifecycle because a free mode was spending owner SOL and requiring a
funded device session. Campaign gameplay now runs locally, while the existing
25-byte lifetime-best star array is the player's Campaign save, written by their
own device and synchronized across their devices. The program does not verify
this progress, and it has no effect on money. Emblems 1–12 reflect that reported
progress; `emblem_unlocked` keeps its existing star gate.
`sbf_featured_emblem_accepts_owner_and_only_unlocked_campaign_badges` guards
that unchanged gate. Daily, Kredits, boards, claims, the ladder, and keeper
cadence retain their rules.

On-chain replay verification was measured at 1,757,716 CU for a worst-case level
on 2026-09-15 and rejected as a lifecycle rebuilt for a cosmetic.

The amendment adds one instruction and one 25-byte argument. It removes the
three Campaign lifecycle instructions, one run slot, the content accounts, and
16 Campaign-only bytes from `ActiveRun`; removing its mode byte subsequently
leaves 338 bytes. Removing the content
accounts also removes their two publication/activation instructions: five
instructions removed in total. The interface contract
`fresh_bootstrap_interface_is_locked` and
`target_accounts_fit_normal_solana_account_limits` pin the current surface after
the cleanup below.

**Program cleanup approved 2026-09-15.** The wallet address remains the money
identity; the unused label account and its two instructions are removed.
The interface test above pins their absence. Daily accounts retain the rules
hash and derive their content and window from the day identifier; only the
active run holds a rules snapshot.
`sbf_device_paid_entry_spends_a_kredit_and_resolves_both_paths` guards that snapshot.
`program_and_core_score_one_action_identically`
guards reconstruction, while `daily_window_is_derived_at_epoch_and_u32_day_bounds`
and `DailyWindowUsesTheCoreAcrossTheFullDayRange` guard the shared clock rule.
`account_sizes_and_maximum_board_rent_are_explicit` pins the 133-byte Daily.
The player account version is 3; the shared protocol account version is 6.
Generated protocol constants and the interface test guard these fresh-bootstrap
layouts. `target_accounts_fit_normal_solana_account_limits` pins the 151-byte
protocol account. Protocol state owns suspension, launch day and the rolling
Daily root; `archive_is_strictly_sequential` guards the root sequence.

**Board construction amendment approved 2026-09-16.** The CPI growth limit was
found on 2026-09-16; no earlier test covered board creation above 120 rows.
Finalization funds the exact final rent and existing chunk writes grow into it.
`cadence_funding_creates_exact_boards_through_the_full_capacity` guards allocation
and construction at the full capacity.
`full_board_finalization_stays_below_one_million_compute_units` guards the
1,000,000-CU ceiling for finalizing both maximum-width boards.
`optimized_payouts_match_the_original_at_every_supported_width` compares widths,
denominators, every payout, rounding and rollover against the former arithmetic;
the payout golden vectors remain unchanged. The former full-board path cost
4,159,542 CU. The optimized path measured 955,402 CU for the same pot and
956,187 CU for the near-maximum u64 pot, including both 1,536-row boards.
The compute test above pins the ceiling for future changes.
This changes neither the recyclable rent
ceiling nor the keeper write counts: full rent is paid at finalization, with no
additional funding or writes during construction.
`account_sizes_and_maximum_board_rent_are_explicit` and
`keeper_allowlist_is_exactly_its_plans` pin those costs and the existing plans.

**The systems below are locked. The balance is not.** Every structural rule in
this section is settled and is not to be relitigated without an explicit new
approval. Deliberately deferred to a separate balance pass, and safe to leave
open: the global pressure step and score multipliers,
ladder tier boundaries, and the flat qualifying credit.

- **A Daily is one realm plus one objective, and there is no calendar or content
  account.** The ten Campaign realms supply guardian and starting-height rules;
  sixteen protocol objectives include Classic and the shared cumulative
  constraint facts. The fixed 160-pair product replaces authored Daily entries,
  revisions, publication instructions, and their notice window. There are no
  sets, seasons, gauntlets, or scheduled boundaries of any kind.
- **The draw is derived, never chosen.** The protocol-fixed seed and absolute day
  identifier drive one without-replacement Fisher–Yates permutation over the
  realm × objective product. Every pair appears once in each 160-day cycle and
  changing the table requires a program release; neither the operator nor VRF
  can select a day. Selection must be independently recomputable;
  `daily_draw_is_reproducible_from_seed_and_day` guards the core and client
  boundary.
- **Instant suspension is an explicit governance boundary.**
  `ProtocolConfig.suspended_until_day` is set by `set_arena_suspension`; a prepared
  funding day below it can only move its full funded ledger once into the first
  eligible prepared successor through `skip_suspended_arena_daily`, then closes
  to cadence funding. Suspension cannot consume a Kredit or strand prize money,
  and it never re-maps a later day. The SBF contract
  `a_suspended_day_is_skipped_once_and_its_funding_reaches_the_next_scheduled_day`
  guards the transition.
- **Tomorrow's daily is not published, and the client shows no hint of it.**
  Reversed on 2026-08-10 after the surface was built twice and cut twice. The
  Campaign bridge it was supposed to restore does not survive contact with the
  draw: tomorrow's realm is derived independently of progress, so the one
  actionable thing it offered — practise that realm today — sends a player who
  has not unlocked it to a locked screen. The keeper still prepares the
  following Daily and its pair is derivable from code and day; nothing renders
  it. Do not reintroduce a tomorrow panel, an evening hook, or an
  ambient hint. Suspension notice is unaffected: the operator's per-day veto
  above depends on suspension needing no notice, never on publication.
- **Difficulty has one protocol-owned tier table.** Codegen emits
  `TIER_BLOCK_WEIGHTS` from the fixture's single `difficultyWeights` table; a
  Campaign level at tier N and a Daily at pressure tier N draw from exactly the
  same row. No account, level snapshot, or run snapshot stores block weights;
  `CampaignAndDailyQueriesUseTheRustProgressionAndCatalogOwners` and the codegen check guard the
  boundary.
- **Daily pressure is one uncapped score ramp and one clamped draw table.** The
  pressure tier is `pressure_score / 15`, its action multiplier is
  `1.0 + 0.5 × tier`, and only the block-row lookup clamps the tier to the
  authored table's top row. Objective increments never feed pressure. Every
  selected pair uses that formula and the fixed 100-move limit; there is no
  authored threshold array, multiplier array, or per-content pressure copy.
  `pressure_multiplier_is_uncapped_and_the_draw_clamps_at_the_top_row` guards
  the boundary.
- **A realm has one guardian rule in both modes.** `Guardian { bonus, trigger,
  threshold }` is the complete realm-specific gameplay rule, and the same
  bytes reach Campaign and Arcade. Scoring is triangular action score alone,
  multiplied only by the Daily pressure tier; no realm-specific scoring field
  or mode exception exists. `campaign_and_daily_share_guardian_rules` and
  `triangular_scoring_is_guardian_neutral_for_moves_and_bonus_actions` guard
  the boundary.
- **Trigger thresholds exist only when the trigger reads one.** Line,
  exact-line, combo-count, block-burst, and clearing-move-streak triggers carry a
  positive threshold. The all-block-sizes trigger carries zero because its
  condition is complete without an authored number. Perfect clear is not a
  guardian trigger; it remains a Campaign constraint fact and the Arcade reroll
  grant.
  `bonus_trigger_threshold_is_valid` is the shared core/program constraint, and
  the codegen drift check binds the compiled client catalog to the
  core-validated fixture. Types 3 and 5 are unsupported;
  `trigger_threshold_semantics_are_exhaustive` guards the sparse tag set.
- **Guardian inventories start empty in both modes.** Starting height comes from
  the drawn realm in Daily and the same compiled realm in Campaign; Hammer,
  Totem, and Wave charges are earned only by firing that guardian's trigger.
  `campaign_seed_is_fresh_per_attempt_and_replays_on_resume` in both identities and
  `daily_runs_start_without_guardian_charges` guard the two constructors.
- **Dailies may be suspended at any time and for any length.** Nothing obliges a
  daily to run. Prepaid funding spans any gap untouched: the last paid day funds
  the next paid day whenever that arrives, so a pause never strands a pot and
  the return is funded by the departure.
- **The Daily pot splits across two boards over the same runs**: Score 50% and
  Theme 50%. One entry places on both. Score ranks `daily_score`. Theme ranks
  `objective_total`, the uncapped sum of the drawn `ConstraintKind`'s shared
  per-action increment. Campaign primary progress uses the same increment but
  caps it at its authored required count. Clutch and Clean clears are cumulative
  height-conditioned action facts; Survival and exact-one clears are not
  objectives. `daily_objective_is_the_shared_kind_increment` and
  `every_constraint_kind_reads_its_declared_action_fact` guard the vocabulary.
- **Theme is not Score.** `daily_score` is triangular action points;
  `objective_total` is a count attributable only to the day's fact and is never
  added to score or pressure. A player clearing carelessly wins Score; a player
  who pursues the fact wins Theme. `theme_total_is_not_added_to_score` guards
  the independent totals in the core.
- **Classic pays 100% to Score, and that is derived rather than configured.**
  The Classic theme is the absent constraint kind and yields zero objective
  increments, so its theme
  total is always zero and the theme half folds back into Score. No family
  needs a special case.
- **A board requires a positive metric to qualify.** Score ranks only runs with
  `daily_score > 0`; Theme ranks only runs with `objective_total > 0`. Without
  that gate a large share of the field ties at exactly zero — anyone who never
  satisfied the day's objective on Theme, anyone who never scored on Score —
  and the earliest-finalized-then-wallet-bytes tiebreak would pay for byte
  ordering rather than for play. The two boards therefore have different
  qualified-winner counts on most days, which the width rule already handles by
  renormalizing across occupied weights.
- **A board never reports a winner it pays nothing.** After rounding, any
  trailing zero-lamport place is dropped from the winner count. Those lamports
  were already rollover, so this changes no payout — but under claim-based
  settlement a zero-value place is a claim a player would pay a transaction fee
  to collect nothing from, which is the exact outcome the width rule exists to
  prevent.
- **Payout width has no arithmetic cap, while the retained board has an explicit
  systems bound.** The entry-price rule computes the full width and denominator
  without narrowing rank or winner count to a byte. `ARENA_BOARD_CAPACITY`
  bounds the on-chain rows and payable places; if the width exceeds it, the
  finalized result records that condition and the dropped shares are
  rollover without renormalization.
  `cadence_funding_creates_exact_boards_through_the_full_capacity` exercises
  allocation at `ARENA_BOARD_CAPACITY`;
  `full_board_finalization_stays_below_one_million_compute_units` pins its compute
  ceiling. The former test also fills `ARENA_BOARD_CHUNK_CAPACITY` on each full
  write and asserts exact growth with compute below 200,000 CU.
- **A reroll is an accepted action.** It increments the action counter and
  folds its own replay event, so a run holding a pending or completed reroll
  and no move is scored rather than expired; deterministic resolution when the
  reroll output never arrives matters more than the empty row it can produce.
  Such a run scores zero on both metrics, so the positive-metric gate above
  keeps it off both boards.
- **Payout width is a rule, not a count.** Board weights are the plain harmonic
  series `1/rank`, and a board pays down to the largest place count whose last
  payout still meets or exceeds the entry price, floored at four places. The
  harmonic weight is exact integer division — no fixed-point root, no
  approximation, and no large-rank underflow edge.
  Existing renormalization, the 1,000,000-lamport payout floor, and dust
  rollover are unchanged.
- **One row per player per board, and entries per player are never capped.**
  A row carries that player's best qualifying run, so rank one is a ceiling
  however much anyone spends and every other paid place necessarily belongs to
  somebody else. That is what makes the curve self-limiting: a take is bounded
  by rank one while a contribution scales linearly with entries, so a player
  holding share `s` of all entries stops profiting above `s = 0.9 / H_W` for a
  board of width `W` — 43% at the four-place floor, 12% at 1,176 places. Whaling
  therefore gets less attractive as the field grows. Do not add an entry cap: it
  would bind only honest players, since twenty wallets at five entries each
  defeats it, and it would suppress pot growth exactly where pot growth is
  scarcest. Do not make every entry place separately either — a take would then
  scale with entries and no break-even would exist.
- **Settlement is claim-based without an off-chain proof dependency.**
  Finalization funds the exact rent for each finalized Score and Theme board
  width, initially allocating its header and claimed bitmap. Each chunk grows
  the account by exactly its submitted rows; construction cannot exceed the
  finalized width and sealing requires the exact final data length.
  `cadence_funding_creates_exact_boards_through_the_full_capacity` exercises
  120, 121 and 1,536 rows on both boards and rejects short, oversized and
  over-width construction accounts;
  `sbf_board_chunks_verify_rows_cursor_and_program_computed_sealing_on_both_boards`
  guards row validation, ordering and the construction cursor.
  The keeper submits at most ten sorted rows per write, and the program
  verifies every row against its `ArenaPlayer`, enforces ordering and uniqueness
  across the persisted cursor, and seals only the program-computed count. Claims
  remain disabled until sealing, then locate the owner's position and recompute
  its payout directly. A dynamic claimed bitmap lives beside the
  rows in each board account. An explicit claim supplies its board position to
  the single `claim_daily_prize` instruction; there is no account-scanning
  public claim variant. A claim of an already-claimed or expired position is a no-op.
  Unsealed boards still reject. `ladder_points_are_credited_once_per_claim` guards
  that position-addressed settlement boundary, including unchanged accounts for
  both no-op outcomes. A reward stays claimable for **thirty days from
  its board's sealing**; after archival and both independent windows, unclaimed
  rewards expire into the next daily pot, never into operator revenue.
- **Spending a Kredit settles what that player is already owed.** The client
  prepends up to two eligible claim instructions in the same transaction as
  entry, skipping boards it cannot prove claimable from its reads.
  `EntryComposesAtMostTwoProvenClaimsAndNoOpClaimsNeverRetry` checks selection,
  instruction order and a single submission when attached claims are no-ops;
  `ArcadePreparesDelegatesAndRequestsOpeningVrfWithUnavailableOptionalClaims`
  checks entry when optional claims are unavailable. Another device claiming
  first or the window passing does not interrupt entry;
  `ladder_points_are_credited_once_per_claim` guards both no-op outcomes.
  Explicit claiming and expiry into the next Daily pot remain available.
  `ClaimRejectsWrongBoardOwnerThenUsesClaimedBitmapOrFreshArchivalAbsence`
  checks explicit-claim recovery for claimed, expired and removed boards.
- **Protocol economics are code, not mutable account terms.** The entry price
  and its Daily/operator split are core constants emitted to clients by
  codegen; `ProtocolConfig` stores no second copy.
  Authority funding uses the single `deposit_arena_daily` instruction for both
  launch seeding and later deposits. `entry_split_is_exact_and_static` and
  `sbf_first_deposit_funds_and_activates_the_first_daily` guard those boundaries.
- **The ladder is cumulative log-rank points, pays nothing, and runs on no
  timer.** A player who placed on a board scores
  `floor(50 * ln(qualified_entrants / rank))` for it, where the denominator is
  that board's own qualified count rather than the day's entries. Both boards
  sum, the total accumulates forever and never subtracts. It does not decay. Its
  payoff is cosmetic: a named tier shown beside the player's identity on every
  leaderboard, and never a money path.
- **The ladder pays for qualifying and again for placing.** Qualifying on a
  board earns a flat credit, and placing on it earns the log-rank amount above.
  Both halves are required: a board materializes only payout-bearing rows, so
  the log-rank half alone would reach a share of the field that *falls* as the
  game grows — under six percent per board at twenty thousand entries — leaving
  the ladder unable to do the one job it has. Do not widen a board to carry
  non-paying rows; at 84 bytes a row that is megabytes of account and multiple
  SOL of daily rent for a system that pays nothing.
- **The flat credit is awarded once per player, per board, per day, by
  construction.** It rides the same first-qualification transition that already
  increments the board's qualified-player count when a result is recorded, so it
  needs no new instruction, no new idempotence marker, and no coupling to
  `ArenaPlayer` cleanup. It is never per entry: buying twenty entries
  earns it exactly once, so the ladder cannot be bought. Its value is balance
  and belongs in a named constant.
- **The consecutive-entry streak is visible attendance, not a points
  multiplier.** It counts days carrying at least one paid entry, so a second
  entry the same day never advances it and a missed day restarts it at one. It
  remains on the profile and share card, but must never alter either the flat
  qualifying credit or log-rank points;
  `the_visible_streak_does_not_change_ladder_awards` guards the boundary.
- **Elo was cut on 2026-08-09, and log-rank replaced it rather than standing in
  for it.** Elo's one advantage over a running total is that a rating can fall,
  and the no-decay rule had already removed that; a rating also rewards playing
  well whenever a player happens to appear, where a total rewards appearing.
  Log-rank additionally closes the hole a plain percentile would open — rank one
  of a thirty-player board is 170 points against 425 for rank one of five
  thousand, so farming the quietest days does not pay. Do not reintroduce Elo,
  a keeper-computed rating, a published commitment hash, or a K-factor.
- **The ladder is computed on chain, not by the keeper.** Points are a pure
  function of a sealed board, so the Daily claim that recomputes a rank from its
  board position adds them in the same instruction, riding the claimed bit for
  idempotence.
  Integer Q64 `ln` lives in `zkube-core` with its own golden vectors because the
  value must be identical in native Rust, WASM, and the program; floating point
  is prohibited there as everywhere else in the payout and metric paths. Points
  may never be added twice: `ladder_points_are_credited_once_per_claim` guards
  the atomic payout-and-profile transition. A failed claim changes neither.
- **A ladder reset is a decision, not a date, and is always announced weeks
  ahead.** A reset compresses totals toward the mean at roughly k=0.6 rather
  than wiping, and a player's highest tier ever achieved is permanent on their
  profile. Never reset by surprise: a ladder that might vanish at any moment
  cannot be climbed toward, and one that never resets entrenches the top so
  newcomers cannot climb at all.
- **A championship is discretionary and unscheduled.** When one is run it is
  contested by the ladder's top finishers and funded separately from operator
  revenue; no lamports are escrowed or withheld from daily pots for it, so it is
  a marketing commitment rather than an accounted prize balance. Its amount, or
  a public formula over already public data, must be stated when it is
  announced and never settled afterwards. Funding it is a governance action
  requiring exact approval like any other operator spend.
- **Reroll is a universal run action beside the guardian bonus.** Each run
  begins with one reroll and holds at most three; a perfect clear grants one in
  either mode. Spending one replaces the
  next preview without consuming or changing Hammer, Totem, or Wave charges.
  It is never a guardian bonus type, a wildcard realm, or a second pairing on a
  map. The replacement consumes an additional VRF output and folds into the
  replay commitment as its own event under a distinct domain separator. The
  core `perfect_clear_grants_or_discards_at_the_reroll_cap`, program
  `reroll_request_is_an_accepted_action_that_awaits_its_own_vrf`,
  `sbf_reroll_request_callback_and_deadline_resolution_match_the_golden_vector`,
  and source supersession guard enforce the inventory and split.
- **A Kredit is never granted, discounted, or bundled as a bonus.** Every Kredit
  in existence was bought at the same price, so every entry contributes the same
  lamports and no entry dilutes another. Larger packs carry cosmetics only. Free
  and airdropped Kredits, bulk bonus Kredits, and per-unit bulk discounts are
  all prohibited on the paid boards — a discount reduces the per-entry
  contribution and is the same dilution wearing a different label. Unpaid
  prestige boards are the only place an unbacked entry may exist. The shipped
  shop offers packs of exactly 1, 10, and 25 Kredits; `OneKreditButtonUsesTheOwnerPurchaseAndConfirmedBalance`
  guards both the sizes and their invariant unit pricing.

Superseded on implementation, and only then: the Weekly pot and its 60/25/15
skill boards, the Season pot and its 100/60/30/10/2 band table with rank caps,
the 45/25/15/10/5 Daily and Season curve, push-only settlement, per-entry
lamport splitting, and the Product truth statements ruling out soft currencies,
deposits, prize claims, and ratings; positive thresholds on all-block-sizes
triggers; perfect-clear guardian triggers; a two-request perfect-clear
continuation; a stored or publisher-supplied Daily selection seed; per-entry
Daily difficulty bands; and
Score-threshold bonus triggers. A five-Kredit shop pack and per-realm scoring
pairing are superseded too, as is the ladder streak multiplier. Reroll as a
fourth guardian bonus type, wildcard Daily realms, and multi-bonus map pairings
are also superseded. Authored Daily entries and their rules catalog, revision
window, objective multiplier, separate objective enum, Survival and exact-one
themes, and starting guardian charges are superseded as well.

## Transaction policy

- The Devnet deployment fee payer is the read-only keypair at
  `/home/djizus/cycling-sim/.devnet/deployer.json`, public key
  `7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA`. Never copy, modify, expose,
  delete, or commit it.
- Never sign or send a transaction without explicit approval for exact
  instructions, accounts, signers, cluster, and spend. A short `I approve` is
  valid only when it directly answers the immediately preceding single
  enumerated bundle and no detail has drifted.
- **No recurring keeper authority currently exists.** Every fingerprinted
  release approved before 2026-08-08 died with the abandoned deployment. A new
  one requires a separately approved fingerprinted release enforcing Devnet
  genesis, exact signer, current/recent cadence PDAs,
  canonical instruction allowlist and the two runtime write ceilings,
  0.1 SOL simulated spend per pass, and a 0.1 SOL reserve floor. The schema-1
  source release currently declares six general writes, thirty-two
  board-construction writes, and at most 1,802,194,560 lamports of recyclable board rent per
  pass; those numbers are a proposal until approved, not inherited permission.
  `keeper_allowlist_is_exactly_its_plans`,
  `keeper_pass_reserves_write_slots_and_simulates_before_every_send`,
  `keeper_board_writes_stop_at_the_separate_pass_limit` and
  `keeper_board_rent_ceiling_bounds_the_sum_of_finalizations_in_one_pass` guard
  the instruction and spending boundaries.
- Governance, initial competition seeding, manual reimbursement, terms/rules
  changes, funding, withdrawals, deployment, initial keeper enablement, and all
  mainnet actions remain outside recurring authority and require exact
  approval.
- Automated verification is offline. Prefix every Solana, Anchor, and pnpm
  chain command with `NO_DNA=1`.
- Never expose signer bytes, seed phrases, `.env` contents, keeper secrets,
  Android credentials, or the ignored v4 program keypair.

## Worktree and chain-data discipline

- Preserve unrelated and in-flight changes. Never use destructive restoration
  or blanket cleanup. Use `apply_patch` for edits and `rg` for discovery.
- `/home/djizus/zkube` and `/home/djizus/cycling-sim` are read-only references.
- Treat RPC data as untrusted: verify cluster genesis, owner, bounded length,
  discriminator, PDA seeds, and account relationships before decoding.
- Preserve `ActiveRun` until copied-back terminal state is consumed, or until a
  deterministic expiry resolution and orphan reservation prevent late scoring
  and permit safe cleanup.

## Versioning

`zkube-core` starts at `1.0.0`. It is not published and has no
independently-upgrading consumer during fresh-bootstrap development: the program,
keeper, and client move in one commit, so the compiler is the compatibility
check. Do not bump it per change or per phase. The `coreVersion` assertion in
the fixtures only fires when the version moves and the vectors are not
regenerated; the golden vector values catch logic changes. Keep `1.0.0` until a
deployment or a genuine compatibility boundary requires a version change.
Protocol identity is carried by the account versions and keeper release schema;
those numbers must stay truthful.

## Validation gates

Validation is one local command, and every change ends with it green:

```bash
NO_DNA=1 ./validate.sh
```

`validate.sh` is the single authority on what the gates are — do not restate
its contents here or anywhere else. It defaults to the full suite; `program`
and `tools` scopes exist for iteration, but the full run is what finishes
a change. A red gate is a defect that outranks whatever work surfaced it.

The root package owns the Node dependencies, lockfile, lint, TypeScript and test
configuration for services and operator tools;
`workspace_has_one_dependency_and_configuration_owner` guards that boundary.
`shared/chain.ts` supplies their program identity, genesis, default RPC and launch
day parsing; `keeper_and_operator_share_chain_identity_and_launch_day_bounds`
checks the shared values and input limits. The compiled keeper carries the
checked-in IDL and native rules;
`workspace_build_loads_keeper_idl_and_native_rules_offline` checks those imports.

Start with `README.md`, then inspect `state`/`instructions` for contract work,
`services` for keeper work, and client chain/platform boundaries only when the
client is explicitly in scope. Never infer deployed state from source.

## Standing defect rules

Bugs are fixed with their class, never alone: before patching, name the
recurring source it is an instance of, and close that source in the same
change. The known sources and the guard for each:

- **Unrun gates.** Every change ends with `NO_DNA=1 ./validate.sh` green.
- **Untested bounds.** Every program capacity has SBF allocation and compute
  tests at its maximum; `every_program_capacity_has_an_sbf_test_at_its_maximum`
  inventories the capacity constants and both executable boundary guards.
- **Divergent mirrors.** One rule lives in one place. A document points at
  the script or constant rather than restating it, and a second
  implementation of the same rule is merged into the first. Cross-layer
  pairs that must stay hand-synchronized — reconciliation plan and keeper
  policy, core event and program producer, deployed config and release
  policy — each carry an agreement test that fails when they drift.
- **Superseded vocabulary.** A reversal deletes the dead model's code, copy,
  and comments in the same change, and adds its phrases to
  `services/tests/supersession.test.ts`. A reversal without a sweep is
  incomplete.
- **Derivable arguments.** An instruction never trusts an argument the
  program can compute itself: it verifies equality or does not take the
  argument.
- **Unanchored spec sentences.** A normative "must/never" sentence added to
  the v5 specification names, in the same change, the test or constraint
  that enforces it.
- **Trajectory-shaped invariants.** An invariant encodes the specified rule,
  including announced future transitions such as a ladder reset or a claim
  expiry — never the shape the data merely happens to have today.

## Design rules — KISS and systemic design

Simplicity is a requirement, not a preference. These rules apply to systems,
balance, content, code, and copy alike.

- **A system earns its place or it goes.** Every mechanism, field, instruction,
  setting, and screen must serve a purpose a player or operator can feel. One
  that serves no real purpose, or adds complexity without adding fun, is cut
  rather than tuned, documented, or defended.
- **Success of systemic work is deletion.** Prefer removing a rule to adding a
  special case. A change that adds a flag, a mode, or a configuration value
  where deleting a rule would do is the wrong change.
- **Name the cost before adding.** A new system states what it replaces and
  what it costs — accounts, instructions, bytes, tests, keeper writes, copy —
  in the same change. If nothing is removed, the change says why that is
  acceptable.
- **Tune inside systems; challenge systems with evidence.** Balance and
  content are tuned within a system's rules. A system itself is challenged
  with a measurement or a gameplay test, never with taste alone. Cutting or
  reshaping a system the v5 specification locks requires the owner's explicit
  approval and amends the specification in the same change.
- **Smallest change that closes the class.** No speculative generality, no
  configuration for cases that do not exist, no abstraction with one caller.
  This is the companion of the Standing defect rules above: fix the class,
  with the least mechanism that does so.

## Protocol reference

`README.md` states the product-level rules. This section holds the exact
behaviour agents must preserve.

### Accounting

Superseded in full by the v5 specification above. Entry routing, the two daily
boards, payout width, claim settlement, and rollover are defined there and
nowhere else. The v4 rules this section used to carry — a four-way entry split,
Weekly and Season pots, the 45/25/15/10/5 curve, and push settlement — describe
a protocol that no longer exists in source or on chain.

Two invariants survive unchanged and are not restated above:
`entries_scored + entries_expired == entries_paid`, and the rule that a paid
entry has no refund or claim-back path. The operator share is transferred to the
protocol-pinned team destination at purchase;
`purchase_kredits_pays_the_protocol_destination_directly` guards the split and
rejects another destination. Authority rotation and a different team destination
require a program upgrade; the interface lock and supersession sweep guard the
absence of runtime setters.

### Competitions

Superseded in full by the v5 specification above. There are no Weekly or Season
competitions, no skill-metric boards, and no Daily-to-Season band table. One
Daily, split Score and Theme, is the only competition.

The next preactivated Daily still opens at 00:00 even while the preceding payout
pass finishes, so settlement never creates a playable-day gap, and the keeper
still prepares successor accounts before entries open so the client can show the
active guaranteed pot and following-period funding separately.

Leaderboards order by primary metric descending, then earliest finalized
achievement, then wallet bytes.
### Campaign progression

Ten zones of ten levels: 100 levels and 300 stars. The local play record is
owner-address-keyed on the money identity and walletless on the store identity.
Zone unlocked, cleared, perfected, total stars, and badges are derived views.
Only Zone 1 Level 1 starts playable; a later level requires one star on its
predecessor, and a later realm requires one star on the previous guardian.
Completed levels stay replayable. Store purchase policy overlays this shared
progression without changing it or imposing a gate on the money identity;
`store_gate_is_a_store_identity_policy_over_shared_progression` guards that split.

`PlayerState` retains its packed 25-byte, two-bits-per-level array.
`record_campaign_stars` takes the entire array and applies each level's maximum,
using the exact owner-or-device-session authorization of `set_featured_emblem`.
The array is the player's Campaign save, written by their own device and
synchronized across their devices. The program does not verify these stars;
they have no effect on money, and emblems 1–12 reflect that reported progress.
Apart from authorization and account constraints,
only malformed encoding is rejected; all 100 two-bit values are valid.
`campaign_stars_merge_per_level_maximum_and_never_decrease` in the core and
program pins monotonic merging.
`record_campaign_stars_is_idempotent_and_touches_no_other_field` checks repeated
writes, lower values, malformed lengths, authorization, and byte-for-byte
preservation of every other player field in SBF.

On connect, the money identity reads the chain array and merges it into its
local play record. A local maximum above the chain sets a durable pending bit
in that same record. A current funded device session submits the array in the
background; otherwise the next start or device-session enable retries it.
A pending record write never gates play or another transaction;
`campaign_record_write_never_gates_play_or_other_transactions` enforces that
boundary. `campaign_record_retry_survives_restart_and_preserves_newer_stars`
guards the durable retry and acknowledgement, and
`campaign_record_enable_during_pending_attempt_retains_the_retry` guards an
enable request arriving during an existing attempt. No cloud, server, indexer,
or second progress store participates.

Each Campaign attempt draws a fresh 32-byte seed from the platform random
source. The shared local client persists it before the first action and replays the
saved seed on resume; `campaign_seed_is_fresh_per_attempt_and_replays_on_resume`
tests different seeds across two starts and an identical opening after resume
for both identities. Tests can inject a seed for fixture parity.

An unfinished Campaign trial persists its seed and accepted action log before
an action is acknowledged. Reopening replays that log through the core on the
same device; losing the device means replaying the level. Only lifetime-best
stars cross devices. `local_campaign_run_survives_process_death` tests both
identities, and `campaign_action_is_accepted_only_after_durable_write` checks
write failure before acceptance. A connected address is the money player's
identity, while play requires no session, signature, funding, delegation, VRF
request, or chain run account;
`money_campaign_needs_an_address_and_no_session` guards this boundary.

Each level has three independent star sources: score target, primary Shape, and
secondary Blow. A source latches on the action that makes its fact true, in any
order, and one action may latch all three. The level completes when every
authored source has latched; `constraint_stars_latch_in_any_order` and
`constraint_stars_latch_zero_to_three_on_one_action` guard both paths. An absent
constraint is not a source; `absent_constraints_limit_the_earnable_source_mask`
guards the authored mask. Every catalog level carries both constraints, as enforced by
`codegen_enforces_constraint_class_per_slot`.

Every realm shares the ten-level score ladder
`[10, 14, 18, 22, 27, 32, 37, 42, 46, 50]`. A level authors only its tier,
Shape, and Blow; its move budget is the ceiling of its ladder target times the
protocol moves-per-point value for that tier. Neither target nor budget is a
catalog field. `campaign_move_budget_is_derived_from_the_ladder_and_tier`
and `campaign_catalog_rejects_an_authored_budget` guard the core and generated fixture boundaries.

Primary constraints are cumulative facts counted across a run; secondary
constraints are moment facts that must be true on one action. Every authored
primary must use a cumulative kind and every authored secondary must use a
moment kind; `campaign_rules_require_valid_constraint_classes_counts_and_distinct_facts`,
`codegen_enforces_constraint_class_per_slot` enforce the core
and fixture boundaries. The six single-action kinds
`ComboOfAtLeast`, `ComboOfExactly`, `AllWidthsInMove`, `BigMove`,
`BonusLinesInMove`, and `PerfectClear` must carry a count of exactly one;
`Streak` and `BreakInMove` retain their in-action N. These tests guard
that count rule at the core and fixture boundaries:
`constraint_classes_and_tags_are_exhaustive_and_stable`,
`codegen_enforces_constraint_class_per_slot`. Player-facing
constraint language is limited to lines, combos, streaks, breaks, bonus lines,
perfect clears, guardian triggers, and points;
`every_constraint_kind_reads_its_declared_action_fact` pins the engine fact
behind each kind.

Every cumulative primary must carry a count of at least two;
`campaign_rules_require_valid_constraint_classes_counts_and_distinct_facts`,
`codegen_enforces_constraint_class_per_slot` guard that rule at
the core and fixture boundaries. A secondary must never be an
instance of its primary's fact, including the moment fact that is the realm's
own guardian trigger; the same tests guard that rule at the core and fixture boundaries.

A level ends as complete when every authored star source has latched, or ends
incomplete when its move budget or board is exhausted; already-latched stars
are retained and recorded in either terminal state.
`exhausted_runs_keep_latched_stars` guards that core rule. The three-bit
source mask remains one byte in the core Run state codec. Arcade's program
projection omits Campaign progress and latch bytes; `RunEngine::daily` constructs
the core state without Campaign progress. Core Run golden vectors retain their values;
`shared_run_config_and_state_codecs_round_trip_both_rule_shapes` and
`target_accounts_fit_normal_solana_account_limits` pin those boundaries.
Move efficiency and authored star-threshold modifiers are not star sources;
`supersession > keeps reversed models out of authored source` guards the sweep.

### Replay and determinism

`zkube-core` is the deterministic source for grid state, blocks, guardians,
scoring, pressure, period math, payout math, canonical encoding, and
the replay commitment schedule. One mode-agnostic `Run` owns every Campaign
and Daily transition; optional star sources and an optional objective select
only the rules each consumer needs. `one_run_drives_campaign_and_daily` guards
that shared driver. The Arcade Solana lifecycle reconstructs that `Run` for every VRF,
move, bonus, and reroll transition rather than maintaining a second accounting
path; `program_and_core_score_one_action_identically` guards the projection.
`ActiveRun` stores only fields read by a handler, result row, hash, or client
view, and its 337-byte account size is pinned by
`target_accounts_fit_normal_solana_account_limits`.
`ActualManagedNativeCallsMatchEveryTransitionAndTrace` guards the native run
boundary against the core trajectories, `program_and_core_score_one_action_identically`
guards the program projection, and `keeper_rule_boundaries_use_the_core_at_day_and_ordering_limits`
guards the keeper's protocol exports.

Replay v2 binds the chain domain, challenge, rules hash, player, run ID, and
the fixed zero tag retained from its original encoding, then folds ordered VRF,
action, bonus, abandon, and deadline events with SHA-256.
`committed_daily_run_vector_recomputes_end_to_end` and
`committed_zero_action_deadline_vector_recomputes_end_to_end` guard the unchanged commitments.
Permanent board rows retain the qualifying replay commitment; move
lists may stay off-chain and be independently recomputed.

A Daily rules hash binds its day, the core `CATALOG_VERSION` emitted by codegen,
and the selected realm's
guardian and starting height, objective kind and value, and the core rules
version. No catalog account or publisher-supplied version contributes to that
identity; `daily_rules_hash_binds_day_realm_objective_and_protocol_constants`
guards every input.

After a perfect clear, one domain-separated VRF output deterministically derives
both the one-row board reseed and the next visible preview. A move or guardian
bonus that empties the board enters the same continuation state and never
consumes the stale preview into that board. The committed continuation vector
prevents a run stranded between two oracle requests or accepting a stale move
without a preview; `perfect_clear_continuation_is_one_rule_for_move_and_bonus`
guards the engine boundary.

At the run deadline the resolved ER freezes the last fully accepted state and
adds a replay deadline event. A run with at least one accepted action is scored
from that partial state; an untouched run expires without a leaderboard row.
Pending or late VRF output is ignored, and expired or orphaned state can never
become scoreable later.

Every Arcade opening, move, guardian bonus, and reroll request uses one `RunVrf`
account context and one VRF invoke helper. The opening `request_vrf` remains a
separate ER instruction after Router placement resolves; delegation on Base
cannot request against the resolved ER queue. `finish_run` accepts only
owner/session-authorized Abandon before a cutoff or permissionless Deadline at
or after a Daily cutoff, and only an identical stored resolution may return
idempotently; `finish_run_predicates_are_exact` guards all four rejection
boundaries in SBF.

### Competitive profile

Player state keeps one compact Daily record per board — Score and Theme
separately — each holding best payout-bearing rank, wins, and awarded rewards
in lamports. `competition_record_counts_only_prize_results` guards those fields.
They stay separate because the two boards
rank the same runs by different metrics, so one aggregate cannot say whether a
player wins on total performance or on playing the day's theme, which is the
whole reason the pot splits in two. A non-paying leaderboard place stays visible
on the period board but is not a profile best rank. The Weekly and Season
records are gone; the Kredit balance, the cumulative ladder total, the highest
tier ever reached, the lifetime best `daily_score`, and the consecutive-entry
streak are live, and eighteen reserved bytes, validated as zero, remain for
later profile fields.

The worn identity is one field pair — featured emblem and featured ladder
border — set together by one instruction, because they are one decision about
what a player looks like on a board. Any tier ever reached stays wearable and
nothing above it ever is: a rank is earned once, and a later reset must not
take back a border a player chose. Both are display only and carry no monetary
effect.

A Daily claim settles its payout and profile metadata in one instruction. It
recomputes the exact payout from the finalized board and ledger, then uses the
claimed-position bit for idempotence. A failed claim changes neither;
`ladder_points_are_credited_once_per_claim` guards the boundary.

The featured emblem and ladder border are owner- or device-session-selectable. ID 0 automatically
chooses the strongest unlocked emblem; IDs 1-10 are zone guardians, 11 is Realm
Conqueror for all ten guardians, and 12 is World Perfect for 300/300 stars.
Emblems are identity display only with no monetary effect.
### Client retirement amendment — 2026-09-15

The owner approved Unity as the only client. Operator commands and the single
checked-in program IDL live in `tools/chain`; run operator procedures from
`tools/chain`. `chain_entrypoints_load_offline_under_tsx` exercises each command
entry point, and `idl:check` verifies the IDL against the program build.

`unity/tools/build.py fixtures` runs the Rust producers. Program account bytes,
PDAs, instructions and transaction messages come from
`programs/solana/examples/unity-fixtures.rs`.
`RustProgramInstructionsDecodeAndReencodeWithTheSharedBorshReader` and
`BoardRewardsValidateActualAnchorAccountsAndKeepClaimedPositionsVisible` exercise
that boundary. RPC envelopes are authored in the C# tests.
`LocalProductRoundTripPreservesProgressAndSavedRun` checks the local codec with
state constructed in the test.
Money EditMode and PlayMode tests share `MoneyTestEnvironment`, with one HTTP,
native-wallet and memory-store implementation. Rust produces their account
states; the test code supplies RPC envelopes and synthetic signatures.
`DailyEntryRequiresConfirmationThenNativeInputSettlesBothMetricsOnce` and
`ForegroundPreservesArcadeWithoutDeviceKeysOrNewTransactions` exercise that
composition. The runtime recording and diagnostic subsystem is removed. Board PlayMode tests
read native Rust trajectories directly through generated request codecs;
`NativeFixtureJourneyUsesRealDragAndOrderedTrace` exercises ordinary pointer input.
`test_metadata_rejects_test_drivers_and_retired_diagnostics` checks package isolation.
`FlushedProductPublicationReplacesWholeDocumentAndClearsStalePending` retains the
real save-file persistence check.
Local row randomness is SHA-256 over the saved seed and little-endian counter in
the core. `LocalRowRandomnessMatchesRustForSavedSeedsAndCounterBounds` verifies the
native operation; Campaign resume keeps the same row sequence. Client display
policies have one C# owner, program account bounds are generated from the program,
and share numbers use .NET formatting. `SharePreservesTheCallersPlatformFormatting`
guards the share boundary. Unused provisional-board and spectator reads are removed.
Campaign star packing, level availability, realm completion, emblem eligibility,
and level configuration come from core operations over the native boundary.
`CampaignAndDailyQueriesUseTheRustProgressionAndCatalogOwners` checks those
responses against Rust fixtures, including the full Daily pair returned by op 12.
`campaign_packing_roundtrips_and_local_results_preserve_the_maximum` and
`campaign_eligibility_handles_sparse_saves_and_unsupported_emblems` guard the core.
The shared local client exposes Campaign play. The store assembly extends it
with the local UTC Daily and owns its purchase policy; the money assembly owns
save merging and acknowledgement. `money_identity_cannot_start_a_local_daily`
and `test_money_metadata_excludes_the_local_daily_and_store_policy` check the
composition and shipped package. `store_gate_is_a_store_identity_policy_over_shared_progression`
retains the store purchase boundary. Both identity constructors are covered by
`campaign_seed_is_fresh_per_attempt_and_replays_on_resume` and
`local_campaign_run_survives_process_death`.
Navigation, Campaign browsing, level details, the Daily lobby, results, profiles,
settings and result sharing live in the shared presentation assembly. The two
identity adapters supply page data and actions through `IAppPageSource`;
`EverySharedPageRendersUnderBothIdentityImplementations` checks every shared page
under both adapters. Store purchase and name controls and money wallet, device,
Kredit, claim and receipt controls remain identity slots. The existing store and
money journeys retain their action boundaries; `DailyEntryRequiresConfirmationThenNativeInputSettlesBothMetricsOnce`
also checks the shared result and share text after confirmed settlement.
`CampaignStaysVisibleWhenAnEarlierOverviewReadCompletes` guards the active-page
boundary for delayed public reads during free Campaign navigation.
The chain run client has one Arcade path with no mode argument. The existing
v1 Daily recovery locator remains readable. `AConsumedRunsReceiptCanFinishWithoutClaimingItsNewSuccessor`
and `RunReceiptRejectsReuseWrongOwnerAndRunBeforeSending` retain the recovery and
receipt boundaries.
One identity epoch invalidates retained chain reads after reconciliation;
`PendingPurchaseUsesRealReconcilerAndInvalidatesRetainedEconomyProjection` checks
that boundary, while `campaign_record_write_never_gates_play_or_other_transactions`
keeps local Campaign play independent. Superseded reads use cancellation;
`NewPublicReadRejectsAnOldCallbackAndRetainedPublication` checks late publication.
`RunOperationReceipts` is the single retained operation record for the connected
identity. `MoneyRunReadFailureRetainsActualConfirmedReceiptAndReportsTheNewFailure`
and `TheLastOperationIsSharedAcrossPagesAndClearedOnReconnect` guard retention
and identity changes. `MoneyRunSettlementUsesTheActualReconcilerAndKeepsOrderedCommitConsumeReceipts`
checks the shared reconciliation path and ordered settlement results.
The root `assets/` directory owns the artwork and authored presentation inputs;
Rust codegen emits its theme catalog and constraint captions for Unity imports.
Pages and boards share its parsed instance;
`EveryRealmUsesItsImportedArtMusicAndNativeInventory` checks that shared catalog.
Both products use one startup and unavailable page with identity-specific
configuration. `SelectedSceneHasOneSharedStartupAndOnlyItsIdentityConfiguration`
checks the generated scene for each product; `UnconfiguredSceneHasReadableTextAndNoEnabledOperation` and
`TeardownDuringDelayedReadWaitsWithoutLateInputOrSigning` check failure and cleanup.
Settings use native preference values across pages and boards;
`SettingsBeforeStartAreAppliedAndPersistAcrossControllerRecreation` and
`SlidersAndSwitchesUseIndependentLevelsAndRememberOnlyThisSettingsMount` check
saved levels, mute and page behavior. Store Daily saves derive the realm and
objective from their day and retain numeric result totals; money saves contain
Campaign data only. `MoneySaveContainsOnlyCampaignDataAndDailyMetricsRemainNumbers`
guards the save boundary.
`unity/toolchain.json` owns each Android identity's package, display name, ABIs
and excluded assemblies. `test_profiles_preserve_money_and_add_two_abi_store`,
`test_both_package_manifests_use_the_identity_contract` and
`test_metadata_rejects_every_money_assembly_and_tests` guard that contract.
`unity/tools/build.py locks` regenerates the money application's dependency
locks from a Unity export; `test_money_lock_update_requires_both_resolved_modules`
guards replacing the reviewed files only after both module resolutions succeed.

### Runtime boundaries

| Boundary | Responsibility | Authority and funding |
| --- | --- | --- |
| Owner wallet | Durable identity, Kredit purchases and device funding | Signs purchases at the protocol unit price and funds the device allowance |
| Device session | Approximately seven days of authorized Arcade gameplay and Campaign save writes, using one key per install | Owner-funded fee/rent allowance; atomic revoke-and-create renewal; `RenewalRevokesAndCreatesTheSameTokenAtomicallyWithTheInstallKey` |
| Cadence funding PDA | Recyclable Daily rent float | Separately seeded; signs the System creation calls in Daily preparation and finalization only |
| ProtocolConfig | Scheduling and rolling finalized-result commitment | Launch day supplies the first day; program-derived append-only root |
| MagicBlock ER | Arcade gameplay and per-row VRF | Router-resolved validator |
| Solana program | The player's reported Campaign save, competitive records, accounting, boards, settlement | Base-layer authority |
| Fly keeper | Daily cadence work and last-resort permissionless recovery | Independent bounded signer |
| Unity local Campaign client | Campaign play, durable seed/action replay and local lifetime stars | Connected address only on money; walletless store policy |

The install key survives wallet changes, disconnect and explicit revocation;
`OneInstallKeyIsReusedAcrossWalletsAndRestarts`,
`DisconnectPreservesBothDurableSessionAndActiveKeyWhenJournalIsUnresolved` and
`RefillKeepsIdentityAndRevokeClosesTheTokenWhileRetainingTheInstallKey` guard
those boundaries. Renewal keeps the previous public expiry until its signed
intent is confirmed, and a failed renewal retains it;
`SignedRenewalResumesPublicSaveBeforeJournalRemoval` and
`FailedRenewalRetainsThePreviousExpiryAndInstallKey` guard recovery.
`oneInstallKeyIsSavedBeforeUseAndReusedAfterRestart` and
`failedDurableSaveReturnsNoUsableKey` check the native persistence boundary.

Each `ActiveRun` and `ArenaPlayer` stores the signer that paid its rent, and every
close returns rent to that exact address even when another device resumes the
run. `a_closed_run_returns_rent_to_its_payer` guards this boundary. The cadence
funding PDA funds the System creation calls in Daily preparation and finalization;
`sbf_cadence_funding_can_prepare_a_missing_post_launch_daily` and
`cadence_funding_creates_exact_boards_through_the_full_capacity` guard those paths.

Client-assembled owner transactions pin a deterministic 400,000-compute-unit
limit and 1,000-micro-lamport unit price before wallet approval, so the maximum
priority fee is 400 lamports. Fully specifying both fields prevents wallet-side
priority-fee message enhancement while retaining the exact signed-message check:
changed instructions, accounts, blockhashes, signer roles, or existing partial
signatures are rejected.

Solana Base, the MagicBlock Router, and the Router-resolved ER are separate
connections. Delegation placement resolves through `getDelegationStatus`;
regional ER endpoints are never hardcoded. Player state retains one durable
Arcade run slot and its monotonic run-ID sequence. Campaign has no chain run
reservation. Arcade's orphan reservation prevents an unreachable delegated run
from racing a replacement. `arcade_reservation_and_orphan_share_one_monotonic_run_sequence` and
`local_campaign_run_survives_process_death` guard the two recovery boundaries.

The program pins `ephemeral-rollups-sdk` 0.16.2 or newer. Its generated
undelegation callback must constrain the canonical `undelegate-buffer` PDA and
the System program; `undelegation_callback_is_constrained_to_its_buffer_pda` rejects the unsafe older
`#[ephemeral]` expansion.

### Archival

`ProtocolConfig.last_daily_id` and `daily_root` advance one sequential rolling
commitment per finalized Daily, beginning at `launch_day_id`.
`archive_is_strictly_sequential` guards the sequence. `close_arena_daily` requires
that root to cover the day before returning rent to the cadence funding PDA;
`sbf_daily_archive_and_close_return_only_rent_to_cadence_funding` guards it.
The Devnet volume archive
is retired; the Solana ledger is the record. Mainnet indexing is a separate
deployment decision. `keeper_allowlist_is_exactly_its_plans` keeps the root
append and root-gated closure in the keeper's exact cadence plan set.

### Keeper scope

The keeper has two responsibility classes. Cadence work prepares, activates or
skips, finalizes, constructs boards, advances the on-chain root, expires claims,
and closes a Daily and its resolved ArenaPlayer accounts. Last-resort work
finishes deadline runs, commits and consumes
terminal runs, expires unresolved Arena runs, and cleans orphaned runs. Every
instruction is permissionless; preparation and finalization use the cadence PDA
for rent. `a_closed_arena_player_returns_rent_to_its_payer` guards the keeper's
program-derived instruction and the SBF closure: a live parent retains its
player records, and a closed parent returns their rent to the stored payer.
Governance remains owner work. `keeper_allowlist_is_exactly_its_plans` pins the
thirteen instructions to the plan producers.
`consume_arena_run` also closes an expired orphan without its period accounts;
`an_expired_orphan_closes_without_period_accounts` guards its rent refund and
unchanged player fields. A missed Funding day finalizes directly after its
window and predecessor rollover;
`a_missed_funding_day_finalizes_after_its_window_and_rollover` guards that path.

A keeper outage is a degradation, not a loss of player authority: winners can
still claim, interested callers can drive permissionless work, and no off-chain
file gates settlement or closure. Every added keeper responsibility costs an
allowlist entry and bounded write capacity.

### Keeper safety

Writes require `KEEPER_WRITE_ENABLED=true` and the approved SHA-256 fingerprint
of the immutable Fly image reference, keeper public key and launch day.
Program identity and the IDL hash come from the build. `keeps writes fail-closed unless explicitly enabled`,
`binds the image, keeper key and launch day while reporting build identity` and
`pins loaded secret material to the configured public key` guard those boundaries.

The RPC boundary checks Devnet genesis, HTTPS, account owner, bounded length,
discriminator, version and decoded field shape. Scans and plans stay within the
recent cadence window. `requires the Devnet genesis and handles an unavailable RPC`,
`requires HTTPS outside localhost`,
`keeper_rpc_decoding_rejects_foreign_malformed_and_unbounded_accounts` and
`keeper_preparation_advances_past_archived_days_and_keeps_the_recent_window`
guard those checks. ER writes resolve the current Router location and require
the program's delegation owner; `rejects a Router owner mismatch before using the ER`
and `uses the fresh Router location for a write connection` guard that boundary.

The loop orders plans by `KEEPER_PLAN_INSTRUCTION`, materializes the checked-in
IDL, simulates before relay, reserves the simulated spend even when confirmation
is uncertain, and enforces `KEEPER_LIMITS`. Its recyclable board-rent ceiling
applies to the sum across the pass. `keeper_pass_reserves_write_slots_and_simulates_before_every_send`,
`keeper_simulation_failure_and_reserve_floor_prevent_relay`,
`keeper_spend_is_reserved_even_when_confirmation_is_uncertain` and
`keeper_board_rent_ceiling_bounds_the_sum_of_finalizations_in_one_pass` guard
those limits. `keeps monetary, archive, and cleanup ordering stable` and
`materializes every surviving keeper protocol operation` guard the execution order and interface.

From the repository root, set the public keeper key and launch day, then run
`NO_DNA=1 pnpm release:deploy`. It builds an immutable image (or uses the supplied
`FLY_IMAGE_REF`), saves `build/keeper-release.json`, stages writes disabled, and
deploys the image. Review its read-only pass, including `staged_launch_ready`
before bootstrap, and the saved fingerprint;
`staged_launch_ready_requires_the_paused_protocol_and_both_unfunded_days` guards that state.
Only a separately approved release
may set `KEEPER_APPROVED_RELEASE_FINGERPRINT` and enable writes;
`keeper_release_deploy_saves_the_image_binding_and_disables_writes_before_deployment`
and `keeps writes fail-closed unless explicitly enabled` guard that order.

### Keeper rule ownership amendment — 2026-09-16

Instruction name, connection and priority live in `KEEPER_PLAN_INSTRUCTION`;
`keeper_allowlist_is_exactly_its_plans` and `materializes every surviving keeper protocol operation`
check the plan boundary. Program bounds and the derived two-board rent ceiling
are emitted by codegen. `every_program_capacity_has_an_sbf_test_at_its_maximum`
checks the maximum-capacity coverage, and the codegen drift check binds the copies.
Keeper day windows, suspension windows and board ordering call the core; native
pair decoding uses the same core owner.
`suspension_window_handles_gaps_and_u32_limits`,
`pair_decode_covers_the_product_and_rejects_outside_indices` and
`board_order_uses_metric_then_time_then_owner_bytes` guard the rules;
`keeper_rule_boundaries_use_the_core_at_day_and_ordering_limits` and
`BoardOrderingUsesTheCoreAtMetricAndTimestampBounds` check the host boundaries.

### Core host cleanup amendment — 2026-09-16

`zkube-core-host` contains the shared native codecs and the keeper's WASM
exports; `zkube-core-ffi` remains the unsafe shell. Campaign resumes through
local replay, and `arcade_reconstruction_rejects_campaign_rules` checks that
account reconstruction accepts only Arcade rules. `StarRules` owns Campaign
star requirements; the move budget remains a separate run rule. The core has
one observed form of each transition, with `NoPresentation` used by the program.
`perfect_clear_observation_preserves_move_bonus_and_capped_state` and
`ActualManagedNativeCallsMatchEveryTransitionAndTrace` guard the transition and codec results.
The native payout boundary calls the bounded core plan;
`bounded_payout_plan_keeps_the_full_width_and_denominator` guards retained rows
without renormalization, alongside the unchanged payout golden vectors.
The catalog is `campaign-catalog.json`; `committed_catalog_validates_and_emits_protocol_constants`
checks its version against the core constant. The keeper's schema value is
owned by `keeperRelease.ts`, and `binds the image, keeper key and launch day while reporting build identity`
checks the fingerprint. `operator_cli_options_and_exact_amounts_fail_closed` checks the operator bundle schema.

## Operator procedures

Every command below remains subject to the transaction policy above. There is
no current deployed binding. `tools/chain/deployment/devnet-v4.json` is the
abandoned deployment's frozen record and supplies no release inputs.
Preparation is two exact, independently approved bundles: deployment and launch.
The public launch bundle then carries the release binding used by later
operations; `operator_release_checks_devnet_and_programdata` checks the live
Devnet genesis, canonical ProgramData address, bytes, allocation and authority.

From the repository root, `NO_DNA=1 pnpm chain plan deploy --bundle build/chain/deploy.json`
quotes an already frozen SBF using public payer, buffer and upgrade-authority
addresses. It plans buffer creation, bounded byte writes and initial deployment
without loading a signer. `operator_plan_saves_one_public_bundle_without_loading_a_signer`
guards the public planning path. `deployment_instruction_bytes_and_accounts_match_the_rust_loader`
compares every loader instruction and account with the Rust SDK's emitted bytes.
The bundle records exact rent, fees, spend and reserve. Program upgrades remain
outside this fresh-bootstrap command; `operator_cli_options_and_exact_amounts_fail_closed`
rejects unsupported operations.

`NO_DNA=1 pnpm chain plan launch --bundle build/chain/launch.json` binds the
deployed release, keeper fingerprint, launch day and cutoff. It quotes any
needed authority/team funding, then five transactions: paused protocol and
Kredit-vault initialization, cadence funding, two Daily preparations, and the
atomic first-Daily deposit, unpause and activation. The test
`plans the full fresh bootstrap and one atomic launch transaction` in
`launchPlanner.test.ts` checks that order. Public input names are listed by
`NO_DNA=1 pnpm chain --help`; `chain_entrypoints_load_offline_under_tsx` checks
that the entry point loads without release inputs.

`NO_DNA=1 pnpm chain plan top-up --launch-bundle build/chain/launch.json --top-up daily:current:1SOL --bundle build/chain/top-up.json`
uses the launch binding and program deposit instruction. Amounts carry an
explicit SOL or lamports suffix; current, following or an exact scheduled day
identify the Daily. The command combines the approved deposits into one
transaction and pins their seeded balances;
`operator_cli_options_and_exact_amounts_fail_closed` and
`operator_top_up_rejects_seeded_balance_drift_and_a_closed_window` guard amount
parsing, canonical windows and state drift. A direct transfer to a Daily PDA
would bypass its seeded ledger; this command uses the same deposit instruction
checked by `routes a chosen amount to the exact selected prize-pool PDA`.

`NO_DNA=1 pnpm chain plan set-suspension --launch-bundle build/chain/launch.json --until-day 21000 --bundle build/chain/suspension.json`
plans the explicit governance veto with the pinned protocol authority.
`sets the explicit suspension boundary and seeds cadence funding` checks its
instruction; `operator_rebuild_rejects_changed_instruction_bytes_before_loading_a_signer`
checks that execution rebuilds the approved bytes. Suspension stays outside
the keeper allowlist, guarded by `keeper_allowlist_is_exactly_its_plans`.

Only after exact approval, `ZKUBE_APPROVAL=<fingerprint> NO_DNA=1 pnpm chain execute --bundle <path>`
rebuilds the public plan and checks its fingerprint before loading any keypair.
`ZKUBE_SIGNER_PATHS` maps the approved public keys to existing signer files;
`operator_missing_fingerprint_loads_no_keypair` guards that boundary, and
`operator_signer_read_errors_do_not_echo_file_contents` guards error output. One
sign, simulate, persist, relay and confirm path serves every operation;
`operator_signed_simulation_and_durable_receipt_precede_relay` and
`operator_fee_spend_reserve_and_simulation_failures_prevent_relay` guard its
ordering and approved bounds. Receipts are saved atomically before relay, and
resumption reuses or confirms their exact signed bytes;
`operator_receipts_resume_without_repeating_confirmed_transactions` and
`operator_pending_receipts_relay_the_same_bytes_without_loading_a_signer` guard
interruption recovery. `--until <index>` stops after the printed inclusive
transaction index; `operator_until_stops_after_the_requested_transaction_and_resumes_that_prefix`
guards staging and resumption. Activation additionally requires the verified
`ZKUBE_KEEPER_STAGED_RELEASE_FINGERPRINT` and the unexpired launch cutoff;
`operator_until_is_an_inclusive_bounded_index_and_activation_requires_the_keeper`
and `refuses planning after the exact launch cutoff` guard those boundaries.
No command grants recurring keeper authority or Mainnet approval.

### Gate G1 — physical-device wallet matrix

Run every row on a physical device for Seed Vault Wallet on Seeker, Phantom on
Android, and Solflare on Android through the Kotlin MWA plugin.

| # | Step | Expected result |
| ---: | --- | --- |
| 1 | Kotlin MWA capability inspection | Wallet exposes sign-only transactions and version `0` |
| 2 | Connection and authorization | Account authorized, address matches the wallet UI |
| 3 | Rejection | User decline surfaces as a typed rejection, no partial state |
| 4 | Reconnect after process death | Authorization re-establishes without a stale account |
| 5 | Background and resume | Returning to the app keeps or cleanly re-requests the connection |
| 6 | Account switch | Client observes the new address; no cross-account carryover |
| 7 | v0 sign-only behavior | Wallet returns a signed v0 transaction without submitting it |
| 8 | Unchanged message bytes | Returned message equals the approved message exactly |
| 9 | Device partial signatures | An existing device-session signature survives wallet signing |

Steps 7–9 verify properties the client already enforces: signing requires
Kotlin MWA sign-only transactions with version `0`, a wallet that can only sign-and-send
is rejected, and a wallet that mutates the message or discards an existing
partial signature fails the check rather than producing a silently altered
transaction.

Step 1 is passive inspection and needs no signing approval. Every later step
drives a real wallet, produces authorization signatures or signed messages, and
is out of scope for routine work. Any such pass — including a transaction or
message signature test that is unsent, local-only, or zero-lamport — must first
be proposed as one exact enumerated approval bundle covering the instructions or
message, accounts, signers, Devnet genesis and cluster, expected send behaviour,
and maximum spend.

Stop/go: proceed with the sign-only architecture only after Seed Vault Wallet
confirms `SolanaSignTransaction` with transaction version `0`, preserved partial
signatures, and unchanged message bytes. If any of those fail, stop for an
explicit architecture and security decision. Never silently fall back to
`signAndSendTransaction`; that path forfeits the exact signed-message check and
the device partial signature.

Record per device, wallet, and step, with no secrets: UTC date; device model and
OS or firmware build; wallet name and version; plugin version; exposed
feature keys and supported transaction versions; result or error class. Never
record signer bytes, seed phrases, private keys, `.env` contents, keeper
secrets, or Android credentials.

Passing Gate G1 is a client-surface compatibility result only. It does not imply
Mainnet readiness, does not open paid Arcade, and is not deployment or Solana
dApp Store publication approval; each remains separately approved.
