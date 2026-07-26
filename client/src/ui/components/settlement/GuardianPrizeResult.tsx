import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { ConnectedPlayerContext } from "@/chain/connectedPlayerContext";
import { useMusicPlayer } from "@/contexts/hooks";
import { Coin, GuardianMedallion, MONEY_GOLD } from "@/ui/components/economy";
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
  const { playSfx } = useMusicPlayer();
  const connectedPlayer = useContext(ConnectedPlayerContext);
  const [copied, setCopied] = useState(false);
  const [displayAmount, setDisplayAmount] = useState(amountLamports);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    playSfx("coin");
    if (reduceMotion) {
      setDisplayAmount(amountLamports);
      return;
    }
    setDisplayAmount(0n);
    let startedAt: number | null = null;
    let frame = 0;
    const count = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / 900);
      const eased = 1 - (1 - progress) ** 3;
      const thousandths = BigInt(Math.round(eased * 1_000));
      setDisplayAmount((amountLamports * thousandths) / 1_000n);
      if (progress < 1) frame = window.requestAnimationFrame(count);
      else setDisplayAmount(amountLamports);
    };
    frame = window.requestAnimationFrame(count);
    return () => window.cancelAnimationFrame(frame);
  }, [amountLamports, open, playSfx, reduceMotion]);

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
  const shareText = `I just won ${formatSolLamports(amountLamports)} SOL on the zKube ${periodLabel}.`;
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
          className="flex items-center gap-2 font-sans text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: colors.accent }}
        >
          <img
            src="/assets/common/trophies/gold.png"
            alt=""
            className="h-5 w-5 object-contain"
          />
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
          {/* One delivery, one landing: no looping money animation. */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-6 -ml-5 drop-shadow-[0_0_12px_rgba(250,204,21,0.55)]"
            initial={reduceMotion ? { opacity: 0 } : { y: 0, opacity: 0, scale: 0.6 }}
            animate={
              reduceMotion
                ? { opacity: 0 }
                : {
                    y: [0, 116],
                    opacity: [0, 1, 1],
                    scale: [0.6, 1.05, 1],
                    rotateY: [0, 180, 360],
                  }
            }
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: 0.9,
                    times: [0, 0.25, 1],
                    ease: "easeInOut",
                  }
            }
          >
            <Coin size={40} />
          </motion.span>
        </div>

        <motion.div
          className="relative flex items-baseline gap-1.5 rounded-full border px-5 py-2.5"
          style={{
            borderColor: `${MONEY_GOLD}55`,
            background: `${MONEY_GOLD}14`,
            boxShadow: `0 0 20px ${MONEY_GOLD}33`,
          }}
          animate={reduceMotion ? undefined : { scale: [1, 1.08, 1] }}
          transition={
            reduceMotion
              ? undefined
              : { duration: 0.45, delay: 0.82, ease: "easeOut" }
          }
        >
          {!reduceMotion && Array.from({ length: 10 }, (_, index) => {
            const angle = (Math.PI * 2 * index) / 10;
            return (
              <motion.span
                key={index}
                aria-hidden
                data-testid="reward-particle"
                className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-yellow-200"
                initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                animate={{
                  x: Math.cos(angle) * 58,
                  y: Math.sin(angle) * 34,
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0.4],
                }}
                transition={{ duration: 0.55, delay: 0.78, ease: "easeOut" }}
              />
            );
          })}
          <span
            className="money font-mono text-3xl font-black"
            style={{ color: MONEY_GOLD }}
          >
            +{formatSolLamports(displayAmount)}
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
            {copied ? "Copied!" : (
              <>
                <Share2 className="h-4 w-4" />
                Share
              </>
            )}
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
