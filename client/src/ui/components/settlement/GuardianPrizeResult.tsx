import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { ConnectedPlayerContext } from "@/chain/connectedPlayerContext";
import { GuardianMedallion, MONEY_GOLD } from "@/ui/components/economy";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import Sheet from "@/ui/components/shared/Sheet";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatSolLamports } from "@/utils/currency";
import { shareOrCopyWin } from "@/utils/share";

interface GuardianPrizeResultProps {
  open: boolean;
  onDismiss: () => void;
  /** Zone whose guardian delivers the winnings (today's Daily zone is fine). */
  zoneId: number;
  /** The delta being celebrated, in lamports. */
  amountLamports: bigint;
  /** Which period paid. */
  periodLabel: "Daily" | "Weekly" | "Season";
  /**
   * Best payout-bearing rank on the period record (0 = none, hidden). This is the
   * lifetime-best rank carried on PlayerState, not necessarily this exact
   * placement, so it is framed as "Best" rather than claiming this win's rank.
   */
  bestPrizeRank?: number;
  /**
   * Owner address (base58) used to build the spectator share link. Optional —
   * when absent the connected player's key is used, and if neither is known the
   * win is shared as text only.
   */
  owner?: string;
}

/**
 * The celebratory "guardian delivers your winnings" moment. A dismissible
 * overlay: the zone guardian medallion, a gold coin that travels down from the
 * guardian into a "+{amount} SOL" catch pill, which period paid, and the
 * push-only / no-claim guarantee. Motion is suppressed under reduced-motion —
 * the pill still shows the amount statically.
 */
const GuardianPrizeResult: React.FC<GuardianPrizeResultProps> = ({
  open,
  onDismiss,
  zoneId,
  amountLamports,
  periodLabel,
  bestPrizeRank = 0,
  owner,
}) => {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const connectedPlayer = useContext(ConnectedPlayerContext);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  const shareOwner = owner ?? connectedPlayer?.publicKey?.toBase58() ?? null;
  // Honest content built only from the real props: the delivered amount, the
  // period that paid, and (when we know who won) the spectator deep-link the
  // app already resolves. No fabricated ranks or numbers.
  const shareText = `I just won ${formatSolLamports(amountLamports)} SOL on the zKube ${periodLabel} 🏆`;
  const shareUrl = shareOwner
    ? `${window.location.origin}?player=${encodeURIComponent(shareOwner)}`
    : undefined;

  const handleShare = useCallback(async () => {
    try {
      const outcome = await shareOrCopyWin({ text: shareText, url: shareUrl });
      if (outcome === "copied") {
        setCopied(true);
        if (copiedTimer.current !== null) {
          window.clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1_600);
      }
    } catch {
      // Sharing is best-effort; a rejected share/clipboard call stays silent.
    }
  }, [shareText, shareUrl]);

  return (
    <Sheet
      open={open}
      onClose={onDismiss}
      srTitle={`${periodLabel} prize delivered`}
    >
      <div className="flex flex-col items-center gap-4 pb-1 pt-2">
        <span
          className="font-sans text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: colors.accent }}
        >
          {periodLabel} prize
        </span>

        {bestPrizeRank > 0 && (
          <span
            className="-mt-2 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-white/50"
            title="Best payout-bearing finish on this board"
          >
            Best #{bestPrizeRank}
          </span>
        )}

        <div className="relative flex flex-col items-center">
          <GuardianMedallion zoneId={zoneId} size={96} glow />
          {/* The coin falls from the guardian toward the catch pill below. */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-6 flex h-9 w-9 items-center justify-center font-mono text-base font-black"
            style={{
              borderRadius: "9999px",
              background: `radial-gradient(circle at 35% 30%, ${MONEY_GOLD}, ${MONEY_GOLD}cc 60%, ${MONEY_GOLD}80)`,
              color: "#3a2c00",
              boxShadow: `0 0 12px ${MONEY_GOLD}88`,
              marginLeft: -18,
            }}
            initial={reduceMotion ? { opacity: 0 } : { y: 0, opacity: 0, scale: 0.6 }}
            animate={
              reduceMotion
                ? { opacity: 0 }
                : {
                    y: [0, 120],
                    opacity: [0, 1, 1, 0],
                    scale: [0.6, 1, 1, 0.8],
                  }
            }
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: 1.4,
                    times: [0, 0.2, 0.8, 1],
                    ease: "easeIn",
                    repeat: Infinity,
                    repeatDelay: 0.6,
                  }
            }
          >
            ◎
          </motion.span>
        </div>

        <motion.div
          className="flex items-baseline gap-1.5 rounded-full border px-5 py-2.5"
          style={{
            borderColor: `${MONEY_GOLD}55`,
            background: `${MONEY_GOLD}14`,
            boxShadow: `0 0 20px ${MONEY_GOLD}33`,
          }}
          animate={reduceMotion ? undefined : { scale: [1, 1.06, 1] }}
          transition={
            reduceMotion
              ? undefined
              : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <span
            className="font-mono text-3xl font-black tabular-nums"
            style={{ color: MONEY_GOLD }}
          >
            +{formatSolLamports(amountLamports)}
          </span>
          <span
            className="font-mono text-sm font-bold"
            style={{ color: `${MONEY_GOLD}b0` }}
          >
            SOL
          </span>
        </motion.div>

        <p className="font-sans text-xs font-semibold text-white/60">
          Pushed to your wallet · no claim
        </p>

        <div className="flex w-full items-stretch gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleShare()}
            aria-label="Share this win"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 font-sans text-sm font-bold text-white/80 transition-colors hover:bg-white/[0.1]"
          >
            {copied ? "Copied!" : "🏆 Share"}
          </button>
          <div className="flex-1">
            <ArcadeButton onClick={onDismiss}>Nice</ArcadeButton>
          </div>
        </div>
      </div>
    </Sheet>
  );
};

export default GuardianPrizeResult;
