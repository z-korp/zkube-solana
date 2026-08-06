import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { TalkCaret } from "@/ui/components/shared/GuardianQuote";
import { useMusicPlayer } from "@/contexts/hooks";
import { Coin, MONEY_GOLD, SolMark } from "@/ui/components/economy";
import { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import InfoSheet from "@/ui/components/shared/InfoSheet";
import Sheet from "@/ui/components/shared/Sheet";
import { formatSolBalanceLamports } from "@/utils/currency";

interface InsertCoinSheetProps {
  open: boolean;
  onClose: () => void;
  /** Zone whose guardian hosts today's trial. */
  zoneId: number;
  /** Exact ranked entry price in lamports (rendered gold + mono). */
  entryLamports: bigint;
  /** Proceeds with the existing daily.enter() owner-signature flow. */
  onConfirm: () => void;
  /** True while the owner signature is being prepared. */
  busy?: boolean;
}

const FEED_JAWS_MS = 480;
const FEED_DONE_MS = 1_700;

/**
 * Ranked-entry confirm, shown before the owner signature — and the entry IS
 * the guardian: confirm feeds it the SOL coin. The jaws open (talk-open
 * frame), the coin arcs in, the guardian settles satisfied, and only then the
 * unchanged daily.enter() owner-signature flow takes over. Zones without a
 * frame set (and reduced motion) skip the ceremony and confirm immediately.
 */
const InsertCoinSheet: React.FC<InsertCoinSheetProps> = ({
  open,
  onClose,
  zoneId,
  entryLamports,
  onConfirm,
  busy = false,
}) => {
  const reduceMotion = useReducedMotion();
  const { playSfx } = useMusicPlayer();
  const guardian = getZoneGuardian(zoneId);
  const [feeding, setFeeding] = useState(false);
  const [fed, setFed] = useState(false);
  const timers = useRef<number[]>([]);

  // A re-opened sheet always starts before the feeding ceremony.
  useEffect(() => {
    if (!open) return;
    setFeeding(false);
    setFed(false);
  }, [open]);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const startFeed = () => {
    if (busy || feeding) return;
    if (reduceMotion) {
      onConfirm();
      return;
    }
    setFeeding(true);
    timers.current.push(
      window.setTimeout(() => {
        setFed(true);
        playSfx("coin");
      }, FEED_JAWS_MS),
      window.setTimeout(onConfirm, FEED_DONE_MS),
    );
  };

  // The arcade host works the room until a coin interrupts the pitch; the
  // feed sequence overrides the talk machine outright.
  const talk = useGuardianTalk(zoneId, guardian.arcadeGreeting, {
    enabled: open,
    overrideFrame: feeding ? (fed ? "satisfied" : "talk-open") : undefined,
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      srTitle="Insert coin to enter ranked"
      dismissible={!busy}
    >
      <div className="flex flex-col items-center gap-4 pt-1">
        <div
          aria-label={`Feed ${guardian.name} one SOL coin to enter`}
          className="relative w-full overflow-hidden rounded-2xl border border-white/[0.14] bg-[#0b0716]"
          style={{ height: 200 }}
        >
          <img
            src={talk.src}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: "center 24%" }}
          />
          <span
            className="absolute left-3 top-[-1px] rounded-b-lg px-2.5 py-1 font-display text-sm tracking-[0.06em] text-[#3a2c04]"
            style={{ background: MONEY_GOLD, boxShadow: "0 2px 0 rgba(138,106,8,0.9)" }}
          >
            {guardian.name}
          </span>
          {/* The host's pitch — typed letter by letter until the coin drops. */}
          {!feeding && (
            <span
              className="absolute inset-x-2 bottom-2 rounded-xl border border-white/[0.18] bg-[#0b0716]/85 px-3 py-2 backdrop-blur-sm"
              onClick={talk.typing ? talk.skip : undefined}
            >
              <span className="font-sans text-[14px] font-medium text-white/95">
                {talk.text}
                <TalkCaret talk={talk} />
              </span>
            </span>
          )}
          {/* The fed coin: bottom of the scene up into the open jaws. */}
          {feeding && !fed && !reduceMotion && (
            <motion.span
              aria-hidden
              className="absolute bottom-[-14px] left-1/2 z-10 -ml-5 drop-shadow-[0_0_12px_rgba(250,204,21,0.55)]"
              initial={{ y: 0, scale: 1, opacity: 1 }}
              animate={{ y: -118, scale: 0.5, opacity: [1, 1, 0.9, 0] }}
              transition={{ duration: FEED_JAWS_MS / 1000, ease: "easeIn" }}
            >
              <Coin size={44} />
            </motion.span>
          )}
          {/* The guardian acknowledges the toll before the wallet takes over. */}
          {fed && (
            <motion.span
              className="absolute inset-x-2 bottom-2 rounded-xl border border-white/[0.18] bg-[#0b0716]/85 px-3 py-2 backdrop-blur-sm"
              initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            >
              <span className="font-sans text-[14px] font-medium text-white/95">
                {guardian.entryLine}
              </span>
            </motion.span>
          )}
        </div>

        <div className="flex flex-col items-center gap-3">
          <motion.span
            className="drop-shadow-[0_0_12px_rgba(250,204,21,0.4)]"
            animate={
              reduceMotion || feeding ? { opacity: feeding ? 0 : 1 } : { y: [0, 6, 0] }
            }
            transition={
              reduceMotion || feeding
                ? { duration: 0.15 }
                : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <Coin size={44} title="One SOL entry coin" />
          </motion.span>
          <div className="flex items-center gap-2">
            <SolMark size={22} />
            <span
              className="font-display text-4xl tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(entryLamports)}
            </span>
          </div>
          <InfoSheet title="How ranked entry works">
            <p>
              Your wallet signs every ranked entry — a device session can't pay
              for you.
            </p>
            <p>
              Each entry funds tomorrow: 60% Daily, 20% Weekly, 10% Season, 10%
              team. Scored or expired, never refunded.
            </p>
          </InfoSheet>
        </div>

        <div className="w-full pt-1">
          <ArcadeButton
            disabled={busy || feeding}
            onClick={startFeed}
            accentOverride={MONEY_GOLD}
          >
            {busy
              ? "Preparing signature…"
              : feeding
                ? `Feeding ${guardian.name}…`
                : "Sign & enter"}
          </ArcadeButton>
        </div>
      </div>
    </Sheet>
  );
};

export default InsertCoinSheet;
