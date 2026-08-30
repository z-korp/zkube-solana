import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { getZoneGuardian } from "@/config/bossCharacters";
import { TalkCaret } from "@/ui/components/shared/GuardianQuote";
import { useMusicPlayer } from "@/contexts/hooks";
import { KreditCoin, MONEY_GOLD } from "@/ui/components/economy";
import { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import InfoSheet from "@/ui/components/shared/InfoSheet";
import Sheet from "@/ui/components/shared/Sheet";
import { formatSolBalanceLamports } from "@/utils/currency";
import type { DailyThemeView } from "@/core/dailyRules";
import { dailyThemeDescription } from "@/game/constraint";

interface InsertCoinSheetProps {
  open: boolean;
  onClose: () => void;
  /** Zone whose guardian hosts today's trial. */
  zoneId: number;
  /** Owner purchase price of the Kredit already being spent. */
  entryLamports: bigint;
  /** Proceeds with the device-session-authorized Kredit spend. */
  onConfirm: () => void;
  /** True while the Kredit spend is being prepared. */
  busy?: boolean;
  dailyTheme: DailyThemeView;
}

const FEED_JAWS_MS = 480;
const FEED_DONE_MS = 1_700;

/**
 * Ranked-entry confirm for one prepaid Kredit — and the entry IS the guardian:
 * confirm feeds it the Kredit coin. The jaws open (talk-open
 * frame), the coin arcs in, the guardian settles satisfied, and only then the
 * device-session-authorized daily.enter() flow takes over. Zones without a
 * frame set (and reduced motion) skip the ceremony and confirm immediately.
 */
const InsertCoinSheet: React.FC<InsertCoinSheetProps> = ({
  open,
  onClose,
  zoneId,
  entryLamports,
  onConfirm,
  busy = false,
  dailyTheme,
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
      srTitle="Spend Kredit to enter ranked"
      dismissible={!busy}
    >
      <div className="flex flex-col items-center gap-4 pt-1">
        <div
          aria-label={`Feed ${guardian.name} one Kredit coin to enter`}
          className="relative w-full overflow-hidden rounded-2xl border border-white/[0.14] bg-[#0b0716]"
          style={{ height: 260 }}
        >
          {/* Padded so the whole bust reads above the line, never behind it. */}
          <img
            src={talk.src}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain p-1 pb-14"
          />
          <span
            className="absolute left-3 top-[-1px] rounded-b-lg px-2.5 py-1 font-display text-sm tracking-[0.06em] text-[#3a2c04]"
            style={{
              background: MONEY_GOLD,
              boxShadow: "0 2px 0 rgba(138,106,8,0.9)",
            }}
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
              <KreditCoin size={44} />
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
          <p className="max-w-[300px] text-center font-sans text-xs font-semibold text-cyan-100/80">
            Today's Theme: {dailyThemeDescription(dailyTheme)}
          </p>
          <motion.span
            className="drop-shadow-[0_0_12px_rgba(250,204,21,0.4)]"
            animate={
              reduceMotion || feeding
                ? { opacity: feeding ? 0 : 1 }
                : { y: [0, 6, 0] }
            }
            transition={
              reduceMotion || feeding
                ? { duration: 0.15 }
                : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <KreditCoin size={44} title="One Kredit entry coin" />
          </motion.span>
          <div className="flex items-center gap-2">
            <span
              className="font-display text-4xl tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              1 Kredit
            </span>
          </div>
          <InfoSheet title="How ranked entry works">
            <p>
              The owner wallet bought this Kredit for{" "}
              {formatSolBalanceLamports(entryLamports)} SOL. A device session
              may spend it within that prepaid balance.
            </p>
            <p>
              Purchase sends 10% to the operator. Spending sends the prepaid 90%
              to the following Daily. Scored or expired, never refunded.
            </p>
            <p>
              Any reward you are still owed is collected in this same
              transaction, so entering again is how you get paid — there is no
              separate claim to remember.
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
              ? "Spending Kredit…"
              : feeding
                ? `Feeding ${guardian.name}…`
                : "Spend & enter"}
          </ArcadeButton>
        </div>
      </div>
    </Sheet>
  );
};

export default InsertCoinSheet;
