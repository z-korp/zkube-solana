/**
 * DEV-ONLY bottom-panel prototypes, paired with the header prototypes.
 *
 * The shipped bar spends 108px on three circles with a lot of nothing between
 * them, and the board cannot use that space anyway — eight columns on a phone
 * makes the cell width-bound, so the bar is free room rather than room stolen
 * from the grid. These two treatments spend it differently.
 */
import { Flag, Settings } from "lucide-react";

import type { BonusSlot } from "@/ui/components/actionbar/GameActionBar";
import type { FieldStanding } from "./PrototypeHud";

export type ActionBarVariant = "rail" | "flank";

const PANEL: React.CSSProperties = {
  background: "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 3px 0 #04070F, inset 0 1px 0 rgba(255,255,255,0.08)",
};

function ControlKey({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-12 w-12 flex-none place-items-center rounded-2xl text-white/70"
      style={PANEL}
    >
      {children}
    </button>
  );
}

function BonusKey({
  slot,
  selected,
}: {
  slot: BonusSlot | undefined;
  selected: boolean;
}) {
  if (!slot) return <span className="h-14 flex-1" />;
  const spent = slot.charges <= 0;
  return (
    <button
      type="button"
      aria-label={`${slot.name}: ${slot.charges} charges`}
      onClick={spent ? undefined : slot.onClick}
      disabled={spent}
      className="relative flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl px-3 disabled:opacity-45"
      style={{
        background: selected
          ? "linear-gradient(160deg, #FCE177 0%, #FACC15 55%, #B4930F 100%)"
          : "linear-gradient(180deg, #1B2942 0%, #0D1626 100%)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: selected
          ? "0 4px 0 #705C09, inset 0 2px 0 rgba(255,255,255,0.5)"
          : "0 4px 0 #04070F, inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      <img src={slot.icon} alt="" className="h-8 w-8 object-contain" />
      <span
        className={`font-sans text-[13px] font-black uppercase tracking-[0.08em] ${
          selected ? "text-[#241903]" : "text-white"
        }`}
      >
        {slot.name}
      </span>
      {/* Charges as pips, not a number: three of them read at a glance and
          make an empty slot obviously empty rather than a small zero. */}
      <span className="flex items-center gap-1">
        {Array.from({ length: Math.max(slot.startingCharges, 3) }, (_, index) => (
          <span
            key={index}
            className="block h-2 w-2 rounded-full"
            style={{
              background:
                index < slot.charges
                  ? selected
                    ? "#241903"
                    : "#FACC15"
                  : "rgba(255,255,255,0.18)",
            }}
          />
        ))}
      </span>
      {slot.lineProgress && (
        <span className="absolute -top-2 right-3 rounded-full bg-[#0A1120] px-1.5 py-0.5 font-sans text-[9px] font-bold tabular-nums text-yellow-200 ring-1 ring-yellow-300/30">
          {slot.lineProgress.current}/{slot.lineProgress.threshold}
        </span>
      )}
    </button>
  );
}

export default function PrototypeActionBar({
  variant,
  bonusSlots,
  activeBonus,
  onSurrender,
  field,
  yourScore,
  objectiveLine,
}: {
  variant: ActionBarVariant;
  bonusSlots: BonusSlot[];
  activeBonus: number;
  onSurrender: () => void;
  field: FieldStanding | null;
  /** The run's live score, so the rail can quote the gap rather than a total. */
  yourScore: number;
  /** Shown in place of the field rail when there is no field (Campaign). */
  objectiveLine?: string;
}) {
  const slot = bonusSlots[0];
  const selected = slot !== undefined && activeBonus === slot.type;

  const rail = field ? (
    <div
      className="mb-1.5 flex items-center gap-2 rounded-xl px-2.5 py-1.5"
      style={PANEL}
    >
      <span className="font-sans text-[11px] font-black tabular-nums text-white/50">
        #{field.rank - 1}
      </span>
      <span className="min-w-0 flex-1 truncate font-sans text-[11px] font-bold text-white">
        {field.nextName}
      </span>
      <span className="font-sans text-[11px] font-black tabular-nums text-white/70">
        {field.nextScore.toLocaleString("en-US")}
      </span>
      <span className="font-sans text-[11px] font-black tabular-nums text-amber-300">
        +{Math.max(0, field.nextScore - yourScore).toLocaleString("en-US")}
      </span>
    </div>
  ) : objectiveLine ? (
    <div
      className="mb-1.5 truncate rounded-xl px-2.5 py-1.5 text-center font-sans text-[11px] font-bold text-white/60"
      style={PANEL}
    >
      {objectiveLine}
    </div>
  ) : null;

  if (variant === "flank") {
    return (
      <div className="w-full px-2 pb-2">
        <div className="flex items-center gap-2">
          <ControlKey label="Surrender" onClick={onSurrender}>
            <Flag size={18} />
          </ControlKey>
          <BonusKey slot={slot} selected={selected} />
          <ControlKey label="Settings">
            <Settings size={18} />
          </ControlKey>
        </div>
        {field && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className="flex-1 truncate rounded-xl px-2 py-1 font-sans text-[10px] font-bold tabular-nums text-white/55"
              style={PANEL}
            >
              #{field.rank - 1} {field.nextName}{" "}
              {field.nextScore.toLocaleString("en-US")}
            </span>
            <span
              className="flex-1 truncate rounded-xl px-2 py-1 text-right font-sans text-[10px] font-bold tabular-nums text-white/55"
              style={PANEL}
            >
              {field.entrants} playing
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full px-2 pb-2">
      {rail}
      <div className="flex items-center gap-2">
        <ControlKey label="Surrender" onClick={onSurrender}>
          <Flag size={18} />
        </ControlKey>
        <BonusKey slot={slot} selected={selected} />
        <ControlKey label="Settings">
          <Settings size={18} />
        </ControlKey>
      </div>
    </div>
  );
}
