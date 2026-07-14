# Daily Challenge design

## Campaign boundary

Campaign remains the authored PvE game. Its level objectives, active/passive
mutators, bonuses, fixed difficulty trigger, move limits, bosses, and Star
ratings are not reused by Daily. The Solana implementation preserves those
rules while correcting four parity details:

- starting rows target the settled board's actual occupied height;
- percentage score multipliers round each settle phase independently;
- difficulties 6 and 7 retain a non-zero empty-cell weight, so every generated
  row is playable;
- the cumulative multi-line-clear counter is named Combo Meter everywhere.

Campaign bonus clears and their objective progress continue to score. Daily
runs have no active mutator, passive mutator, bonus, objective, or Star rating.

## Daily snapshot and rotation

Each immutable `DailyRulesCatalog` is a season snapshot containing a public
32-byte seed, 14 active scoring variants in 16 fixed slots, and one pressure
profile. Opening a day snapshots the selected scoring rule, theme, pressure,
neutral gameplay rules, catalog hash, and rules hash into `DailyChallenge`.
Every attempt for that day therefore has identical public rules.

The season seed deterministically:

1. shuffles the seven scoring families so each appears exactly once per UTC
   week;
2. rotates variants within a family across weeks without an immediate repeat;
3. walks the ten map themes with a seed-derived coprime step, preventing an
   adjacent theme repeat.

There is no fixed 14-day loop. Publishing a new season is an explicit
governance operation and does not alter an already-open Daily.

## Featured scoring pool

Only normal moves add featured points. The selected metric is the primary
Daily leaderboard score; the ordinary engine score remains a tie-break.

| Family | Variants | Featured points for one move |
| --- | --- | --- |
| Classic | one | Tier-adjusted engine points earned by the move. |
| Combo | minimum 2 lines; minimum 3 lines | Below the minimum: 0. Otherwise 2 lines = 1, 3 = 3, 4 = 6, 5+ = 10. |
| Lines | exact one; total lines | Exact-one scores 1 only for a one-line clear. Total-lines scores one per line. |
| Blocks | target sizes 1, 2, 3, or 4 | One per target-size block destroyed by the normal move. |
| Clutch | starting height 6; starting height 7 | If the stack starts at or above the target: 1 line = 1, 2 = 3, 3 = 6, 4+ = 10. |
| Clean | ending height 2; ending height 3 | One per line if the settled board ends at or below the target height. |
| Survival | one | `1 + pressure tier` for every completed move. |

The client explains the selected rule before entry and displays featured score
as the hero number during play and after the run.

## Pressure

Pressure is an independent neutral score: engine base points before the Daily
tier multiplier. It controls generated block weights and the engine-score
multiplier, but never directly replaces the featured metric.

| Tier | Starts at pressure | Engine multiplier | Block weights, empty then sizes 1–4 |
| ---: | ---: | ---: | --- |
| 0 | 0 | 1.00x | 25 / 30 / 25 / 15 / 5 |
| 1 | 15 | 1.10x | 22 / 28 / 25 / 18 / 7 |
| 2 | 40 | 1.25x | 20 / 25 / 25 / 20 / 10 |
| 3 | 80 | 1.40x | 18 / 22 / 24 / 22 / 14 |
| 4 | 150 | 1.60x | 16 / 20 / 22 / 24 / 18 |
| 5 | 280 | 1.80x | 14 / 18 / 20 / 26 / 22 |
| 6 | 500 | 2.10x | 12 / 16 / 18 / 28 / 26 |
| 7 | 900 | 2.50x | 10 / 14 / 16 / 30 / 30 |

Daily starts at a settled occupied height of four. Every row consumes a fresh
run-scoped MagicBlock VRF result. A game-over board ends the run; 180 moves is
the emergency terminal cap. This cap bounds accounts and computation while
leaving normal runs governed by board pressure.

## Ranking and Weekly rollup

An attempt is better when, in order, it has:

1. higher featured score;
2. higher engine score;
3. more completed moves;
4. earlier finish time;
5. lower player public key for deterministic leaderboard ordering.

Only a player's best finalized eligible attempt is stored in the Daily
leaderboard. The existing percentile/rank bands convert that Daily position to
Weekly points, and the Weekly contest continues to count the best five of seven
days. Entry cost, refunds, Star issuance, and Weekly USDC/Star rewards are
defined in [stars-economy-v2.md](stars-economy-v2.md).

## Tuning discipline

Before a new season is published, deterministic tests must cover every scoring
formula, pressure boundary, seven-family weekly coverage, variant/theme repeat
rejection, and leaderboard ties. Offline bot simulations should compare run
length and score distributions per rule without becoming part of the shipped
client; the browser remains a renderer of authoritative chain state.

The checked-in ignored Rust harness can be run with
`NO_DNA=1 cargo test -p solana daily_catalog_simulation -- --ignored --nocapture`.
Its initial 64-seed greedy-legal-move baseline was:

| Rule | Mean moves | Mean featured | Stuck runs |
| --- | ---: | ---: | ---: |
| Classic | 83.2 | 71.3 | 0 |
| Combo 2+ | 83.2 | 10.0 | 0 |
| Combo 3+ | 83.2 | 1.6 | 0 |
| Exact one line | 77.1 | 54.8 | 0 |
| Total lines | 83.2 | 63.4 | 0 |
| Block size 1 / 2 / 3 / 4 | 77.8 / 85.3 / 88.1 / 92.0 | 122.0 / 86.7 / 52.2 / 20.6 | 0 |
| Clutch height 6 / 7 | 83.2 / 83.2 | 29.6 / 18.6 | 0 |
| Clean height 2 / 3 | 82.9 / 83.2 | 11.2 / 22.1 | 0 |
| Survival | 83.2 | 204.8 | 0 |

This is a regression baseline, not a claim about human score distributions.
Runs ranged from 7 to 180 moves depending on seed and rule-oriented greedy
choices; some reaching 180 confirms the emergency cap is reachable.
