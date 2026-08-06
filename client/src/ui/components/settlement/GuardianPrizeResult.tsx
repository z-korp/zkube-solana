import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { ConnectedPlayerContext } from "@/chain/connectedPlayerContext";
import { getZoneGuardian } from "@/config/bossCharacters";
import { useMusicPlayer } from "@/contexts/hooks";
import { Coin, MONEY_GOLD, SolMark } from "@/ui/components/economy";
import GuardianTalkScene from "@/ui/components/settlement/GuardianTalkScene";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import Sheet from "@/ui/components/shared/Sheet";
import { formatSolBalanceLamports } from "@/utils/currency";

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
   * placement, so it is framed as "Top" rather than claiming this win's rank.
   */
  bestPrizeRank?: number;
  /**
   * Owner address (base58) used to build the spectator share link. Optional —
   * when absent the connected player's key is used, and if neither is known the
   * win is shared as text only.
   */
  owner?: string;
}

/** The X (Twitter) logo glyph. */
const XLogo: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zM17.083 19.77h1.833L7.084 4.126H5.117z" />
  </svg>
);

/**
 * The "guardian pays you" ceremony, contained in the bottom sheet (never
 * full-screen): the guardian speaks its respect line Ace-Attorney style —
 * with real holds on punctuation — then flips to the celebrate frame while a
 * SOL coin drops into the amount pill and the figure counts up. Push-only
 * remains implicit — there is nothing to claim, so nothing says otherwise.
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
  const reduceMotion = useReducedMotion();
  const { playSfx } = useMusicPlayer();
  const connectedPlayer = useContext(ConnectedPlayerContext);
  const guardian = getZoneGuardian(zoneId);
  const [paying, setPaying] = useState(false);
  const [displayAmount, setDisplayAmount] = useState(
    reduceMotion ? amountLamports : 0n,
  );
  const payTimer = useRef<number | null>(null);

  // The line lands, a real beat, then the verdict — Ace Attorney holds the
  // room. Tapping the scene skips the line for anyone in a hurry.
  const handleLineDone = useCallback(() => {
    if (reduceMotion) return;
    payTimer.current = window.setTimeout(() => setPaying(true), 750);
  }, [reduceMotion]);

  useEffect(() => {
    if (!open) return;
    if (reduceMotion) {
      setPaying(true);
      setDisplayAmount(amountLamports);
    }
  }, [open, reduceMotion, amountLamports]);

  // The coin lands audibly whenever the payment lands — reduced motion mutes
  // nothing, it only skips the animation.
  useEffect(() => {
    if (paying) playSfx("coin");
  }, [paying, playSfx]);

  useEffect(() => {
    if (!paying || reduceMotion) return;
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
  }, [paying, reduceMotion, amountLamports, playSfx]);

  useEffect(
    () => () => {
      if (payTimer.current !== null) window.clearTimeout(payTimer.current);
    },
    [],
  );

  const shareOwner = owner ?? connectedPlayer?.publicKey?.toBase58() ?? null;
  // Honest content built only from the real props: the delivered amount, the
  // period that paid, and (when we know who won) the spectator deep-link the
  // app already resolves. No fabricated ranks or numbers.
  const shareText = `${guardian.name} just paid me ${formatSolBalanceLamports(amountLamports)} SOL on the zKube ${periodLabel}. ${guardian.emoji}`;
  const shareUrl = shareOwner
    ? `${window.location.origin}?player=${encodeURIComponent(shareOwner)}`
    : undefined;

  // Prefilled X post — the share IS the flex.
  const handleShare = useCallback(() => {
    const params = new URLSearchParams({ text: shareText });
    if (shareUrl) params.set("url", shareUrl);
    window.open(
      `https://x.com/intent/post?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [shareText, shareUrl]);

  return (
    <Sheet
      open={open}
      onClose={onDismiss}
      srTitle={`${periodLabel} prize delivered`}
      className="md:max-w-[540px]"
    >
      <div className="flex flex-col items-center gap-4 pb-1 pt-1">
        <span
          className="font-display text-xl tracking-[0.04em]"
          style={{ color: MONEY_GOLD }}
        >
          {periodLabel} prize
        </span>

        <div className="relative w-full">
          <GuardianTalkScene
            zoneId={zoneId}
            line={guardian.prizeLine}
            height={300}
            onLineDone={handleLineDone}
            celebrate={paying}
          />
          {/* One coin, one delivery: guardian → amount pill. */}
          {paying && !reduceMotion && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/3 z-10 -ml-5 drop-shadow-[0_0_12px_rgba(250,204,21,0.55)]"
              initial={{ y: 0, opacity: 0, scale: 0.6 }}
              animate={{
                y: [0, 220],
                opacity: [0, 1, 1, 0],
                scale: [0.6, 1.05, 1, 0.7],
                rotateY: [0, 180, 360, 420],
              }}
              transition={{ duration: 0.9, times: [0, 0.25, 0.85, 1], ease: "easeIn" }}
            >
              <Coin size={44} />
            </motion.span>
          )}
        </div>

        {/* The verdict row is empty until the payment beat — no "+0" while the
            guardian is still talking; the pill pops in with the coin. */}
        <div className="flex h-[60px] items-center gap-3">
          {bestPrizeRank > 0 && paying && (
            <motion.span
              initial={reduceMotion ? undefined : { opacity: 0, x: 8 }}
              animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
              transition={{ delay: 0.35 }}
              className="rounded-xl border px-3 py-2 font-display text-sm"
              style={{
                borderColor: `${MONEY_GOLD}45`,
                color: MONEY_GOLD,
                background: `${MONEY_GOLD}0d`,
              }}
              title="Best payout-bearing finish on this board"
            >
              Top {bestPrizeRank}
            </motion.span>
          )}
          {paying && (
          <motion.div
            className="relative flex items-center gap-2.5 rounded-full border px-6 py-3"
            style={{
              borderColor: `${MONEY_GOLD}55`,
              background: `${MONEY_GOLD}14`,
              boxShadow: `0 0 20px ${MONEY_GOLD}33`,
            }}
            initial={reduceMotion ? undefined : { scale: 0.5, opacity: 0 }}
            animate={
              reduceMotion
                ? undefined
                : { scale: [0.5, 1.1, 1], opacity: [0, 1, 1] }
            }
            transition={
              reduceMotion ? undefined : { duration: 0.4, ease: "easeOut" }
            }
          >
            {paying &&
              !reduceMotion &&
              Array.from({ length: 10 }, (_, index) => {
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
              className="money font-display text-4xl tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              +{formatSolBalanceLamports(displayAmount)}
            </span>
            <SolMark size={20} />
          </motion.div>
          )}
        </div>

        <div className="flex w-full items-stretch gap-2 pt-1">
          <motion.button
            type="button"
            onClick={handleShare}
            aria-label="Share this win on X"
            whileTap={{ y: 4, boxShadow: "0 1px 0 #000000" }}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 font-sans text-[15px] font-extrabold uppercase tracking-[0.1em] text-white"
            style={{
              background: "linear-gradient(160deg, #3a3a46 0%, #1c1c26 55%, #0b0b12 100%)",
              boxShadow: "0 5px 0 #000000, inset 0 2px 0 rgba(255,255,255,0.14)",
            }}
          >
            <XLogo />
            Share
          </motion.button>
          <div className="flex-1">
            <ArcadeButton onClick={onDismiss} accentOverride={MONEY_GOLD}>
              Nice
            </ArcadeButton>
          </div>
        </div>
      </div>
    </Sheet>
  );
};

export default GuardianPrizeResult;
