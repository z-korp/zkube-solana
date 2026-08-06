import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useNavigationStore, FULLSCREEN_PAGES } from "@/stores/navigationStore";
import type { PageId } from "@/stores/navigationStore";
import {
  DockArcadeIcon,
  DockCampaignIcon,
  DockHomeIcon,
  DockProfileIcon,
} from "./dockIcons";

const TABS: {
  id: PageId;
  icon: React.FC<{ size?: number }>;
  label: string;
}[] = [
  { id: "home", icon: DockHomeIcon, label: "Home" },
  { id: "arcade", icon: DockArcadeIcon, label: "Arcade" },
  { id: "campaign", icon: DockCampaignIcon, label: "Campaign" },
  { id: "profile", icon: DockProfileIcon, label: "Profile" },
];

const DOCK_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
  border: "1px solid rgba(255,255,255,0.09)",
  boxShadow:
    "0 16px 34px rgba(0,0,0,0.55), inset 0 1.5px 0 rgba(255,255,255,0.08)",
};

/**
 * The arcade dock — opaque block furniture in the app-icon language, no glass.
 * The active tab is a raised gold key that pops above the dock lip and slides
 * between tabs; inactive tabs are ink stamps. The dock deliberately ignores
 * the zone accent so the chrome reads identically in every realm.
 */
const BottomNav = () => {
  const currentPage = useNavigationStore((s) => s.currentPage);
  const navigate = useNavigationStore((s) => s.navigate);
  // The menu stays visible but locked until a wallet is connected.
  const connected = useConnectedPlayer().publicKey !== null;

  if (FULLSCREEN_PAGES.has(currentPage)) {
    return null;
  }

  return (
    <div
      className="absolute bottom-[max(0.9rem,env(safe-area-inset-bottom))] left-1/2 z-50 w-[94%] max-w-[560px] -translate-x-1/2 rounded-[24px] p-1.5"
      style={DOCK_STYLE}
    >
      <div className="flex items-stretch gap-1">
        {TABS.map((tab) => {
          const isActive = currentPage === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              disabled={!connected}
              onClick={() => navigate(tab.id)}
              className="relative flex-1 disabled:opacity-40"
            >
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-active"
                  className="absolute inset-x-0 -top-[7px] bottom-[3px] rounded-2xl"
                  style={{
                    background:
                      "linear-gradient(160deg, #FFE989 0%, #FACC15 55%, #C79B0B 100%)",
                    boxShadow:
                      "0 3px 0 #7A5C06, 0 8px 18px -8px rgba(250,204,21,0.55), inset 0 2px 0 rgba(255,255,255,0.55)",
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                />
              )}
              <span
                className={`relative z-10 flex h-[52px] flex-col items-center justify-center gap-0.5 transition-transform ${
                  isActive ? "-translate-y-[3px]" : ""
                }`}
                style={{
                  color: isActive ? "#241903" : "rgba(255,255,255,0.42)",
                }}
              >
                <Icon size={20} />
                <span className="font-sans text-[10px] font-extrabold uppercase tracking-[0.08em]">
                  {tab.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * The landing's dock: the same furniture, asleep — dim, inert, no gold key.
 * It wakes in place when the wallet connects and BottomNav takes over.
 */
export const SleepingDock = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute bottom-[max(0.9rem,env(safe-area-inset-bottom))] left-1/2 z-30 w-[94%] max-w-[560px] -translate-x-1/2 rounded-[24px] p-1.5 opacity-45"
    style={DOCK_STYLE}
  >
    <div className="flex items-stretch gap-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <div
            key={tab.id}
            className="flex h-[52px] flex-1 flex-col items-center justify-center gap-0.5"
            style={{ color: "rgba(255,255,255,0.42)" }}
          >
            <Icon size={20} />
            <span className="font-sans text-[10px] font-extrabold uppercase tracking-[0.08em]">
              {tab.label}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

export default BottomNav;
