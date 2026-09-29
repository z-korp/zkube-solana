# zKube

zKube is a family of falling-block puzzle games where clearing lines feeds combos.
**zKube: Realms** is the walletless Android game for Google Play, with Campaign
and a local UTC Daily. **zKube: Arena** is the Solana dApp Store and Seeker game,
with free local Campaign play and paid Arcade competition.

Both products share the 100-level Campaign, the Unity pages and board, and one
deterministic Rust engine. The original Starknet release, **zKube: Origins**,
spent several months among that network's most-used contracts.

Both wear the Lumen skin: ten painted realms, each with its own light, motes
and block tints, and a guardian who leans on the board and speaks. Guardians
greet the player on the map, before a level and on results in a talk scene
that types their authored lines.

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
| crates/zkube-codegen | Catalog validation and every generated file: C# schemas, skin slots, captions, fixtures |
| programs/solana | Player records, Arcade lifecycle, accounting and settlement |
| services | Independently funded keeper, with no inbound HTTP surface |
| tools/chain | Operator CLI and the single checked-in program IDL |
| unity | Both Android identities, shared pages and board over the Rust engine |
| assets | Authoritative artwork, audio, brand files and the authored catalog |
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

## Working with the codebase

Read AGENTS.md before changing source, keeper behavior or anything moving SOL.
It owns the working rules, the locked protocol rules and operator procedures;
this section is the map.

### Layout

- crates/zkube-core is the one engine. The program, the keeper (through WASM)
  and Unity (through crates/zkube-core-ffi) all run it; nothing re-implements a
  rule in another language.
- crates/zkube-codegen reads assets/catalog.json and the skins and writes every
  generated file: the C# schemas and slot names under unity/Assets/ZKube/Generated,
  assets/theme-catalog.generated.json, the native fixtures and the protocol
  constants. Generated files are never edited by hand.
- programs/solana is the Anchor program; tools/chain is its operator CLI and IDL;
  services is the keeper.
- unity/Assets/ZKube/Runtime holds the shared pages, board, kit and talk scene;
  Integration holds Arena's chain and wallet code; Local holds Realms' saves and
  billing; Rendering holds the URP 2D renderer; Android holds the launch window;
  Editor holds the build and import steps; Tests holds the EditMode and PlayMode
  suites. unity/toolchain.json pins the editor, Android toolchain and the
  two product identities; unity/tools/build.py is the only way to run Unity.
- assets/ is the source of truth for art: catalog.json (realms, guardian titles
  and lines), skins/lumen (the UI kit and each realm's paintings, blocks, ledge,
  mote and tokens), theme-N (each guardian's frames, paws and contact points),
  common (shared images and sounds) and brand (each product's icon and splash).
- unity/dapp-store holds the Solana dApp Store publishing metadata.

### Setup and everyday commands

Prefix Solana, Anchor and chain commands with NO_DNA=1. Toolchain versions live
in rust-toolchain.toml and unity/toolchain.json; the Unity Editor is expected
under ~/Unity/Hub/Editor/<version>.

- Rust: cargo test and cargo clippy --workspace --all-targets. The program's SBF
  tests load the built program, so run NO_DNA=1 anchor build first.
- Generated files: NO_DNA=1 cargo run -p zkube-codegen -- generate after
  changing the catalog, a skin or a rule the codegen emits; -- check verifies
  nothing drifted.
- TypeScript: pnpm install, then pnpm build, pnpm test, pnpm lint and pnpm
  typecheck. In a fresh worktree pnpm test needs pnpm build first. The
  documentation tests check that every backticked name in AGENTS.md exists and
  that retired vocabulary stays out of source and these documents.
- Unity, always through the build tool, which holds a lease so two runs never
  share an Editor:
  - python3 unity/tools/build.py test --test-platform all (or EditMode,
    PlayMode, with --test-filter) prepares imports, atlases and fonts, then runs
    the suites.
  - python3 unity/tools/build.py android --identity store builds the Realms AAB
    and a universal APK; --identity money builds the Arena APK. Both are
    inspected after the build.
  - python3 unity/tools/build.py fixtures --fixture-action generate regenerates
    the Rust-produced fixtures; check verifies them.
- The build tool's own tests: cd unity/tools && python3 -m unittest discover -s
  tests -p 'test_*.py'.

### Skins and art

A skin is a folder under assets/skins/<id>/ listed in catalog.json. Its slots
are declared once, in crates/zkube-codegen/src/skins.rs: the UI kit pieces
(stretched ones with their slice borders in skin.json), the ladder borders and
badges, and for each realm a background, a HUD background and a map painting
(JPEG), and its ledge, mote and four block sprites (PNG with alpha). Each realm
has tokens.json with its block tints and light colours, and skin.json places
each realm's key light, shafts and motes. The codegen rejects a missing,
extra or wrongly typed file, and the Unity tests render the kit to catch seams
and stray highlights.

Guardians live in assets/theme-N/boss: ten full frames (idle, blink, talking,
moods, portrait), a separate paws layer drawn over the board rim, and
contact.json giving the rail line they lean on. Their title and ten lines are
authored per realm in catalog.json. To change art, replace the file in assets/
and run the codegen and the Unity tests; build.py imports it into the atlases.

### Content and words

Player-facing words have one owner each. Goal and Daily objective captions
come from crates/zkube-codegen/src/captions.rs; guardian lines and realm names
from catalog.json; page copy from the page that shows it. A retired model's
words are listed in services/tests/supersession.test.ts so they cannot return.

### Devices

The Realms store build includes x86_64 and runs on the Android emulator. The
Arena money APK is arm64 only and needs a physical device, such as the Seeker.
Production candidates need an explicit version code and the owner's release
signing; the Android rule in AGENTS.md names both.

## License

Licensed under the Apache License, Version 2.0 — see [LICENSE](LICENSE).
Unless explicitly stated otherwise, contributions submitted for inclusion are
licensed on the same terms, without additional conditions.
