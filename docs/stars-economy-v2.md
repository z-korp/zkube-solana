# Stars economy

This document is the source contract for the Stars economy implemented by the
program and client. It describes repository source, not the older live Devnet
binary. Stars are checked integer points in each `PlayerProfile`; they are not
an SPL token and cannot be transferred, withdrawn, redeemed, or traded.

## Per-player sources and sinks

| Flow | Stars | Repeatability | Notes |
| --- | ---: | --- | --- |
| Campaign improvement | up to 3/level | finite | Only improvement over the prior best is credited; 100 levels cap issuance at 300 Stars/player. |
| Level milestone | 10 | levels 10, 20, …, 100 | Ten one-time claims; 100 Stars/player maximum. |
| Weekly quests | 5 each | weekly | Two quests, 10 Stars total. |
| Level-100 Mastery | 30 | once/week | Requires level 100 and 2,500 qualifying XP during the current week; no backfill. |
| Weekly cash rank | 30 | weekly, skill-based | Every cash winner receives 30 Stars in addition to USDC. |
| Following Weekly band | 30/25/20/15/10 | weekly, skill-based | Applies after cash winners; begins at rank 1 when the cash pool is zero. |
| Star pack | 10/50/100/500/1,000 | purchased | Bound to the purchasing embedded identity; no daily purchase cap. |
| Zone unlock | -20 | once/zone | Map 1 is free; any other active map can be bought in any order; clears/perfection never unlock maps free. |
| Daily entry | -10 | every attempt | Unlimited while open; no free or direct-USDC entry; only the best finalized score ranks. |

The three rotating Daily quests award 100 XP each and the Daily Finisher awards
200 XP: at most 500 XP/day. The first finalized Daily attempt awards another
100 XP once that day. The two Weekly quests award 5 Stars each. Achievement XP
is excluded from the weekly Mastery counter.

Achievements are XP-only and total exactly 40,200 XP. There is no compatibility
delta path for older claims: Devnet may be reset and the source has one
canonical claim model.

### Level-100 Mastery

Mastery is earned, not a login grant. A player must have at least 160,000
lifetime XP and then record 2,500 qualifying XP in the current Monday-anchored
week. Qualifying XP is Daily-quest XP plus the first finalized Daily attempt's
100 XP. The claim that crosses the threshold automatically credits 30 Stars.
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
| New, skilled, no purchase | Perfect Map 1 +30; buy any later map -20; one Daily -10 | 0 Stars + 100 XP | The first map funds one deliberate unlock and one Daily; the client must make that choice visible. |
| New, misses one Campaign Star | Earns 29; pays 20 for Map 2 | 9 Stars; Daily blocked | This is the sharpest conversion cliff; surface the choice before spending and monitor 0–9 balances. |
| Pre-100, no placement | Both Weekly quests +10; one Daily -10 | net 0 | One repeatable entry is possible only if the player could already fund the three-Daily Explorer requirement. |
| Level 100, no placement | Weekly quests +10; Mastery +30; four entries -40 | net 0 | Durable baseline is four entries/week, with carry-over choosing the days. |
| Level 100, daily regular | Seven entries -70; Weekly quests +10; Mastery +30 | -30 gap | Daily regulars need carried finite Stars, placement, or a purchase. |
| Level 100, following Star band | Quests +10; Mastery +30; placement +10–30 | 50–70 available | Placement funds five to seven entries. |
| Level 100, cash winner | Quests +10; Mastery +30; cash-rank Stars +30 | 70 available plus USDC | Top players can fund one entry/day and still receive cash. |
| Competitive retry player | Buys 100 Stars for initial 9 USDC; ten entries -100 | 0 | Revenue scales with retries while ranking remains best-score, not spend total. |
| Progress-first player | Preserves finite 300 Campaign + 100 milestone Stars | up to 40 entries | Finite play grants meaningful participation without unbounded inflation. |

### Weekly steady state

| Player state | Quest Stars | Mastery | Placement | Repeatable total | Entries funded |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pre-100, no placement | 0–10 | 0 | 0 | 0–10 | 0–1 |
| Level 100, below 2,500 qualifying XP | 0–10 | 0 | 0 | 0–10 | 0–1 |
| Level 100, Mastery, no placement | 0–10 | 30 | 0 | 30–40 | 3–4 |
| Level 100, following band | 0–10 | 30 | 10–30 | 40–70 | 4–7 |
| Level 100, cash rank | 0–10 | 30 | 30 | 60–70 | 6–7 plus USDC |

Weekly Explorer requires three Daily entries, so a zero-balance player cannot
assume the full quest budget without carried/finite Stars or a purchase. Daily
quests can progress through Campaign replays except Daily-specific objectives.

Primary tuning signals are Stars spent per active player-day, first-purchase
conversion, attempts per entrant, map-purchase order, balances after zone
unlocks, perfect-clear rate, Weekly recycling, and the share of players blocked
at 0–9 Stars.

## Daily and Weekly competition

Daily opens permissionlessly at 00:00 UTC. Entries close at 23:00, runs at
23:30, and finalization becomes unconditional after the settlement grace. A
cancelled Daily refunds 10 Stars per entry exactly once.

Daily is neutral endless play with one public season-selected featured scoring
rule. Featured score ranks first; engine score, moves, and finish time break
ties. The seven families, 14 variants, pressure tiers, and deterministic weekly
rotation are specified in
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

The browser automatically attempts permissionless Daily/Weekly opens and
finalizers, rolls Daily results, refunds cancelled entries, and returns expired
Weekly cash. Operations still need a complete indexer/keeper because no browser
is guaranteed to remain online.

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
