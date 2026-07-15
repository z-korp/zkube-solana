# Stars economy

This document is the source contract for the Stars economy implemented by the
program and client. It describes repository source, not the older live Devnet
binary. Stars are checked integer points in each `PlayerProfile`; they are not
an SPL token and cannot be transferred, withdrawn, redeemed, or traded.

## Per-player sources and sinks

| Flow | Stars | Repeatability | Notes |
| --- | ---: | --- | --- |
| Campaign improvement | up to 3/level | finite | Only improvement over the prior best is credited; 100 levels cap issuance at 300 Stars/player. |
| Perfect map | 20 | once/map | All ten levels must hold a three-Star best; the same atomic reward also credits 1,000 finite lifetime XP. |
| Level milestone | 10 | levels 10, 20, …, 100 | Ten one-time claims; 100 Stars/player maximum. |
| Daily Finisher | 2 | daily | Requires claiming all three selected Daily quests; also awards 200 XP. |
| Weekly quests | 5 each | weekly | Two quests, 10 Stars and 1,000 XP total. |
| Level-100 Mastery | 30 | once/week | Requires level 100 and 2,500 qualifying XP during the current week; no backfill. |
| Weekly cash rank | 30 | weekly, skill-based | Every cash winner receives 30 Stars in addition to USDC. |
| Following Weekly band | 30/25/20/15/10 | weekly, skill-based | Applies after cash winners; begins at rank 1 when the cash pool is zero. |
| Star pack | 10/50/100/500/1,000 | purchased | Bound to the exact connected owner address; every USDC purchase is owner-approved; no daily purchase cap. |
| Zone unlock | -20 | once/zone | Map 1 is free; any other active map can be bought in any order; clears/perfection never unlock maps free. |
| Daily entry | -10 | every attempt | Unlimited while open; no free or direct-USDC entry; only the best finalized score ranks. |

Three distinct Daily quests are deterministically mixed from a nine-quest pool
each UTC day, with no more than two combo quests. They award 100 XP each; the
Daily Finisher awards 200 XP plus 2 Stars. The first finalized Daily attempt
awards another 100 XP once that day, and the first pressure-tier-7 finish adds
50 XP. The two Weekly quests award 500 XP and 5 Stars each. Achievement and
perfect-map XP are excluded from the weekly Mastery counter.

The Block Breaker pool slot also varies deterministically by UTC day. It draws
evenly from calibrated `(block size, target)` variants: size 1 at 6 or 8,
size 2 at 8 or 10, size 3 at 6 or 8, and size 4 at 5 or 6. Authoritative run
settlement accumulates all four size counters throughout the day, so the shown
objective, claim check, and client progress always use the same daily variant.

Achievements are XP-only and total exactly 40,200 XP. There is no compatibility
delta path for older claims: Devnet may be reset and the source has one
canonical claim model.

### Level-100 Mastery

Mastery is earned, not a login grant. A player must have at least 160,000
lifetime XP and then record 2,500 qualifying XP in the current Monday-anchored
week. Qualifying XP is all Daily/Weekly quest XP plus the Daily first-finish
and first-tier-7 XP. The claim that crosses the threshold automatically credits
30 Stars.
The stipend rolls by week, awards at most once, never backfills missed weeks,
and has no separate manual faucet button.

### Star packs

Regular prices are stored as six-decimal USDC base units in `EconomyConfig`.
The pricing operator may update prices/enabled flags or schedule one discounted
half-open sale window. Purchases bind expected Stars and maximum USDC so a
stale client quote fails safely.

| Pack | Initial regular price | Effective price / 10 Stars | Daily entries | 20-Star unlocks |
| ---: | ---: | ---: | ---: | ---: |
| 10 Stars | 1.00 USDC | 1.00 USDC | 1 | 0 |
| 50 Stars | 4.75 USDC | 0.95 USDC | 5 | 2 + 10 Stars |
| 100 Stars | 9.00 USDC | 0.90 USDC | 10 | 5 |
| 500 Stars | 42.50 USDC | 0.85 USDC | 50 | 25 |
| 1,000 Stars | 80.00 USDC | 0.80 USDC | 100 | 50 |

## Individual-player projections

Stars are non-transferable, so supply and affordability must be reasoned about
per identity rather than across the whole player base.

| Player story | Earn/spend sequence | End state | Product implication |
| --- | --- | ---: | --- |
| New, skilled, no purchase | Perfect Map 1 +50; buy any later map -20; one Daily -10 | 20 Stars + 1,000 finite XP | Perfection funds one unlock, one Daily, and preserves two more entries. |
| New, misses one Campaign Star | Earns 29; pays 20 for Map 2 | 9 Stars; Daily blocked | This is the sharpest conversion cliff; surface the choice before spending and monitor 0–9 balances. |
| Pre-100, full quest week | Finishers +14; Weeklies +10 | 24 Stars | Funds two entries and carries 4 Stars toward the next one. |
| Level 100, no placement | Finishers +14; Weeklies +10; Mastery +30 | 54 Stars | Durable baseline funds five entries and carries 4 Stars. |
| Level 100, daily regular | Seven entries -70 against +54 baseline | -16 gap | Daily regulars still need finite Stars, placement, or a purchase. |
| Level 100, following Star band | Quest/Mastery +54; placement +10–30 | 64–84 available | Placement funds six to eight entries. |
| Level 100, cash winner | Quest/Mastery +54; cash-rank Stars +30 | 84 available plus USDC | Top players fund seven entries plus one retry while receiving cash. |
| Competitive retry player | Buys 100 Stars for initial 9 USDC; ten entries -100 | 0 | Revenue scales with retries while ranking remains best-score, not spend total. |
| Progress-first player | Earns 300 level + 200 perfection + 100 milestone; spends 180 on nine unlocks | 420 net Stars | Finite mastery funds 42 Daily entries after unlocking every current map. |

### Weekly steady state

| Player state | Quest Stars | Mastery | Placement | Repeatable total | Entries funded |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pre-100, no placement | 0–24 | 0 | 0 | 0–24 | 0–2 |
| Level 100, below 2,500 qualifying XP | 0–24 | 0 | 0 | 0–24 | 0–2 |
| Level 100, Mastery, no placement | 0–24 | 30 | 0 | 30–54 | 3–5 |
| Level 100, following band | 0–24 | 30 | 10–30 | 40–84 | 4–8 |
| Level 100, cash rank | 0–24 | 30 | 30 | 60–84 | 6–8 plus USDC |

The maximum qualifying recurring XP in a fully completed week is 5,550:

| Source | Weekly XP |
| --- | ---: |
| Three Daily quests | 2,100 |
| Daily Finisher | 1,400 |
| First finalized Daily | 700 |
| First tier-7 Daily | 350 |
| Two Weekly quests | 1,000 |

Tier-7 XP improves the routes to the 2,500-XP Mastery threshold but does not
mint Stars directly. A player still has to reach level 100 before the weekly
30-Star faucet can award.

Weekly Explorer requires three Daily entries, so a zero-balance player cannot
assume the full quest budget without carried/finite Stars or a purchase. Daily
quests can progress through Campaign replays except the Daily-entry objective.

Primary tuning signals are Stars spent per active player-day, first-purchase
conversion, attempts per entrant, map-purchase order, balances after zone
unlocks, perfect-clear rate, Weekly recycling, and the share of players blocked
at 0–9 Stars.

## Daily and Weekly competition

Daily opens permissionlessly at 00:00 UTC. Entries close at 23:00, runs at
23:30, and finalization becomes unconditional after the settlement grace. A
cancelled Daily refunds 10 Stars per entry exactly once.

Daily is neutral 100-move endurance play with one public season-selected bonus
rule. Every normal engine point counts; qualifying play adds a weighted,
pressure-adjusted challenge bonus. Daily score ranks first, followed by
challenge bonus, engine score, moves, and player public key. The seven
families, 15 variants, pressure tiers, and deterministic weekly rotation are
specified in
[daily-challenge-design.md](daily-challenge-design.md).

| Daily band | Points | Rank/percentile bound |
| --- | ---: | --- |
| Elite | 100 | top 1%, maximum rank 3 |
| High | 60 | top 5%, maximum rank 10 |
| Strong | 30 | top 10%, maximum rank 20 |
| Placed | 10 | top 25%, maximum rank 50 |
| Participated | 2 | every other finalized player |

Weekly cadence is Monday through Sunday UTC. Finalization opens Monday 06:00.
Each player records at most one result/day and the best five results count.
Daily-to-Weekly rollup and both finalizers are permissionless. Weekly
finalization verifies every eligible Daily player was rolled up.

| Weekly band | Winners | Reward |
| --- | ---: | --- |
| Cash | `min(3, ceil(participants × 5%))` when pool > 0 | 55/30/15 USDC weights, renormalized when fewer than 3, plus 30 Stars each |
| Stars | next `min(20, ceil(participants × 5%))` | 30/25/20/15/10 Stars by equal rank quantiles |
| No cash pool | cash band 0 | Star band begins at rank 1 |

Cash claims may create the winner's associated USDC account with sponsored
rent. Claims close 90 days after finalization. Expiry returns the exact
unclaimed Weekly-vault balance to the reward reserve.

## Revenue and custody

A Star purchase first executes three checked transfers and credits Stars only
after all succeed. Shares use floor division; all dust goes to treasury.

| Destination | Share | Custody purpose |
| --- | ---: | --- |
| Team destination | 10% | development and operations |
| Reward reserve | 10% | future Weekly cash pools |
| Treasury destination | 80% + dust | retained protocol treasury |

For gross base-unit amount `G`:

```text
team     = floor(G × 1000 / 10000)
rewards  = floor(G × 1000 / 10000)
treasury = G - team - rewards
```

The `StarSalesLedger` must always satisfy gross = team + rewards + treasury.
Team and treasury are external mint-matched token accounts. The reward reserve
is program-controlled so Weekly open can move only its bounded snapshotted
pool. Active Weekly liabilities never enter treasury.

The program contains no yield adapter or accounting fiction for unrealized
yield. Treasury yield, if introduced later, must be an external, separately
reviewed operation with explicit USDC movement approval, loss/liquidity limits,
and no authority over reward or contest vaults.

## Controls and automation

`ProtocolConfig` stores authority/pending authority, pricing operator,
paymaster, destinations, payment asset, content version, and pause. Authority
transfer is two-step. Team/treasury destination changes require the protocol to be paused;
the program-owned reward reserve remains pinned.
The pricing operator can change only regular pack prices/enabled flags and the
single sale schedule.

The five-minute server keeper is the primary cadence reconciler: it opens and
finalizes Daily/Weekly challenges, rolls every eligible Daily result, returns
expired Weekly cash, and reclaims completed account rent. The browser retains
the same permissionless maintenance as a fallback. Owner-only Weekly claims
and cancelled-Daily refunds are scanned across all outstanding records and
signed silently by the valid scoped device session on the player's next visit.

## Fresh Devnet rollout

The source intentionally drops compatibility migrations. Existing Devnet state
may be reset. No step is authorized by this document.

1. Review and validate the exact SBF/IDL candidate.
2. Separately approve and perform the program upgrade or fresh deployment.
3. Create three mint-matched destinations: external team, external treasury,
   and program-controlled reward reserve.
4. Initialize `ProtocolConfig`, `EconomyConfig`, `StarSalesLedger`, Daily rules,
   and ten map catalogs; verify owners, sizes, discriminators, PDAs, and values.
5. Verify pricing operator, paymaster, pause state, 10/10/80 split behavior,
   and zeroed sales accounting.
6. Run separately approved Devnet acceptance flows for a Star purchase, zone
   unlock, Daily entry/refund/settlement, Weekly rollup, and reward claim.
