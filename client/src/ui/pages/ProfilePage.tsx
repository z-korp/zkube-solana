import React, { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { motion } from "motion/react";

import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useFeaturedEmblemController } from "@/chain/useFeaturedEmblemController";
import { usePlayerLabelController } from "@/chain/usePlayerLabelController";
import { useNavigationStore } from "@/stores/navigationStore";
import StatsTab from "@/ui/components/profile/StatsTab";
import ZoneProgressTab from "@/ui/components/profile/ZoneProgressTab";
import ProfileHeaderCard from "@/ui/components/profile/ProfileHeaderCard";
import PageHeader from "@/ui/components/shared/PageHeader";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { staggerContainer, staggerItem } from "@/ui/motion";

const TABS = ["Arcade", "Campaign"] as const;

const containerVariants = staggerContainer(0.06);

const ProfilePage: React.FC = () => {
  const colors = useThemeColors();
  const player = useConnectedPlayer();
  const address = player.publicKey?.toBase58() ?? "";
  const profile = usePlayerProfile();
  const { zones, totalStars } = useZoneProgress(address);
  const playerLabel = usePlayerLabelController();
  const emblem = useFeaturedEmblemController();

  // The controller's value updates immediately on save; fall back to the
  // profile projection before it has loaded so the UI never flickers to auto.
  const featuredEmblem = emblem.featuredEmblem ?? profile.featuredEmblem;

  const [tab, setTab] = useState<(typeof TABS)[number]>("Arcade");
  const [labelInput, setLabelInput] = useState("");
  const navigate = useNavigationStore((state) => state.navigate);

  useEffect(() => {
    setLabelInput(playerLabel.label?.displayName ?? "");
  }, [playerLabel.label?.displayName]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <PageHeader
        title="Profile"
        rightSlot={
          <button
            type="button"
            aria-label="Settings"
            onClick={() => navigate("settings")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-lg backdrop-blur-md transition-all hover:bg-white/[0.08] active:scale-95"
          >
            <Settings size={18} className="text-white/80" />
          </button>
        }
      />

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        <motion.div
          key="profile-container"
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
        >
          <motion.section
            variants={staggerItem}
            className="rounded-3xl border border-white/[0.16] bg-white/[0.12] p-4 shadow-lg shadow-black/20 backdrop-blur-2xl"
          >
            <ProfileHeaderCard
              displayName={playerLabel.label?.displayName}
              address={address}
              featuredEmblem={featuredEmblem}
              zones={zones}
              onEditIdentity={() => navigate("settings")}
            />
          </motion.section>

          <motion.section
            variants={staggerItem}
            className="rounded-3xl border border-white/[0.12] bg-white/[0.07] p-4 backdrop-blur-xl"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void playerLabel.save(labelInput).catch(() => undefined);
              }}
              className="flex flex-col gap-3"
            >
              <div>
                <p className="font-sans text-sm font-extrabold text-white">
                  Display name
                </p>
                <p className="mt-1 font-sans text-[11px] font-semibold text-white/50">
                  Shown next to your wallet on the leaderboards.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  value={labelInput}
                  onChange={(event) => setLabelInput(event.target.value)}
                  minLength={3}
                  maxLength={16}
                  pattern="[A-Za-z][A-Za-z0-9_]{2,15}"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Public player label"
                  placeholder="Wave_Rider"
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/25 px-3 py-2 font-sans text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-cyan-300/50"
                />
                <button
                  type="submit"
                  disabled={
                    playerLabel.loading ||
                    playerLabel.saving ||
                    labelInput === playerLabel.label?.displayName
                  }
                  className="rounded-xl border border-cyan-300/30 bg-cyan-300/15 px-4 py-2 font-sans text-xs font-black text-cyan-100 disabled:opacity-40"
                >
                  {playerLabel.saving
                    ? "Saving…"
                    : playerLabel.label
                      ? "Update"
                      : "Set label"}
                </button>
              </div>
              {playerLabel.error && (
                <p
                  role="alert"
                  className="font-sans text-xs font-semibold text-red-300"
                >
                  {playerLabel.error}
                </p>
              )}
            </form>
          </motion.section>

          <motion.div variants={staggerItem}>
            <SegmentedTabs
              tabs={TABS}
              active={tab}
              onChange={setTab}
              layoutId="profile-tab-indicator"
              accent={colors.accent}
            />
          </motion.div>

          <motion.div variants={staggerItem} className="px-0.5">
            {tab === "Arcade" && (
              <StatsTab
                profile={profile}
                zones={zones}
                featuredEmblem={featuredEmblem}
                onSelectEmblem={emblem.save}
                emblemSaving={emblem.saving}
                emblemError={emblem.error}
              />
            )}

            {tab === "Campaign" && (
              <ZoneProgressTab zones={zones} totalStars={totalStars} />
            )}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default ProfilePage;
