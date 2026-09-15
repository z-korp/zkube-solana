# Agent working rules — zkube-solana

These rules govern coding agents and operators in this repository. They do not
add approval prompts to the shipped product.

`README.md` is the public product and contributor document. Agent rules, the
protocol reference below, and operator procedures live here. Implementation
detail belongs in code comments next to the code. Do not add new Markdown
documents, and do not move approval policy or operator runbooks into `README.md`.

## Agent tooling discipline

- Off-Editor C# harnesses use `unity/tools/harness.py` and its shared
  `ZKube.TestMain`. Each case prints PASS or FAIL, failures include their first
  stack frame, and the summary returns 0 or 1. Never rethrow from Main or use
  an abort as a test result. Python tools use `unity/tools/cli.py` to report
  expected failures with the result/log path instead of a traceback.
  Regenerate Unity fixtures with `unity/tools/fixtures.py generate`, which
  orders native, transport and presentation producers; do not run writers concurrently.
- Every Unity Editor invocation goes through `unity/tools/build.py`, including
  one-off methods via `exec --method`. One invocation holds the Editor lease
  through its entire operation. A held lease means wait. The persistent graphics
  Editor belongs to `board-gui`; send it commands through `evidence.py`.
  Read the fresh log and completion result before interpreting a nonzero exit;
  verified completion followed by a teardown crash is success with a noisy exit.
- Reuse the session's MCP servers. Stop a wedged server before replacing it and
  report its PID and reason. Report duplicate configuration entries to the owner.
  Request a region or screenshot instead of parsing a multi-megabyte page DOM.
- `/tmp` is RAM-backed. Large scratch work belongs in ignored `build/`, and is
  removed when its step finishes. Never extract packages into `/tmp`; retain
  only scratch data still needed by active work and explain what is kept.

## Deployment status — read this first

**There is no live deployment.** The v4 Devnet protocol was deliberately
abandoned on 2026-08-08 and its accounts, pools, keeper release, and launch
bundles are dead. Nothing on chain is authoritative, nothing needs preserving,
and no migration path exists or should be written. The next deployment is a
fresh bootstrap of v5 and requires its own exact approval.

Every keeper release fingerprint, launch-plan fingerprint, deployment manifest,
and recurring write authority approved before that date is void. None of them
carries over.

Source implements v5 partially. Current state:

| Area | Status |
| --- | --- |
| Deterministic core 1.0.0 | Built — `objective_total`, constraint-latched Campaign stars, capped reroll inventory and grants, harmonic payout width, and the cycle-keyed realm × objective draw |
| Program surface | Built — Daily-only; Weekly, Season, and Practice removed |
| Entry accounting | Built — 9,000,000 lamports to the following Daily, 1,000,000 to operator revenue |
| `PlayerState` | Built — Campaign stars, separate Score and Theme Daily records, Kredit balance, ladder total and highest tier, worn ladder border, entry streak, and 18 reserved bytes validated as zero |
| Daily settlement | Built — exact-sized Score/Theme board accounts, verified chunk construction, direct claims, auto-claim on entry, per-board thirty-day expiry from sealing, and exact rollover |
| Kredits and Daily draw | Built — prepaid purchase/spend paths and protocol-derived realm × objective selection |
| Points ladder | Built — integer Q64 `ln` in the core, streak-neutral points applied atomically with each Daily claim |

## Product truth

- The Unity client ships two Android identities (owner scope decision,
  2026-09-09): `com.zkorp.zkube` targets the Solana dApp Store and Seeker;
  `com.zkorp.zkube.store` targets Google Play as an AAB with arm64-v8a and
  x86_64. The store identity mirrors `client/src/ui/pageSets/store.tsx` and
  `client/src/backend/local`: local name, UTC Daily, native-billing Campaign
  unlock, profile and settings, with Solana assemblies and wallet plugins
  excluded. The wallet, Kredit and on-chain rules below govern the money
  identity. Do not start iOS work on this Linux machine.
- The connected Solana address is the player identity. There are no embedded
  wallets and no recovery codes.
- Campaign is free, never gates paid play, and changes only the compact
  lifetime-best star record. Arcade is immediately available.
- Entries are prepaid as Kredits at exactly 0.01 SOL each. A Kredit is one-way:
  no withdrawal, transfer, or cash-out. The owner funds the balance and a device
  session may spend within it, which is an owner-set spending cap rather than a
  removal of the owner-signature boundary. A Kredit is never granted,
  discounted, or bundled as a bonus, so every entry contributes identical
  lamports and no entry dilutes another.
- Spending a Kredit routes 9,000,000 lamports to the following Daily and
  1,000,000 to operator revenue. The operator share is swept at purchase, so the
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
  root commits each finalized result. The cadence funding PDA signs only narrow self-CPI rent paths; there is
  no Kora or generic paymaster.
- Separate durable Campaign and Arcade run slots prevent overlap within either
  mode and support cross-device recovery while allowing one run of each. They
  share one monotonic run-ID sequence. Base, Router, and resolved ER connections
  remain separate; resolve ER placement with `getDelegationStatus`.
- Fly runs only the independently funded Daily keeper, which has no inbound
  HTTP surface. The web client and Capacitor shells have no server signer.
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
  `ArcadeConfig.suspended_until_day` is set by `set_arena_suspension`; a prepared
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
  `campaign_and_daily_draw_from_one_tier_table` and the codegen check guard the
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
  the Campaign catalog parity test binds the client publication to the
  core-validated fixture. Types 3 and 5 are unsupported;
  `trigger_threshold_semantics_are_exhaustive` guards the sparse tag set.
- **Guardian inventories start empty in both modes.** Starting height comes from
  the drawn realm in Daily and the same realm publication in Campaign; Hammer,
  Totem, and Wave charges are earned only by firing that guardian's trigger.
  `campaign_opening_is_seeded_and_reproducible` and
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
  the boundary.
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
  Finalization allocates one exact-sized account for each of the Score and Theme
  boards. The keeper submits at most ten sorted rows per write, and the program
  verifies every row against its `ArenaPlayer`, enforces ordering and uniqueness
  across the persisted cursor, and seals only the program-computed count. Claims
  remain disabled until sealing, then locate the owner's position and recompute
  its payout directly. A dynamic claimed bitmap lives beside the
  rows in each board account. An explicit claim supplies its board position to
  the single `claim_daily_prize` instruction; there is no account-scanning
  public claim variant. `ladder_points_are_credited_once_per_claim` guards that
  position-addressed settlement boundary. A reward stays claimable for **thirty days from
  its board's sealing**; after archival and both independent windows, unclaimed
  rewards expire into the next daily pot, never into operator revenue.
- **Spending a Kredit settles what that player is already owed.** Any unclaimed
  reward on a sealed, unexpired board is claimed in the same transaction as the
  entry, so a returning player never makes a second trip and never forfeits
  through inattention. It composes the existing claim by self-CPI rather than
  reimplementing it, and settles at most two attached boards per entry, so the
  work stays bounded rather than looping over an unbounded history. An entry
  must never fail because an attached claim could not be made: if the board is
  unsealed, the account absent, the window past, or the reward already taken,
  the attachment is skipped and the entry proceeds. Explicit claiming remains
  available and unchanged, and expiry into the next daily pot is unchanged.
- **Protocol economics are code, not mutable account terms.** The entry price
  and its Daily/operator split are core constants emitted to clients by
  codegen; neither `ProtocolConfig` nor `ArcadeConfig` stores a second copy.
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
  `reroll_request_is_an_accepted_action_that_awaits_its_own_vrf`, SBF reroll
  contracts, and source supersession guard enforce the inventory and split.
- **A Kredit is never granted, discounted, or bundled as a bonus.** Every Kredit
  in existence was bought at the same price, so every entry contributes the same
  lamports and no entry dilutes another. Larger packs carry cosmetics only. Free
  and airdropped Kredits, bulk bonus Kredits, and per-unit bulk discounts are
  all prohibited on the paid boards — a discount reduces the per-entry
  contribution and is the same dilution wearing a different label. Unpaid
  prestige boards are the only place an unbacked entry may exist. The shipped
  shop offers packs of exactly 1, 10, and 25 Kredits; `kreditPacks.test.ts`
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
  genesis, deployed ProgramData hash, exact signer, current/recent cadence PDAs,
  canonical instruction allowlist, the release's two declared write ceilings,
  0.1 SOL simulated spend per pass, and a 0.1 SOL reserve floor. The schema-1
  source release currently declares six general writes, thirty-two
  board-construction writes, and at most 1,802,208,480 lamports of recyclable board rent per
  pass; those numbers are a proposal until approved, not inherited permission.
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
- Production Vercel publishing is Git-driven only from
  `z-korp/zkube-solana:main` to project
  `prj_5kqIxlxgXHXGhldje8unic9h3qYA` under `z-labs`. Never deploy zKube under
  JCN DATA; its temporary exception is Fly Devnet keeper hosting only.

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

Static GitHub validation is manual-dispatch-only; validation is one local
command, and every change ends with it green:

```bash
NO_DNA=1 ./validate.sh
```

`validate.sh` is the single authority on what the gates are — do not restate
its contents here or anywhere else. It defaults to the full suite; `program`
and `frontend` scopes exist for iteration, but the full run is what finishes
a change. A red gate is a defect that outranks whatever work surfaced it.

Start with `README.md`, then inspect `state`/`instructions` for contract work,
`services` for keeper work, and client chain/platform boundaries only when the
client is explicitly in scope. Never infer deployed state from source.

## Standing defect rules

Bugs are fixed with their class, never alone: before patching, name the
recurring source it is an instance of, and close that source in the same
change. The known sources and the guard for each:

- **Unrun gates.** Every change ends with `NO_DNA=1 ./validate.sh` green.
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
  with a measurement or a playtest, never with taste alone. Cutting or
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
entry has no refund or claim-back path. Operator withdrawals remain governance
actions and cannot spend accounted prize balances.

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

Ten zones of ten levels: 100 levels, 300 stars, stored as one packed 25-byte
two-bits-per-level array. Zone unlocked, cleared, perfected, total stars, and
badges are derived views, never separately stored progression.

Only Zone 1 Level 1 starts playable. Within a zone each later level requires at
least one star on the preceding level; the first level of a later zone requires
at least one star on the preceding zone's guardian, Level 10. Completed levels
stay replayable and a level's best one-to-three-star result can only increase. A
guardian emblem unlocks with its guardian and renders gold at 30/30 zone stars.

Each level has three independent star sources: score target, primary Shape, and
secondary Blow. A source latches on the action that makes its fact true, in any
order, and one action may latch all three. The level completes when every
authored source has latched; `constraint_stars_latch_in_any_order` and
`constraint_stars_latch_zero_to_three_on_one_action` guard both paths. An absent
constraint is not a source; `absent_constraints_limit_the_earnable_source_mask`
guards the authored mask. Every published level still carries both constraints,
as enforced by codegen and campaign publication.

Every realm shares the ten-level score ladder
`[10, 14, 18, 22, 27, 32, 37, 42, 46, 50]`. A level authors only its tier,
Shape, and Blow; its move budget is the ceiling of its ladder target times the
protocol moves-per-point value for that tier. Neither target nor budget is a
Campaign publication field. `campaign_move_budget_is_derived_from_the_ladder_and_tier`
and `campaign_publication_rejects_an_authored_budget` guard the core, fixture,
and program boundaries.

Primary constraints are cumulative facts counted across a run; secondary
constraints are moment facts that must be true on one action. Every authored
primary must use a cumulative kind and every authored secondary must use a
moment kind; `campaign_rules_require_valid_constraint_classes_counts_and_distinct_facts`,
`codegen_enforces_constraint_class_per_slot`, and
`campaign_publication_enforces_constraint_class_per_slot` enforce the core,
fixture, and program boundaries. The six single-action kinds
`ComboOfAtLeast`, `ComboOfExactly`, `AllWidthsInMove`, `BigMove`,
`BonusLinesInMove`, and `PerfectClear` must carry a count of exactly one;
`Streak` and `BreakInMove` retain their in-action N. These three tests guard
that count rule at the core, fixture, and program boundaries:
`constraint_classes_and_tags_are_exhaustive_and_stable`,
`codegen_enforces_constraint_class_per_slot`, and
`campaign_publication_enforces_constraint_class_per_slot`. Player-facing
constraint language is limited to lines, combos, streaks, breaks, bonus lines,
perfect clears, guardian triggers, and points;
`every_constraint_kind_reads_its_declared_action_fact` pins the engine fact
behind each kind.

Every cumulative primary must carry a count of at least two;
`campaign_rules_require_valid_constraint_classes_counts_and_distinct_facts`,
`codegen_enforces_constraint_class_per_slot`, and
`campaign_publication_enforces_constraint_class_per_slot` guard that rule at
the core, fixture, and program boundaries. A secondary must never be an
instance of its primary's fact, including the moment fact that is the realm's
own guardian trigger; the same three tests guard that rule at the same three
boundaries.

A level ends as complete when every authored star source has latched, or ends
incomplete when its move budget or board is exhausted; already-latched stars
are retained and recorded in either terminal state.
`exhausted_runs_keep_latched_stars` and
`sbf_blocked_eleventh_row_keeps_and_records_its_latched_star` guard the engine
and program boundaries. Storing the three-bit source mask costs one byte in
`ActiveRun` and one byte in the run state codec; its popcount replaces the deleted post-run star
calculation rather than adding a second rule.
Move efficiency and an authored star-threshold modifier are not star sources;
the `supersession > keeps reversed models out of authored source` test prevents
their code and copy from returning. Removing that model deletes one byte from
Campaign map rules, level snapshots, `ActiveRun`, and each encoded rules configuration.
The constraint vocabulary adds one action-origin bit to the Campaign report
codec and stores one streak byte plus one cumulative-trigger byte in `ActiveRun`
and the run state codec; `shared_run_config_and_state_codecs_round_trip_both_rule_shapes` and
`target_accounts_fit_normal_solana_account_limits` pin those costs.

Campaign uses the same engine and generated catalog as Arcade but a separate
progression boundary: completing Campaign content may only improve the packed
star array.

### Replay and determinism

`zkube-core` is the deterministic source for grid state, blocks, guardians,
scoring, pressure, period math, payout math, canonical encoding, and
the replay commitment schedule. One mode-agnostic `Run` owns every Campaign
and Daily transition; optional star sources and an optional objective select
only the rules each consumer needs. `one_run_drives_campaign_and_daily` guards
that shared driver. The Solana lifecycle reconstructs that `Run` for every VRF,
move, bonus, and reroll transition rather than maintaining a second accounting
path; `program_and_core_score_one_action_identically` guards the projection.
`ActiveRun` stores only fields read by a handler, result row, hash, or client
view, and its 325-byte account size is pinned by
`target_accounts_fit_normal_solana_account_limits`. Native Rust, WASM, and the
Solana program must pass the same committed golden vectors before an ABI is
releasable; `wasm_run_matches_native_golden_vectors` and
`wasm_protocol_matches_native_golden_vectors` guard the generated boundary.

Replay v2 binds the chain domain, challenge, rules hash, player, run ID, and
mode, then folds ordered VRF, action, bonus, abandon, and deadline events with
SHA-256. Permanent board rows retain the qualifying replay commitment; move
lists may stay off-chain and be independently recomputed.

A Daily rules hash binds its day, Campaign content version, selected realm's
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

Every opening, move, guardian bonus, and reroll request uses one `RunVrf`
account context and one VRF invoke helper. The opening `request_vrf` remains a
separate ER instruction after Router placement resolves; delegation on Base
cannot request against the resolved ER queue. `finish_run` accepts only
owner/session-authorized Abandon before a cutoff or permissionless Deadline at
or after a Daily cutoff, and only an identical stored resolution may return
idempotently; `finish_run_predicates_are_exact` guards all four rejection
boundaries in SBF.

### Competitive profile

Player state keeps lifetime paid entries and one compact Daily record per board
— Score and Theme separately — each holding best payout-bearing rank, podiums,
wins, and awarded rewards in lamports. They stay separate because the two boards
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
### Runtime boundaries

| Boundary | Responsibility | Authority and funding |
| --- | --- | --- |
| Owner wallet | Durable identity, Kredit purchases and device funding | Signs purchases at the protocol unit price and funds the device allowance |
| Device session | Approximately seven days of authorized gameplay | Owner-funded fee/rent allowance; may spend prepaid Kredits within its authority |
| Cadence funding PDA | Recyclable Daily rent float | Separately seeded; narrow self-CPI preparation and finalization only |
| Arcade archive PDA | Rolling finalized-result commitments | Program-derived append-only roots |
| MagicBlock ER | Active gameplay and per-row VRF | Router-resolved validator |
| Solana program | Campaign stars, competitive records, accounting, boards, settlement | Base-layer authority |
| Fly keeper | Daily cadence work and last-resort permissionless recovery | Independent bounded signer |
| Static web/PWA and Capacitor shells | Wallet, Campaign, and Arcade UI; runs the core engine through WASM | No server signer or paymaster |

Each `ActiveRun` and `ArenaPlayer` stores the signer that paid its rent, and every
close returns rent to that exact address even when another device resumes the
run. `a_closed_run_returns_rent_to_its_payer` guards this boundary. The cadence
funding PDA is usable only by the exact Daily preparation and board-allocation
wrappers.

Client-assembled owner transactions pin a deterministic 400,000-compute-unit
limit and 1,000-micro-lamport unit price before wallet approval, so the maximum
priority fee is 400 lamports. Fully specifying both fields prevents wallet-side
priority-fee message enhancement while retaining the exact signed-message check:
changed instructions, accounts, blockhashes, signer roles, or existing partial
signatures are rejected.

Solana Base, the MagicBlock Router, and the Router-resolved ER are separate
connections. Delegation placement resolves through `getDelegationStatus`;
regional ER endpoints are never hardcoded. Player state has one durable
Campaign run slot and one durable Arcade run slot, so one run of each may coexist
while overlap within either mode is rejected across devices. Both slots allocate
from one monotonic run-ID sequence. A separate Arcade orphan reservation prevents
an unreachable delegated run from racing a replacement.

The program pins `ephemeral-rollups-sdk` 0.16.2 or newer. Its generated
undelegation callback must constrain the canonical `undelegate-buffer` PDA and
the System program; the committed IDL regression test rejects the unsafe older
`#[ephemeral]` expansion.

### Archival

The program-owned `ArcadeArchive` advances one sequential rolling commitment
per finalized Daily, and `close_arena_daily` requires that root to cover the
day before returning rent to the cadence funding PDA. The Devnet volume archive
is retired; the Solana ledger is the record. Mainnet indexing is a separate
deployment decision. `keeper_allowlist_is_exactly_its_plans` keeps the root
append and root-gated closure in the keeper's exact cadence plan set.

### Keeper scope

The keeper has two responsibility classes. Cadence work prepares, activates or
skips, finalizes, constructs boards, advances the on-chain root, expires claims,
and closes a Daily. Last-resort work finishes deadline runs, commits and consumes
terminal runs, expires unresolved Arena runs, and cleans orphaned runs. Every
instruction is permissionless or funded through the narrow cadence PDA wrappers;
governance remains owner work. `keeper_allowlist_is_exactly_its_plans` pins the
fourteen instructions to the plan producers.

A keeper outage is a degradation, not a loss of player authority: winners can
still claim, interested callers can drive permissionless work, and no off-chain
file gates settlement or closure. Every added keeper responsibility costs an
allowlist entry and bounded write capacity.

### Keeper safety

The keeper validates cluster genesis, program and ProgramData identity, account
owner, bounded length, discriminator, version, PDA, and stored account
relationships before decoding or planning a write. Discovery performs the one
semantic plan validation inside each plan's isolation boundary; malformed plans
are rejected without aborting independent work. Both materialization switches
fail closed on an unknown operation.

The recurring signer cannot deploy, initialize, seed pots, change rules,
withdraw revenue, reimburse an entry, invoke a swap, or target mainnet. The
runtime identity check pins Fly's unique deployment tag from `FLY_IMAGE_REF`.
The release fingerprint pins every field checked at runtime: Devnet genesis,
deployed ProgramData hash, program ID, keeper signer, schema and IDL identity,
entry economics, the fourteen-instruction allowlist, a six-write general limit,
a separate 32-write board-construction limit, the 1,536-row board bound, the
1,802,208,480-lamport recyclable board-rent ceiling, a 0.1 SOL simulated spend
ceiling, a 0.1 SOL reserve floor, and Fly's unique deployment image reference.
The replay domain is derived from genesis and program identity rather than
stored in the fingerprint. The enforced cadence ordering is finalize, construct
both boards, append the on-chain root, expire unclaimed rewards, then close.

## Operator procedures

Every procedure here is approval-gated by the transaction policy above. The
repository has no current deployed binding. `client/deployment/devnet-v4.json`
is the abandoned deployment's frozen record and is never a v5 release input.
The source program ID is not evidence that corresponding ProgramData or
protocol accounts are current. A fresh v5 pass must derive and approve every
live value from its own read-only observations.

Manifest schema v6 binds the deployed ProgramData and allocation, Campaign
content catalog, exact launch day and seed plan, and keeper release. The v5
dependency is one-way: frozen SBF and observed ProgramData, unique Fly release
tag, keeper fingerprint,
launch-plan fingerprint, then the final manifest. Fly exposes a unique
`deployment-<ULID>` release tag to the worker; any later Fly deploy invalidates
write authority. No v4 manifest, fingerprint, account, or approval is reusable.

### Deployment

Preparation is two exact, independently approved bundles. From `client`,
`NO_DNA=1 pnpm chain:devnet:deploy` plans the v5 program operation from an
already frozen SBF. Its live read-only preflight binds Devnet genesis, the
derived ProgramData address, artifact and padded ProgramData hashes, allocation,
rent, fees, signer public keys, spend, and reserve. The planner never rebuilds
the artifact or copies a program keypair. The observed result, not an abandoned
manifest, supplies the deployed inputs for the rest of the bootstrap.

After the program and independently fingerprinted keeper release exist,
`NO_DNA=1 pnpm chain:devnet:launch-plan` produces the unsigned fresh-bootstrap
bundle. It requires every protocol target to be absent, calculates the exact
deployer funding transaction, initializes paused, initializes the Arcade archive
with the explicitly approved recyclable cadence-rent float, publishes Campaign
v3 and Arena rules, prepares the current and following Daily accounts, and ends
with one atomic transaction that seeds the first Daily, unpauses, and activates
it. Its approval expires at the specified pre-entry cutoff. The planner has no
signing or sending path. Transaction indices and the cadence-rent funding amount
come only from that v5 plan and are never inherited from an earlier shape.

`NO_DNA=1 pnpm chain:devnet:launch` is the separate approval-gated executor. Its
`stage` mode simulates, signs once, confirms, and re-reads the planner-declared
staging transactions, leaving the protocol paused and writing a public launch
bundle under `/tmp`. A signed receipt is atomically persisted before each
submission, so `resume` can verify the exact approved message, signer, signature
status, and blockhash before relaying or re-signing an interrupted pass. The
deployed keeper must then report `staged_launch_ready` for the approved release
fingerprint. Only `activate` mode can submit the planner-declared activation
transaction; it re-verifies the bundle hash, Devnet genesis, ProgramData,
account contents, cutoff, signer, keeper evidence, and exact instruction bytes
before the atomic seed/unpause. No client or Fly process contains an
unconditional launch path.

No initialization has been performed and no keeper release is write-enabled.
The abandoned v4 deployment's recovery state, release fingerprint, and recurring
authority are void and grant nothing. A fresh bootstrap requires new approvals
for deployment, keeper enablement, seeding, and activation, each enumerated
exactly and none inherited.

### Manual prize top-up

Never transfer SOL directly to a Daily PDA; that does not update its seeded-funds
ledger. This procedure exists only after a fresh v5 manifest has been generated
and approved. From `client`, this read-only plan resolves the confirmed Daily,
validates that manifest and the live accounts, combines instructions atomically,
simulates without a signer, and writes a public bundle under `/tmp`:

```bash
NO_DNA=1 pnpm chain:devnet:top-up -- plan \
  --manifest <approved-v5-manifest-path> \
  --top-up daily:current:1SOL
```

Amounts require an explicit `SOL` or `lamports` suffix, and the Daily may be
`current`, `following`, or an exact numeric ID. The printed bundle pins Devnet
genesis, ProgramData hash and allocation, protocol authority, exact Daily PDAs,
instruction bytes, seeded balances, maximum fee and spend, and the post-write
authority reserve. Execution is a separate command, valid only after the entire
printed bundle receives exact approval:

```bash
ZKUBE_PRIZE_TOP_UP_APPROVAL=<printed-64-hex-fingerprint> \
ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR=<pinned-authority-path> \
NO_DNA=1 pnpm chain:devnet:top-up -- execute \
  --bundle <printed-bundle-path>
```

The executor loads no keypair until the fingerprint matches. It then rechecks
the deployment and live cadence window, refuses seeded-balance drift, enforces
the approved fee and reserve, simulates the signed atomic transaction, persists
its receipt before relay, confirms it, and verifies each seeded balance. The
command deliberately rejects Mainnet. Mainnet enablement requires a separately
reviewed release binding the approved Mainnet genesis, deployment manifest,
program, authority, economics, distribution decision, and operational policy;
Devnet approval or this command's existence grants none of those permissions.

### Gate G1 — physical-device wallet matrix

Run every row on a physical device for Seed Vault Wallet on Seeker, Phantom on
Android, and Solflare on Android. `README.md` documents the capability panel and
local HTTPS setup used for step 1.

| # | Step | Expected result |
| ---: | --- | --- |
| 1 | Passive capability inspection | Panel lists the wallet with `solana:signTransaction` and version `0` |
| 2 | Connection and authorization | Account authorized, address matches the wallet UI |
| 3 | Rejection | User decline surfaces as a typed rejection, no partial state |
| 4 | Reconnect after process death | Authorization re-establishes without a stale account |
| 5 | Background and resume | Returning to the app keeps or cleanly re-requests the connection |
| 6 | Account switch | Client observes the new address; no cross-account carryover |
| 7 | v0 sign-only behavior | Wallet returns a signed v0 transaction without submitting it |
| 8 | Unchanged message bytes | Returned message equals the approved message exactly |
| 9 | Device partial signatures | An existing device-session signature survives wallet signing |

Steps 7–9 verify properties the client already enforces: signing requires
`solana:signTransaction` with version `0`, a wallet that can only sign-and-send
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
OS or firmware build; wallet name and version; browser and surface; exposed
feature keys and supported transaction versions; result or error class. Never
record signer bytes, seed phrases, private keys, `.env` contents, keeper
secrets, or Android credentials.

Passing Gate G1 is a client-surface compatibility result only. It does not imply
Mainnet readiness, does not open paid Arcade, and is not deployment or Solana
dApp Store publication approval; each remains separately approved.
