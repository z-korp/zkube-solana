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
      className={cn("flex rounded-2xl p-1", className)}
      style={{
        background: "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow:
          "inset 0 2px 6px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
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
              "relative z-10 flex-1 rounded-xl font-sans text-[12px] font-extrabold transition-colors duration-200",
              accent
                ? "py-2 text-center"
                : "px-3 py-2 uppercase tracking-[0.08em]",
              !accent &&
                (isActive
                  ? "text-[#241903]"
                  : "text-white/45 hover:text-white/65"),
            )}
            style={accent ? { color: isActive ? accent : undefined } : undefined}
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl"
                style={
                  accent
                    ? {
                        backgroundColor: `${accent}1F`,
                        border: `1px solid ${accent}55`,
                      }
                    : {
                        background:
                          "linear-gradient(160deg, #FFE989 0%, #FACC15 55%, #C79B0B 100%)",
                        boxShadow:
                          "0 2px 0 #7A5C06, inset 0 1.5px 0 rgba(255,255,255,0.55)",
                      }
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
