import { getZoneGuardian } from "@/config/bossCharacters";
import type { GameOverDialogProps } from "@/ui/components/GameOverDialog";
import GuardianQuote from "@/ui/components/shared/GuardianQuote";
import { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";

export default function LocalDailyResultDialog({
  isOpen,
  onClose,
  closeDisabled = false,
  settlementFailed = false,
  settlementError = null,
  onRetrySettlement,
  game,
  colors,
}: GameOverDialogProps) {
  const guardian = getZoneGuardian(game.zoneId);
  const talk = useGuardianTalk(game.zoneId, guardian.dailyGreeting, {
    mood: "celebrate",
  });
  if (!isOpen) return null;
  const continueRun = () => {
    if (settlementFailed) onRetrySettlement?.();
    else if (!closeDisabled) onClose();
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black/75">
      <div className="relative flex min-h-0 flex-1 items-end justify-center overflow-hidden">
        <img
          src={talk.src}
          alt={guardian.name}
          className="h-[58%] max-h-[350px] w-auto object-contain"
          draggable={false}
        />
      </div>
      <section
        className="mx-2 mb-3 rounded-2xl border-2 px-4 pb-4 pt-3 text-center"
        style={{
          background: colors
            ? `linear-gradient(180deg, ${colors.backgroundGradientStart ?? "#0a1628"}F5, ${colors.background ?? "#050a12"}FA)`
            : "#0a1628",
          borderColor: "rgba(103,232,249,0.28)",
        }}
      >
        <GuardianQuote
          talk={talk}
          quoted
          className="font-sans text-sm italic leading-6 text-white/80"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Result label="Score" value={game.totalScore} />
          <Result label="Theme" value={game.challengeBonus} />
        </div>
        {settlementFailed && (
          <p className="mt-2 font-sans text-xs text-red-300">
            {settlementError ?? "The result could not be saved. Try again."}
          </p>
        )}
        <button
          type="button"
          disabled={closeDisabled && !settlementFailed}
          onClick={continueRun}
          className="mt-3 w-full rounded-xl bg-amber-300 px-4 py-3 font-sans text-sm font-black text-slate-950 disabled:opacity-40"
        >
          {settlementFailed
            ? "Try again"
            : closeDisabled
              ? "Saving…"
              : "Continue"}
        </button>
      </section>
    </div>
  );
}

function Result({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/[0.05] px-3 py-2">
      <p className="font-mono text-xl font-black text-cyan-200">{value}</p>
      <p className="font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
        {label}
      </p>
    </div>
  );
}
