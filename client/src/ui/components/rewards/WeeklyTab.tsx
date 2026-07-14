import { Loader2, Trophy } from "lucide-react";

import type { ThemeColors } from "@/config/themes";
import { useWeekly } from "@/contexts/weekly";
import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import { truncatePublicKey } from "@/utils/solanaDisplay";

export default function WeeklyTab({ colors }: { colors: ThemeColors }) {
  const controller = useWeekly();
  const owner = useEmbeddedIdentity().publicKey;
  const weekly = controller.weekly;

  if (controller.loading && !weekly) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: colors.accent }} />
      </div>
    );
  }
  if (!weekly) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-sm text-white/55">
        Weekly competition activates with Economy.
      </div>
    );
  }

  const rank = weekly.leaderboard.findIndex((entry) => entry.player.equals(owner));
  const isCashWinner = rank >= 0 && rank < weekly.cashWinnerCount;
  const isStarWinner =
    rank >= 0 &&
    rank < weekly.cashWinnerCount + weekly.starWinnerCount;
  const canClaimCash =
    weekly.status === "claimable" &&
    isCashWinner &&
    !weekly.player?.cashClaimed;
  const canClaimStars =
    weekly.status === "claimable" &&
    isStarWinner &&
    !weekly.player?.starsClaimed;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <section className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl font-black text-white">Week {weekly.weekId}</p>
            <p className="mt-1 text-xs font-semibold text-white/55">
              Best 5 Daily results · missing days score 0
            </p>
          </div>
          <Trophy className="h-7 w-7" style={{ color: colors.accent2 }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Metric label="Your score" value={weekly.player?.score.toString() ?? "0"} />
          <Metric label="Days" value={weekly.player?.resultCount.toString() ?? "0"} />
          <Metric label="Cash pool" value={formatUsdc(weekly.committedCashPool)} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/55">
          Top {weekly.cashWinnerCount} receive cash (55/30/15, renormalized) plus 30 Stars. The next{" "}
          {weekly.starWinnerCount} receive 30/25/20/15/10 Stars by rank quantile.
        </p>
        {(canClaimCash || canClaimStars) && (
          <div className="mt-3 flex flex-col gap-2">
            {canClaimStars && (
              <ArcadeButton
                disabled={controller.action !== null}
                onClick={() => void controller.claimStars()}
              >
                {controller.action === "claim:stars" ? "Claiming..." : "Claim Weekly Stars"}
              </ArcadeButton>
            )}
            {canClaimCash && (
              <ArcadeButton
                disabled={controller.action !== null}
                onClick={() => void controller.claimCash()}
              >
                {controller.action === "claim:cash" ? "Claiming..." : "Claim Weekly cash"}
              </ArcadeButton>
            )}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {weekly.leaderboard.map((entry, index) => (
          <div
            key={entry.player.toBase58()}
            className="flex items-center gap-3 border-b border-white/10 px-4 py-3 last:border-b-0"
          >
            <span className="w-7 text-center font-sans text-sm font-black text-white/60">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/75">
              {entry.player.equals(owner)
                ? `You · ${truncatePublicKey(entry.player.toBase58())}`
                : truncatePublicKey(entry.player.toBase58())}
            </span>
            <span className="font-sans text-sm font-black text-white">{entry.score} pts</span>
          </div>
        ))}
        {weekly.leaderboard.length === 0 && (
          <p className="p-5 text-center text-sm text-white/45">No Daily rollups yet.</p>
        )}
      </section>
      {controller.error && <p className="text-center text-xs text-red-300">{controller.error}</p>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/20 px-2 py-2">
      <p className="font-sans text-lg font-black text-white">{value}</p>
      <p className="font-sans text-[10px] font-bold uppercase text-white/40">{label}</p>
    </div>
  );
}

function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = ((amount % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}
