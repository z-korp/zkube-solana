# zKube

zKube is a family of falling-block puzzle games where clearing lines feeds combos.
**zKube: Realms** is the walletless Android game for Google Play, with Campaign
and a local UTC Daily. **zKube: Arena** is the Solana dApp Store and Seeker game,
with free local Campaign play and paid Arcade competition.

Both products share the 100-level Campaign, the Unity pages and board, and one
deterministic Rust engine. The original Starknet release, **zKube: Origins**,
spent several months among that network's most-used contracts.

## Status

There is no live deployment. The former Devnet release was abandoned; the
current source is being prepared for a fresh v5 bootstrap. Store billing and
distribution remain in development. Mainnet requires counsel, economic and
distribution review before paid competition takes real money.

## How it works

**Campaign** plays locally in both products. Arena uses the connected Solana
address as identity; playing needs no device session, signature or SOL and does
not gate Arcade. Realms stays walletless and applies its purchase policy to
realms 4–10. Both use the same progression rules and local Campaign client.

Each attempt draws a fresh 32-byte platform seed and saves it before play.
Accepted actions are persisted so an unfinished trial resumes by replaying
through Rust on its own device. Losing that device means replaying the trial.

The 25-byte on-chain star array is the Arena player's Campaign save, written
by their own device and synchronized across their devices. The program does
not verify it and it has no effect on money. Local best stars merge by maximum;
background updates wait for a funded device session without interrupting play.
Only lifetime-best stars cross devices. Emblems 1–12 reflect that reported
progress; stars grant no SOL, entries or prize eligibility.

**Arcade** is Arena's competitive mode. The owner prepays Kredits at exactly
0.01 SOL each, in packs of 1, 10 or 25 at the same unit price. Kredits are
one-way: no withdrawal, transfer, cash-out or bonus grants. An authorized device
can spend the balance, within the owner's chosen cap.

The operator's 10% goes directly to the protocol's team destination at purchase;
the vault holds prize money only. Spending a Kredit sends the remaining 90% to
the following paid Daily, including across suspensions. Prior play funds today's
pot; an entry never increases the pot it competes for. Every paid entry becomes
scored or expired, without a refund path.

**The Daily** draws one realm and one protocol objective from a deterministic
without-replacement cycle. The realm supplies its guardian and starting height;
one shared tier table and pressure formula govern play. A guardian starts with
no charges and earns them through its trigger. Every run starts with one reroll,
holds at most three, and earns one on a perfect clear in either mode.

Arcade entries remain open until the 23:59 UTC freeze. A run with an accepted
action scores its last committed state; an untouched or unrecoverable run
expires. Realms instead plays its UTC Daily locally, without chain access.

**Prizes** split Score and Theme equally over the same runs. Score ranks action
points; Theme ranks only the drawn fact's count and never adds to Score or
pressure. Both require a positive metric. If nobody qualifies on Theme, its
half folds into Score; Classic always has an empty Theme board. Each player
keeps one best run per board.

Payout weights follow 1/rank, through the last rounded payout covering entry
price, floored at four places before limiting to qualifiers. Small pots can
pay less than an entry price; zero payouts are dropped. Payouts floor to 0.001
SOL and dust rolls forward. The retained board has a tested capacity; shares
beyond it roll over without changing the denominator.

Finalization funds each board's exact final rent. Sorted chunk writes grow it
and the program verifies results, ordering and count before sealing. Winners
claim directly by position for thirty days from that board's sealing. An entry
can prepend up to two eligible claims in the same transaction; already-claimed
or expired positions are no-ops. Explicit claims remain available. After both
windows and archival, unclaimed prizes return to the next pot, not revenue.

**The ladder** awards a flat credit for first qualification on each board and
integer log-rank points for placing, based on that board's field size. Points
accumulate, do not decay and pay no SOL. The highest tier stays on the profile;
the visible entry streak does not multiply points. A reset needs an announced
decision. Any championship is discretionary and separately funded.

## Architecture

| Component | Responsibility |
| --- | --- |
| crates/zkube-core | Deterministic gameplay, metrics, clocks, payouts and replay |
| crates/zkube-core-host | Safe native codecs and keeper WASM exports |
| crates/zkube-core-ffi | Native byte boundary for Unity |
| programs/solana | Player records, Arcade lifecycle, accounting and settlement |
| services | Independently funded keeper, with no inbound HTTP surface |
| tools/chain | Operator CLI and the single checked-in program IDL |
| unity | Both Android identities, shared pages and Rust gameplay |
| assets | Authoritative artwork and presentation inputs |
| tools/art | Optional artwork authoring scripts |
| fixtures | Core golden vectors and Rust-produced boundary scenarios |

Arcade gameplay uses a Router-resolved MagicBlock ephemeral rollup for actions
and VRF, then commits to Solana base layer for settlement. Replay commitments
bind identity, rules and ordered events; permanent result rows retain them for
independent recomputation. The keeper handles cadence and last-resort recovery
under separately approved write and spend limits. It cannot deploy, initialize,
change terms or reach mainnet. The program remains the settlement authority.

Realms ships as an ARM64/x86_64 AAB without money assemblies or wallet plugins.
Arena uses the Kotlin Mobile Wallet Adapter plugin. Seed Vault Wallet on Seeker
is the reference target, with Phantom and Solflare on Android as additional
compatibility targets. Sign-only transactions, exact message bytes and retained
device partial signatures are checked before relay.

## Contributing

Read AGENTS.md before changing source, keeper behavior or anything moving SOL.
It owns working rules, locked protocol rules and operator procedures. Toolchain
versions live in rust-toolchain.toml and unity/toolchain.json; package dependencies
use the root workspace lockfile. validate.sh defines the change and release
gates. Android handoff metadata lives under unity/dapp-store.

## License

Licensed under the Apache License, Version 2.0 — see [LICENSE](LICENSE).
Unless explicitly stated otherwise, contributions submitted for inclusion are
licensed on the same terms, without additional conditions.
