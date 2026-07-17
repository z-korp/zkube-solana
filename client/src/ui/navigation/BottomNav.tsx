import { Home, ShoppingBag, Star, Trophy, User } from "lucide-react";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useNavigationStore, FULLSCREEN_PAGES } from "@/stores/navigationStore";
import type { PageId } from "@/stores/navigationStore";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { getLevelFromXp } from "@/config/profileData";
import { motion } from "motion/react";
import { useProgress } from "@/contexts/progress";

const BottomNav = () => {
  const currentPage = useNavigationStore((s) => s.currentPage);
  const navigate = useNavigationStore((s) => s.navigate);
  const openShop = useNavigationStore((s) => s.openShop);
  const colors = useThemeColors();
  const { progress } = useProgress();
  // The menu stays visible but locked until a wallet is connected.
  const connected = useConnectedPlayer().publicKey !== null;
  // Everything this badge counts is claimable ON the Rewards page:
  // quests + feats (achievements) + level milestones.
  const level = getLevelFromXp(Number(progress?.lifetimeXp ?? 0n));
  const milestoneBitmap = progress?.levelMilestones?.claimed ?? 0;
  let milestoneClaimables = 0;
  for (let index = 0; index < 10; index++) {
    if (level >= (index + 1) * 10 && !(milestoneBitmap & (1 << index))) {
      milestoneClaimables++;
    }
  }
  const milestoneEntitlement = Array.from({ length: 10 }, (_, index) =>
    milestoneBitmap & (1 << index) ? (index + 1) * 10 : 0,
  ).reduce((sum, stars) => sum + stars, 0);
  if (
    milestoneEntitlement >
    Number(progress?.levelMilestones?.totalStarsClaimed ?? 0n)
  ) {
    milestoneClaimables++;
  }
  const claimableCount =
    (progress?.achievements.filter((entry) => entry.claimable).length ?? 0) +
    (progress?.quests.filter((entry) => entry.claimable).length ?? 0) +
    milestoneClaimables;

  if (FULLSCREEN_PAGES.has(currentPage)) {
    return null;
  }

  const tabs: {
    id: PageId;
    icon: React.ElementType;
    label: string;
    badge?: number;
  }[] = [
    { id: "home", icon: Home, label: "Home" },
    { id: "rewards", icon: Star, label: "Rewards", badge: claimableCount },
    { id: "ranks", icon: Trophy, label: "Arena" },
    { id: "shop", icon: ShoppingBag, label: "Shop" },
    { id: "profile", icon: User, label: "Profile" },
  ];

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex h-16 w-[92%] max-w-[560px] items-center justify-around rounded-full border border-white/[0.12] bg-black/60 px-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      {tabs.map((tab) => {
        const isActive = currentPage === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            disabled={!connected}
            onClick={() =>
              tab.id === "shop" ? openShop(null) : navigate(tab.id)
            }
            className="relative flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-colors disabled:opacity-40"
            style={{
              color: isActive ? colors.accent : "rgba(255, 255, 255, 0.4)",
            }}
          >
            <div className="relative">
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              {tab.badge && tab.badge > 0 ? (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-sans text-[9px] font-bold text-white shadow-sm">
                  {tab.badge > 9 ? "9+" : tab.badge}
                </span>
              ) : null}
            </div>
            <span className="text-[9px] font-medium tracking-wide font-sans">
              {tab.label}
            </span>
            {isActive && (
              <motion.div
                layoutId="bottom-nav-indicator"
                className="absolute -top-3 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b-full shadow-[0_4px_12px_rgba(255,255,255,0.5)]"
                style={{
                  backgroundColor: colors.accent,
                  boxShadow: `0 2px 8px ${colors.accent}`,
                }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default BottomNav;
