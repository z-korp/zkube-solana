import React from "react";
import { motion } from "motion/react";

import { WORLD_PERFECT_STARS, type EmblemZoneInput } from "@/config/emblems";
import type { PlayerProfile } from "@/hooks/usePlayerProfile";
import CompetitionRecordCard from "@/ui/components/profile/CompetitionRecordCard";
import EmblemPicker from "@/ui/components/profile/EmblemPicker";
import StatTile from "@/ui/components/shared/StatTile";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { staggerContainer, staggerItem } from "@/ui/motion";
import { formatSolLamports } from "@/utils/currency";
import { bigintToSafeNumber } from "@/utils/solanaDisplay";

const containerVariants = staggerContainer(0.05);

interface StatsTabProps {
  /** Competitive profile projected from the on-chain PlayerState. */
  profile: PlayerProfile;
  /** Per-zone Campaign progress for the emblem gallery. */
  zones: readonly EmblemZoneInput[];
  /** Stored featured emblem id (0 = auto). */
  featuredEmblem: number;
  /** Owner-signed emblem save. */
  onSelectEmblem: (emblemId: number) => Promise<unknown> | void;
  emblemSaving: boolean;
  emblemError: string | null;
}

/**
 * The Arcade half of the Profile: the lifetime record tiles, the cosmetic
 * emblem gallery/picker, and the collapsible Daily/Weekly/Season prize records.
 * Every figure is read straight from the authoritative PlayerProfile — there is
 * no XP, level, title, or general progression here.
 */
const StatsTab: React.FC<StatsTabProps> = ({
  profile,
  zones,
  featuredEmblem,
  onSelectEmblem,
  emblemSaving,
  emblemError,
}) => {
  const colors = useThemeColors();

  const paidEntries = bigintToSafeNumber(profile.lifetimePaidEntries);
  const tiles: Array<{ label: string; value: string; color?: string }> = [
    {
      label: "Campaign stars",
      value: `${profile.totalStars}/${WORLD_PERFECT_STARS}`,
      color: colors.accent2,
    },
    { label: "Paid entries", value: paidEntries.toLocaleString() },
    {
      label: "Total wins",
      value: profile.totalWins > 0 ? profile.totalWins.toLocaleString() : "--",
    },
    {
      label: "Rewards won",
      value:
        profile.totalRewardsLamports > 0n
          ? `${formatSolLamports(profile.totalRewardsLamports)} SOL`
          : "--",
      color: profile.totalRewardsLamports > 0n ? colors.accent2 : undefined,
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-4 pb-2"
    >
      <section>
        <motion.p
          variants={staggerItem}
          className="mb-2 font-sans text-[11px] font-bold uppercase tracking-[0.15em]"
          style={{ color: colors.textMuted }}
        >
          Lifetime record
        </motion.p>
        <div className="grid grid-cols-2 gap-2.5">
          {tiles.map((tile) => (
            <motion.div variants={staggerItem} key={tile.label}>
              <StatTile
                label={tile.label}
                value={tile.value}
                color={tile.color ?? colors.text}
                labelColor={colors.textMuted}
                className="bg-white/[0.1]"
              />
            </motion.div>
          ))}
        </div>
      </section>

      <motion.div variants={staggerItem}>
        <EmblemPicker
          zones={zones}
          featuredEmblem={featuredEmblem}
          onSelect={onSelectEmblem}
          saving={emblemSaving}
          error={emblemError}
        />
      </motion.div>

      <section>
        <motion.p
          variants={staggerItem}
          className="mb-2 font-sans text-[11px] font-bold uppercase tracking-[0.15em]"
          style={{ color: colors.textMuted }}
        >
          Prize records
        </motion.p>
        <div className="flex flex-col gap-2.5">
          <motion.div variants={staggerItem}>
            <CompetitionRecordCard title="Daily" record={profile.dailyRecord} />
          </motion.div>
          <motion.div variants={staggerItem}>
            <CompetitionRecordCard
              title="Weekly"
              record={profile.weeklyRecord}
              note="Three skill boards are counted independently."
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <CompetitionRecordCard
              title="Season"
              record={profile.seasonRecord}
            />
          </motion.div>
        </div>
      </section>
    </motion.div>
  );
};

export default StatsTab;
