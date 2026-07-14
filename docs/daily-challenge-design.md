# Daily Challenge design

## Campaign boundary

Campaign remains the authored PvE game. Its objectives, map-wide
mutator/bonus identity, fixed difficulty, move limits, bosses, and Star ratings
are not reused by Daily. Daily snapshots neutral gameplay rules: no Campaign
constraint, mutator, bonus, boss, or Star rating. The shared grid engine and
fresh row-by-row MagicBlock VRF remain authoritative in both modes.

## Immutable season and daily snapshot

Each `DailyRulesCatalog` is an immutable season snapshot containing a public
32-byte seed, 15 active scoring rules in 16 fixed slots, and one pressure
profile. Opening a day snapshots the selected scoring rule, theme, pressure,
neutral gameplay rules, catalog hash, and rules hash into `DailyChallenge`.
Every attempt for that UTC day therefore has identical public rules.

The seed deterministically:

1. shuffles the seven scoring families so each appears exactly once per UTC
   week;
2. rotates variants within a family across weeks without an immediate repeat;
3. walks the ten map themes with a seed-derived coprime step, preventing an
   adjacent theme repeat.

There is no fixed loop. Publishing a new season is an explicit governance
operation and does not alter an open Daily.

## Score model

Every legal move retains its pressure-adjusted engine score. A qualifying move
also receives a challenge bonus:

```text
weighted raw bonus = floor(objective raw points × rule weight / 100)
awarded bonus      = floor(weighted raw bonus × current pressure multiplier / 100)
Daily score        = engine score + awarded challenge bonus
pressure progress  = neutral engine points + weighted raw bonus
```

The pressure tier at the start of the move applies to both parts of that move.
Any newly crossed tier begins with the next move and next VRF row; the awarded
pressure multiplier never feeds back into pressure progress.

For Combo, Exact, Clutch, and Clean, objective raw points repeat the engine's
neutral pre-pressure points for that move. Blocks award one raw point per
destroyed block of the selected size. Survival awards one raw point per legal
move. Classic has no separate bonus because all engine points already count.

| Family | Variants | Rule weight |
| --- | --- | ---: |
| Classic | ordinary engine score | 0.00x |
| Combo | clear 2+ lines; clear 3+ lines | 2.00x; 12.50x |
| Exact | clear exactly 1, 2, or 3 lines | 1.00x; 2.50x; 12.50x |
| Blocks | destroy size 1, 2, 3, or 4 blocks | 0.50x; 1.25x; 1.40x; 2.00x |
| Clutch | start a scoring move at height 6 or 7 | 2.00x; 2.70x |
| Clean | finish a scoring move at height 2 or lower, or 3 or lower | 4.50x; 2.50x |
| Survival | complete a legal move | 1.00x |

The client explains the rule and weight before entry. During play it displays
Daily, engine, challenge-bonus, pressure, multiplier, objective state, bonus
pulses, and the 100-move endurance cap. Results preserve the same breakdown.

## Pressure

Pressure changes both generated block weights and the multiplier applied to
engine and challenge points. Daily begins at settled occupied height four.

| Tier | Starts at pressure | Score multiplier | Block weights, empty then sizes 1–4 |
| ---: | ---: | ---: | --- |
| 0 | 0 | 1.00x | 25 / 30 / 25 / 15 / 5 |
| 1 | 8 | 1.10x | 22 / 28 / 25 / 18 / 7 |
| 2 | 18 | 1.25x | 20 / 25 / 25 / 20 / 10 |
| 3 | 30 | 1.40x | 18 / 22 / 24 / 22 / 14 |
| 4 | 42 | 1.60x | 16 / 20 / 22 / 24 / 18 |
| 5 | 54 | 1.80x | 14 / 18 / 20 / 26 / 22 |
| 6 | 66 | 2.10x | 12 / 16 / 18 / 28 / 26 |
| 7 | 78 | 2.50x | 10 / 14 / 16 / 30 / 30 |

A game-over board ends the run. Reaching 100 completed moves also finalizes it,
which provides an endless-style endurance target while bounding computation.

## Entry, progression, ranking, and Weekly rollup

Each attempt costs the snapshotted economy price, initially 10 Stars. Retries
are unlimited while entries are open and only the best finalized eligible run
ranks. Entries close at 23:00 UTC, runs at 23:30, and the existing midnight
settlement grace remains unchanged.

The first finalized attempt each day grants 100 recurring XP. The first run
that reaches pressure tier 7 that day grants another 50 recurring XP. Daily
does not directly issue Stars, USDC, or a cash prize; standings become Weekly
points, and Weekly remains the reward surface.

An attempt ranks ahead when, in order, it has:

1. higher Daily score;
2. higher challenge bonus (`Daily - engine`);
3. higher engine score;
4. more completed moves;
5. lower player public key for deterministic ordering.

Absolute finish time is recorded for eligibility and audit but is not a
tie-break. Weekly continues to count a player's best five of seven Daily
results. Entry, refund, Star, and Weekly reward policy is defined in
[stars-economy-v2.md](stars-economy-v2.md).

## Tuning discipline and checked baseline

The ignored deterministic harness uses an objective-first greedy legal-move
bot. Run it without touching chain state:

```bash
NO_DNA=1 DAILY_SIMULATION_SEEDS=256 cargo test -p solana daily_catalog_simulation -- --ignored --nocapture
```

The checked 256-seed-per-rule baseline covers 3,840 runs. Every rule had zero
stuck nonterminal boards; runs ranged from 3 to the 100-move cap. This is a
relative regression baseline, not a prediction of human scores.

| Rule | Mean moves | Mean engine | Mean bonus | Bonus share | Mean Daily | Tier 7 by move 50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Classic | 62.0 | 57.7 | 0.0 | 0.0% | 57.7 | 0.0% |
| Combo 2+ | 49.8 | 50.4 | 38.8 | 43.5% | 89.2 | 16.8% |
| Combo 3+ | 54.2 | 53.5 | 40.0 | 42.8% | 93.6 | 27.7% |
| Exact 1 | 48.7 | 42.7 | 39.9 | 48.3% | 82.6 | 22.3% |
| Exact 2 | 50.7 | 51.3 | 43.6 | 45.9% | 95.0 | 22.7% |
| Exact 3 | 54.2 | 53.6 | 39.8 | 42.6% | 93.3 | 27.7% |
| Block size 1 | 48.1 | 46.6 | 30.9 | 39.9% | 77.6 | 7.0% |
| Block size 2 | 46.0 | 49.1 | 50.9 | 50.9% | 100.1 | 47.3% |
| Block size 3 | 51.7 | 53.7 | 43.2 | 44.6% | 96.9 | 21.5% |
| Block size 4 | 54.1 | 55.1 | 50.7 | 47.9% | 105.8 | 11.3% |
| Clutch height 6 | 55.5 | 55.7 | 51.1 | 47.8% | 106.8 | 14.5% |
| Clutch height 7 | 58.3 | 57.6 | 40.8 | 41.5% | 98.4 | 7.0% |
| Clean height 2 | 49.2 | 51.1 | 42.4 | 45.4% | 93.5 | 25.8% |
| Clean height 3 | 47.1 | 48.8 | 39.2 | 44.6% | 88.0 | 28.1% |
| Survival | 46.2 | 48.6 | 59.5 | 55.1% | 108.1 | 57.8% |

Thirteen of the fourteen bonus rules sit within roughly 40–51% bonus share.
Survival is intentionally higher: reducing its 1.00x weight would make its
promised one raw point floor to zero on early moves. Human telemetry should
drive later season weights; changing a weight requires publishing a new Daily
catalog and never mutates an already-open challenge.
