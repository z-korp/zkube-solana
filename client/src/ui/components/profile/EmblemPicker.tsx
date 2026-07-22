import React, { useMemo, useState } from "react";
import { Check } from "lucide-react";

import {
  resolveEmblemStates,
  type EmblemState,
  type EmblemZoneInput,
} from "@/config/emblems";
import { EmblemBadge } from "@/ui/components/economy";
import Sheet from "@/ui/components/shared/Sheet";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { cn } from "@/ui/utils";

/** EmblemBadge render state, mirrored locally since it is not exported. */
type BadgeState = "unlocked" | "locked" | "gold";

function badgeStateFor(state: EmblemState): BadgeState {
  return state.gold ? "gold" : state.unlocked ? "unlocked" : "locked";
}

/** A short caption describing how each emblem is earned. */
function emblemSubtitle(state: EmblemState): string {
  const { descriptor, gold } = state;
  const mastered = gold ? " · Mastered" : "";
  switch (descriptor.kind) {
    case "auto":
      return "Shows your strongest emblem";
    case "guardian":
      return `Zone ${descriptor.zoneId} guardian${mastered}`;
    case "realm":
      return `Every guardian defeated${mastered}`;
    case "world":
      return "All 300 Campaign stars";
    default:
      return "";
  }
}

interface EmblemPickerProps {
  /** Per-zone Campaign progress used to derive every emblem's state. */
  zones: readonly EmblemZoneInput[];
  /** Stored featured emblem id (0 = auto); highlighted as selected. */
  featuredEmblem: number;
  /** Owner-signed save; resolves on success and rejects on failure. */
  onSelect: (emblemId: number) => Promise<unknown> | void;
  saving: boolean;
  error: string | null;
}

/**
 * The emblem gallery and its owner-signed picker. The 4-column grid shows every
 * emblem (0..12) with its unlocked/gold/locked state; tapping any tile opens a
 * bottom sheet listing only the emblems the player can currently feature (the
 * always-available auto slot plus any unlocked emblem). Choosing one signs the
 * setFeaturedEmblem write via `onSelect`; emblems are purely cosmetic.
 */
const EmblemPicker: React.FC<EmblemPickerProps> = ({
  zones,
  featuredEmblem,
  onSelect,
  saving,
  error,
}) => {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);

  const states = useMemo(() => resolveEmblemStates(zones), [zones]);
  const selectable = useMemo(
    () =>
      states.filter(
        (state) => state.descriptor.kind === "auto" || state.unlocked,
      ),
    [states],
  );

  const handleSelect = async (emblemId: number) => {
    if (emblemId === featuredEmblem) {
      setOpen(false);
      return;
    }
    try {
      await onSelect(emblemId);
      setOpen(false);
    } catch {
      // The failure is surfaced through the `error` prop; keep the sheet open.
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <p
          className="font-sans text-[11px] font-bold uppercase tracking-[0.15em]"
          style={{ color: colors.textMuted }}
        >
          Emblems
        </p>
        <p className="font-sans text-[11px] font-semibold text-white/40">
          Tap to feature
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        {states.map((state) => {
          const id = state.descriptor.id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`Feature ${state.descriptor.name} emblem`}
              className="flex items-center justify-center rounded-xl p-0.5 transition-transform active:scale-95"
            >
              <EmblemBadge
                emblemId={id}
                state={badgeStateFor(state)}
                selected={id === featuredEmblem}
              />
            </button>
          );
        })}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Feature an emblem">
        <div className="flex flex-col gap-2 pb-1">
          <p className="mb-1 text-center font-sans text-[12px] font-semibold text-white/55">
            Emblems are cosmetic and never affect prizes or play.
          </p>
          {selectable.map((state) => {
            const id = state.descriptor.id;
            const isSelected = id === featuredEmblem;
            return (
              <button
                key={id}
                type="button"
                disabled={saving}
                onClick={() => void handleSelect(id)}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                  isSelected
                    ? "bg-white/[0.1]"
                    : "border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08]",
                )}
                style={
                  isSelected ? { borderColor: colors.accent } : undefined
                }
              >
                <EmblemBadge
                  emblemId={id}
                  state={badgeStateFor(state)}
                  selected={isSelected}
                  size={48}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate font-sans text-[14px] font-extrabold"
                    style={{ color: colors.text }}
                  >
                    {state.descriptor.name}
                  </p>
                  <p className="truncate font-sans text-[11px] font-semibold text-white/50">
                    {emblemSubtitle(state)}
                  </p>
                </div>
                {isSelected && (
                  <Check
                    size={18}
                    className="shrink-0"
                    style={{ color: colors.accent }}
                  />
                )}
              </button>
            );
          })}

          {error && (
            <p
              role="alert"
              className="mt-1 text-center font-sans text-[12px] font-semibold text-red-300"
            >
              {error}
            </p>
          )}
          {saving && (
            <p className="text-center font-sans text-[12px] font-semibold text-white/60">
              Saving…
            </p>
          )}
        </div>
      </Sheet>
    </section>
  );
};

export default EmblemPicker;
