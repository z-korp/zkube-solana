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

/**
 * Controls only. The chase moved into the header, where it sits with the two
 * numbers it is about — a second rail down here would have restated it, and
 * the tray's job is the one thing you press.
 */
export default function PrototypeActionBar({
  bonusSlots,
  activeBonus,
  onSurrender,
}: {
  bonusSlots: BonusSlot[];
  activeBonus: number;
  onSurrender: () => void;
}) {
  const slot = bonusSlots[0];
  const selected = slot !== undefined && activeBonus === slot.type;

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
    </div>
  );
}
