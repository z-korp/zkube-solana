import React from "react";
import { motion } from "motion/react";

import { cn } from "@/ui/utils";

interface SegmentedTabsProps<T extends string> {
  tabs: readonly T[];
  active: T;
  onChange: (tab: T) => void;
  /** Must be unique per page or the active indicator teleports across pages. */
  layoutId: string;
  badges?: Partial<Record<T, number>>;
  /** Theme accent; switches to the accent-tinted variant (Profile style). */
  accent?: string;
  className?: string;
}

function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  layoutId,
  badges,
  accent,
  className,
}: SegmentedTabsProps<T>): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex rounded-full border p-1 backdrop-blur-xl",
        accent
          ? "border-white/[0.12] bg-white/[0.06]"
          : "border-white/[0.16] bg-white/[0.1] shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)]",
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = active === tab;
        const badgeCount = badges?.[tab] ?? 0;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={cn(
              "relative z-10 flex-1 rounded-full font-sans text-[12px] font-bold transition-colors duration-200",
              accent
                ? "py-2 text-center"
                : "px-3 py-1.5 uppercase tracking-wide",
              !accent &&
                (isActive ? "text-white" : "text-white/40 hover:text-white/60"),
            )}
            style={accent ? { color: isActive ? accent : undefined } : undefined}
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className={cn(
                  "absolute inset-0 rounded-full border",
                  !accent &&
                    "border-white/[0.08] bg-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]",
                )}
                style={
                  accent
                    ? {
                        backgroundColor: `${accent}1F`,
                        borderColor: `${accent}55`,
                      }
                    : undefined
                }
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span
              className={cn(
                "relative z-20 drop-shadow-sm",
                accent && !isActive && "text-white/45",
              )}
            >
              {tab}
            </span>
            {badgeCount > 0 && (
              <span className="absolute -right-0.5 -top-1 z-30 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 font-sans text-[10px] font-bold leading-none text-white shadow-md">
                {badgeCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedTabs;
