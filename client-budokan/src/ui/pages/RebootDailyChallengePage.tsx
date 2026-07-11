import { useMemo } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useRebootDaily } from "@/solana/reboot/useRebootDaily";
import { useNavigationStore } from "@/stores/navigationStore";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";

export default function RebootDailyChallengePage() {
  const { publicKey } = useEmbeddedIdentity();
  const goBack = useNavigationStore((state) => state.goBack);
  const navigate = useNavigationStore((state) => state.navigate);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const setIsDailyMap = useNavigationStore((state) => state.setIsDailyMap);
  const daily = useRebootDaily();
  const playerRank = useMemo(() => {
    if (!publicKey || !daily.daily) return 0;
    const index = daily.daily.leaderboard.findIndex((entry) =>
      entry.player.equals(publicKey),
    );
    return index < 0 ? 0 : index + 1;
  }, [daily.daily, publicKey]);

  const openRun = () => {
    setMapZoneId(daily.run.activeRun?.mapId ?? daily.daily?.mapId ?? 1);
    setIsDailyMap(true);
    navigate("solana");
  };
  const enter = async (payment: "stars" | "usdc") => {
    const run = await daily.enter(payment);
    setMapZoneId(run.mapId);
    setIsDailyMap(true);
    navigate("solana");
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#050812] pb-24 pt-12 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#172554_0%,transparent_50%),linear-gradient(#050812,#090317)]" />
      <header className="relative z-10 flex items-center justify-center px-6 pb-4">
        <button
          onClick={goBack}
          className="absolute left-5 rounded-xl border border-white/10 bg-white/5 p-2 text-white/70"
        >
          <ChevronLeft />
        </button>
        <div className="text-center">
          <h1 className="text-2xl font-black">Daily Arena</h1>
          <p className="text-[10px] uppercase tracking-[0.25em] text-cyan-300/70">
            Solana · MagicBlock VRF
          </p>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {daily.loading && !daily.daily && (
          <Card>
            <Loader2 className="animate-spin text-cyan-300" />
            <span>Loading today’s challenge…</span>
          </Card>
        )}

        {!daily.loading && !daily.daily && (
          <Card>
            <h2 className="text-xl font-black">Challenge not published</h2>
            <p className="text-center text-sm text-white/55">
              The protocol operator has not created today’s immutable rules and
              accounting window yet. Player wallets cannot create contests.
            </p>
          </Card>
        )}

        {daily.daily && (
          <>
            <Card>
              <div className="flex w-full items-start justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-cyan-300">
                    Day {daily.daily.dayId}
                  </div>
                  <h2 className="text-2xl font-black">
                    Map {daily.daily.mapId} Endless
                  </h2>
                </div>
                <Status value={daily.daily.status} />
              </div>
              <div className="grid w-full grid-cols-2 gap-2 text-center sm:grid-cols-4">
                <Stat
                  label="Prize liability"
                  value={`${formatUsdc(daily.daily.prizeLiability)} USDC`}
                />
                <Stat
                  label="Sponsor boost"
                  value={`${formatUsdc(daily.daily.sponsorFunding)} USDC`}
                />
                <Stat
                  label="Attempts"
                  value={(
                    daily.daily.totalPaidAttempts +
                    daily.daily.totalFreeAttempts
                  ).toString()}
                />
                <Stat
                  label="Your best"
                  value={daily.daily.player?.bestScore.toString() ?? "—"}
                />
              </div>
              <div className="w-full rounded-xl bg-black/25 p-3 text-xs text-white/55">
                <div className="flex justify-between">
                  <span>Entries close</span>
                  <span>{formatTime(daily.daily.entriesCloseAt)}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span>Runs close</span>
                  <span>{formatTime(daily.daily.runsCloseAt)}</span>
                </div>
                {daily.daily.claimsCloseAt > 0 && (
                  <div className="mt-1 flex justify-between">
                    <span>Prize claims close</span>
                    <span>{formatTime(daily.daily.claimsCloseAt)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between">
                  <span>Entry split</span>
                  <span>90% prizes · 10% rake</span>
                </div>
                {daily.daily.status === "closed" && (
                  <div className="mt-1 flex justify-between">
                    <span>Forfeited to reward reserve</span>
                    <span>{formatUsdc(daily.daily.prizeForfeited)} USDC</span>
                  </div>
                )}
              </div>

              {!daily.daily.playerEligible && (
                <p className="rounded-lg bg-yellow-950/50 px-3 py-2 text-center text-xs text-yellow-200">
                  Clear Campaign Map 1 to unlock Daily Arena.
                </p>
              )}

              {(daily.run.phase === "delegated" ||
                daily.run.phase === "base") && (
                <Action onClick={openRun}>Resume active run</Action>
              )}
              {daily.run.phase === "settled" && (
                <div className="flex gap-2">
                  <Action onClick={openRun}>View result</Action>
                  <Action onClick={() => action(daily.run.cleanup())} secondary>
                    Collect rent
                  </Action>
                </div>
              )}
              {(daily.run.phase === "none" ||
                daily.run.phase === "missing") && (
                <div className="flex w-full flex-col gap-2 sm:flex-row">
                  <Action
                    disabled={
                      Boolean(daily.action) ||
                      !daily.daily.playerEligible ||
                      Boolean(daily.daily.player?.freeAttemptUsed) ||
                      daily.daily.playerStars < daily.daily.starEntryCost
                    }
                    onClick={() => action(enter("stars"))}
                  >
                    {daily.action === "enter:stars"
                      ? "Preparing…"
                      : `${daily.daily.starEntryCost} Stars attempt`}
                  </Action>
                  <Action
                    disabled={
                      Boolean(daily.action) || !daily.daily.playerEligible
                    }
                    onClick={() => action(enter("usdc"))}
                    secondary
                  >
                    {daily.action === "enter:usdc"
                      ? "Preparing…"
                      : `${formatUsdc(daily.daily.entryPrice)} USDC attempt`}
                  </Action>
                </div>
              )}

              {daily.daily.status === "claimable" &&
                playerRank > 0 &&
                !daily.daily.player?.claimed && (
                  <Action
                    disabled={Boolean(daily.action)}
                    onClick={() => action(daily.claim())}
                  >
                    Claim rank #{playerRank} prize
                  </Action>
                )}
              {daily.daily.status === "cancelled" && daily.daily.player && (
                <Action
                  disabled={Boolean(daily.action)}
                  onClick={() => action(daily.refund())}
                >
                  Claim cancelled-entry refund
                </Action>
              )}
              {daily.error && (
                <p className="text-center text-xs text-red-300">
                  {daily.error}
                </p>
              )}
            </Card>

            <Card>
              <div className="flex w-full items-center justify-between">
                <h2 className="text-lg font-black">Top 10</h2>
                <span className="text-xs text-white/40">
                  Best finalized score only
                </span>
              </div>
              <div className="flex w-full flex-col gap-1">
                {daily.daily.leaderboard.length === 0 && (
                  <p className="py-4 text-center text-sm text-white/40">
                    No finalized scores yet.
                  </p>
                )}
                {daily.daily.leaderboard.map((entry, index) => (
                  <div
                    key={entry.player.toBase58()}
                    className={`grid grid-cols-[2rem_1fr_auto] items-center rounded-lg px-3 py-2 text-sm ${entry.player.equals(publicKey!) ? "bg-cyan-500/15 text-cyan-100" : "bg-white/[0.04]"}`}
                  >
                    <strong>#{index + 1}</strong>
                    <span className="truncate font-mono text-xs text-white/55">
                      {shortKey(entry.player.toBase58())}
                    </span>
                    <strong>{entry.score}</strong>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex w-full flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-xl">
      {children}
    </section>
  );
}

function Action({
  children,
  onClick,
  disabled,
  secondary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-xl px-5 py-3 text-sm font-black disabled:opacity-35 ${secondary ? "border border-white/15 bg-white/10 text-white" : "bg-cyan-500 text-slate-950"}`}
    >
      {children}
    </button>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
      {value}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/25 p-2">
      <strong className="block text-sm text-white">{value}</strong>
      <span className="text-[9px] uppercase text-white/35">{label}</span>
    </div>
  );
}

function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatTime(unix: number): string {
  return new Date(unix * 1_000).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function shortKey(value: string): string {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function action(promise: Promise<unknown>): void {
  void promise.catch(() => {
    // The hooks project transaction failures into user-facing state.
  });
}
