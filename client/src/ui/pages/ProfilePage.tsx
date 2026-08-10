import React, { useMemo, useState } from "react";
import { Flame, LockKeyhole, Pencil, Share2 } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useFeaturedEmblemController } from "@/chain/useFeaturedEmblemController";
import { usePlayerLabelController } from "@/chain/usePlayerLabelController";
import { getZoneGuardian } from "@/config/bossCharacters";
import {
  resolveAutoEmblemId,
  resolveEmblemStates,
  type EmblemZoneInput,
} from "@/config/emblems";
import type { CompetitionRecord } from "@/chain/campaignClient";
import {
  LADDER_STREAK_BONUS_CAP_DAYS,
  LADDER_TIER_THRESHOLDS,
  isTopLadderTier,
  ladderStreakBonusPct,
  ladderTierColor,
  ladderTierName,
  ladderTierProgress,
} from "@/config/ladderTiers";
import type { ZoneProgressData } from "@/config/profileData";
import { useDaily } from "@/contexts/daily";
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import ShareCardSheet from "@/ui/components/profile/ShareCardSheet";
import {
  EmblemBadge,
  GuardianFaceBlock,
  KreditCoin,
  MONEY_GOLD,
  SolMark,
  TierFrame,
  mixHex,
} from "@/ui/components/economy";
import type { MasteryBadge } from "@/ui/components/economy/GuardianFaceBlock";
import ZoneBackdrop from "@/ui/components/shared/ZoneBackdrop";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatSolBalance, formatSolBalanceLamports } from "@/utils/currency";
import { truncatePublicKey } from "@/utils/solanaDisplay";

/** Opaque block furniture — same recipe as the marquee, no glass. */
const PANEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow:
    "0 12px 30px rgba(0,0,0,0.4), inset 0 1.5px 0 rgba(255,255,255,0.09)",
};

const SECTION_CLASS =
  "font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45";
const STAT_LABEL =
  "block font-sans text-[8px] font-bold uppercase tracking-[0.16em] text-white/40";
const STAT_VALUE =
  "block font-mono text-[15px] font-bold tabular-nums text-white";
const CHIP_CLASS =
  "flex items-center gap-1 rounded-md border border-white/[0.1] bg-black/40 px-1.5 py-1 font-mono text-[11px] font-bold tabular-nums";

/** Campaign mastery for a realm, worn as a corner star rather than as a rim. */
function masteryForZone(
  zone: ZoneProgressData | undefined,
): MasteryBadge | null {
  if (!zone) return null;
  if (zone.perfectionClaimed || zone.stars >= zone.maxStars) return "perfected";
  if (zone.bossCleared) return "cleared";
  return null;
}

/**
 * Profile — who you are, then the two things you do.
 *
 * The page is split the way the app is: an identity header, an Arcade panel
 * and a Campaign panel, so every figure sits under the mode that produced it.
 * It used to be four panels that cut across both modes — a ladder rack, a
 * records table and a realm grid — which meant scrolling to assemble an answer
 * the page should just state.
 *
 * The five-block tier rack is gone with them: the frame around the player's own
 * block already says which tier they hold, and the bar says what is left of it.
 */
const ProfilePage: React.FC = () => {
  const player = useConnectedPlayer();
  const address = player.publicKey?.toBase58() ?? "";
  const profile = usePlayerProfile();
  const { zones, totalStars } = useZoneProgress(address);
  const playerLabel = usePlayerLabelController();
  const emblem = useFeaturedEmblemController();
  const daily = useDaily();
  const themeColors = useThemeColors();

  const [shareOpen, setShareOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // The realm follows you everywhere: same zone art as Home and Arcade.
  const backdropZoneId = daily.daily?.mapId ?? 1;

  // The stored id, with auto (0) resolved to the strongest unlocked emblem.
  const storedEmblem = emblem.featuredEmblem ?? profile.featuredEmblem;
  const featuredEmblem = useMemo(() => {
    if (storedEmblem > 0) return storedEmblem;
    return resolveAutoEmblemId(zones as readonly EmblemZoneInput[]);
  }, [storedEmblem, zones]);

  // The two mastery crests share the realm rack below the guardians.
  const crestStates = useMemo(
    () =>
      resolveEmblemStates(zones as readonly EmblemZoneInput[]).filter(
        (state) =>
          state.descriptor.kind === "realm" ||
          state.descriptor.kind === "world",
      ),
    [zones],
  );

  // The border the player wears, which any tier they ever reached unlocks.
  const wornFrameTier = Math.min(
    emblem.featuredFrameTier ?? profile.featuredFrameTier,
    profile.highestLadderTier,
  );

  // Emblem and border are one decision — what you look like on a board — so
  // they travel together in one signature.
  const wearIdentity = (emblemId: number, frameTier: number) => {
    if (
      emblem.saving ||
      (emblemId === featuredEmblem && frameTier === wornFrameTier)
    ) {
      return;
    }
    void emblem.save(emblemId, frameTier).catch(() => undefined);
  };

  const wornRing = (worn: boolean): React.CSSProperties | undefined =>
    worn
      ? {
          boxShadow: `0 0 0 2px ${themeColors.accent}, 0 0 16px ${themeColors.accent}55`,
        }
      : undefined;

  const displayName =
    playerLabel.label?.displayName ?? truncatePublicKey(address);
  const balance =
    player.balanceLamports !== null
      ? formatSolBalance(player.balanceLamports)
      : null;

  // One entry places on both boards, so the two records together say how a
  // player wins: on total performance, or on playing the day's theme.
  const records: Array<{ label: string; hint: string; record: CompetitionRecord }> = [
    { label: "Score", hint: "Total performance", record: profile.scoreRecord },
    { label: "Theme", hint: "The day's objective", record: profile.themeRecord },
  ];

  const currentTier =
    LADDER_TIER_THRESHOLDS.filter(
      (threshold) => profile.ladderPoints >= threshold,
    ).length - 1;
  const tierColor = ladderTierColor(currentTier);
  const { fraction, remaining } = ladderTierProgress(
    profile.ladderPoints,
    currentTier,
  );
  const atTopTier = isTopLadderTier(currentTier);
  // The better of the two boards: a card brags with one number, not two.
  const bestRankAcrossBoards = records
    .map(({ record }) => record.bestPrizeRank)
    .filter((rank) => rank > 0)
    .reduce((best, rank) => (best === 0 ? rank : Math.min(best, rank)), 0);
  const bonusPct = ladderStreakBonusPct(profile.entryStreakDays);

  const saveName = () => {
    void playerLabel
      .save(nameInput)
      .then(() => setEditingName(false))
      .catch(() => undefined);
  };

  return (
    <div className="relative flex min-h-full flex-col gap-2.5 px-4 pb-[104px] pt-7">
      <ZoneBackdrop zoneId={backdropZoneId} />

      {/* The page title wears the same crown as zKube on Home. */}
      <h1
        className="relative z-10 text-center font-display text-[46px] leading-none"
        style={{ color: "#FFF4D7", textShadow: "0 4px 20px rgba(0,0,0,0.7)" }}
      >
        Profile
      </h1>

      {/* Identity — the worn emblem inside its rank frame, the name, and what
          the wallet is holding. Everything here is who you are; nothing here
          is a result. */}
      <section className="relative z-10 rounded-2xl p-3.5" style={PANEL_STYLE}>
        <button
          type="button"
          aria-label="Share profile card"
          onClick={() => setShareOpen(true)}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border border-white/[0.12] bg-black/40 text-white/65"
        >
          <Share2 size={14} />
        </button>
        <div className="flex items-center gap-3">
          {/* No mastery star inside the frame — the two ornaments collide on
              the same corner, and the Campaign rack below already carries it
              on every realm. */}
          <TierFrame tier={wornFrameTier} size={68}>
            {featuredEmblem >= 1 && featuredEmblem <= 10 ? (
              <GuardianFaceBlock zoneId={featuredEmblem} size={68} framed />
            ) : (
              <EmblemBadge
                emblemId={featuredEmblem}
                totalStars={totalStars}
                size={68}
              />
            )}
          </TierFrame>

          <div className="min-w-0 flex-1">
            {editingName ? (
              <form
                className="flex items-center gap-2 pr-9"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveName();
                }}
              >
                <input
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  minLength={3}
                  maxLength={16}
                  pattern="[A-Za-z][A-Za-z0-9_]{2,15}"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  aria-label="Public player label"
                  className="min-w-0 flex-1 rounded-xl border border-white/[0.12] bg-black/40 px-3 py-1.5 font-sans text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-[#FACC15]/60"
                />
                <button
                  type="submit"
                  disabled={playerLabel.saving}
                  className="rounded-lg px-3 py-1.5 font-sans text-[11px] font-extrabold uppercase text-[#241903] disabled:opacity-40"
                  style={{
                    background:
                      "linear-gradient(160deg, #FCE177 0%, #FACC15 55%, #B4930F 100%)",
                    boxShadow:
                      "0 2px 0 #705C09, inset 0 1px 0 rgba(255,255,255,0.5)",
                  }}
                >
                  {playerLabel.saving ? "…" : "Save"}
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-1.5 pr-9">
                <span className="truncate font-display text-[26px] leading-tight text-white">
                  {displayName}
                </span>
                <button
                  type="button"
                  aria-label="Edit display name"
                  onClick={() => {
                    setNameInput(playerLabel.label?.displayName ?? "");
                    setEditingName(true);
                  }}
                  className="grid h-6 w-6 flex-none place-items-center rounded-md border border-white/[0.12] bg-white/[0.07] text-white/60"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )}
            <p className="mt-0.5 font-mono text-[11px] font-semibold text-white/45">
              {truncatePublicKey(address)}
            </p>
            {/* What the wallet is holding, in one line. */}
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {balance !== null && (
                <span className={CHIP_CLASS} style={{ color: themeColors.text }}>
                  {balance}
                  <SolMark size={9} />
                </span>
              )}
              {daily.daily && (
                <span className={CHIP_CLASS} style={{ color: MONEY_GOLD }}>
                  <KreditCoin size={12} />
                  {daily.daily.kreditBalance.toString()}
                </span>
              )}
            </p>
          </div>
        </div>
        {playerLabel.error && (
          <p role="alert" className="mt-2 font-sans text-xs text-red-300">
            {playerLabel.error}
          </p>
        )}
      </section>

      {/* Arcade — the paid mode, in one panel: the rank you hold, the streak
          multiplying it, what you have played, and what the two boards paid. */}
      <section className="relative z-10 rounded-2xl p-3.5" style={PANEL_STYLE}>
        <div className="flex items-baseline justify-between gap-3">
          <p className={SECTION_CLASS}>Arcade</p>
          <span
            className="font-mono text-[13px] font-bold tabular-nums"
            style={{ color: MONEY_GOLD }}
          >
            {Number(profile.ladderPoints).toLocaleString()}
            <span className="ml-1 font-sans text-[8px] font-bold uppercase tracking-[0.1em] text-white/45">
              pts
            </span>
          </span>
        </div>

        <div
          className="mt-2 h-2 overflow-hidden rounded-full"
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.round(fraction * 100)}%`,
              background: `linear-gradient(90deg, ${mixHex(tierColor, 0, 0.2)}, ${mixHex(tierColor, 255, 0.35)})`,
              boxShadow: `0 0 10px ${tierColor}88`,
            }}
          />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <span
            className="font-display text-[20px] leading-none"
            style={{ color: tierColor }}
          >
            {ladderTierName(currentTier)}
          </span>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-white/50">
            {atTopTier
              ? "Top tier"
              : `${Number(remaining).toLocaleString()} to ${ladderTierName(currentTier + 1)}`}
          </span>
        </div>
        {profile.highestLadderTier > currentTier && (
          <p className="mt-1 font-mono text-[11px] font-semibold text-white/45">
            Best ever · {ladderTierName(profile.highestLadderTier)}
          </p>
        )}

        {/* The streak states what it does. Every ladder award is scaled by it,
            so it belongs against the points above rather than filed as a
            third lifetime figure. */}
        <div
          className="mt-2.5 flex items-center gap-2 rounded-xl px-2.5 py-1.5"
          style={{
            background:
              bonusPct > 0 ? "rgba(250,204,21,0.09)" : "rgba(255,255,255,0.03)",
            boxShadow:
              bonusPct > 0
                ? "inset 0 0 0 1px rgba(250,204,21,0.3)"
                : "inset 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        >
          <Flame
            size={14}
            className="flex-none"
            style={{ color: bonusPct > 0 ? MONEY_GOLD : "rgba(255,255,255,0.3)" }}
          />
          <span className="min-w-0 flex-1 font-sans text-[12px] font-bold text-white/85">
            {profile.entryStreakDays > 0
              ? `${profile.entryStreakDays}-day streak`
              : "Play today to start a streak"}
          </span>
          <span
            className="flex-none font-mono text-[13px] font-bold tabular-nums"
            style={{ color: bonusPct > 0 ? MONEY_GOLD : "rgba(255,255,255,0.35)" }}
          >
            +{bonusPct}%
            {bonusPct >= LADDER_STREAK_BONUS_CAP_DAYS && (
              <span className="ml-1 font-sans text-[8px] font-bold uppercase tracking-[0.12em] text-white/45">
                max
              </span>
            )}
          </span>
        </div>

        {/* The borders. A rank you reached stays yours to wear, so this is a
            picker rather than a trophy shelf — and it is the only place the
            higher ranks are visible before you hold them. */}
        <div className="mt-2.5 flex items-center justify-between gap-1 border-t border-white/[0.07] pt-2.5">
          {LADDER_TIER_THRESHOLDS.map((_, tier) => {
            const unlocked = tier <= profile.highestLadderTier;
            const worn = tier === wornFrameTier;
            return (
              <button
                key={tier}
                type="button"
                disabled={!unlocked || emblem.saving}
                title={ladderTierName(tier)}
                aria-label={`Wear the ${ladderTierName(tier)} border`}
                aria-pressed={worn}
                onClick={() => wearIdentity(featuredEmblem, tier)}
                className="relative grid place-items-center rounded-xl disabled:cursor-not-allowed"
                style={{
                  width: 56,
                  height: 56,
                  opacity: unlocked ? 1 : 0.32,
                  filter: unlocked ? undefined : "grayscale(1)",
                  boxShadow: worn
                    ? `inset 0 0 0 1.5px ${ladderTierColor(tier)}, 0 0 14px ${ladderTierColor(tier)}55`
                    : undefined,
                }}
              >
                <TierFrame tier={tier} size={26}>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "24%",
                      background: "rgba(4,7,15,0.75)",
                    }}
                  />
                </TierFrame>
              </button>
            );
          })}
        </div>

        {/* The two figures a board cannot keep: its rows hold only payout
            places and its accounts are recycled. */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-2.5">
          <span>
            <span className={STAT_LABEL}>Best run</span>
            <span className={STAT_VALUE}>
              {profile.bestDailyScore.toLocaleString()}
            </span>
          </span>
          <span className="text-center">
            <span className={STAT_LABEL}>Entries</span>
            <span className={STAT_VALUE}>
              {profile.lifetimePaidEntries.toLocaleString()}
            </span>
          </span>
          <span className="text-right">
            <span className={STAT_LABEL}>Earned</span>
            <span
              className="flex items-center justify-end gap-1 font-mono text-[15px] font-bold tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(profile.totalRewardsLamports)}
              <SolMark size={10} />
            </span>
          </span>
        </div>

        {/* Split the way the pot is. A player who never wins Score can still
            own Theme, and one aggregate row could not say so. */}
        <div className="mt-1">
          {records.map(({ label, hint, record }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 border-t border-white/[0.05] pt-2.5 first:mt-2.5"
            >
              <span
                className="flex-none rounded-md px-1.5 py-0.5 font-mono text-[11px] font-black text-[#181205]"
                style={{
                  background:
                    record.bestPrizeRank > 0
                      ? MONEY_GOLD
                      : "rgba(255,255,255,0.25)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
                }}
              >
                {record.bestPrizeRank > 0 ? `#${record.bestPrizeRank}` : "—"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-sans text-[13px] font-extrabold text-white">
                  {label}
                  <span className="ml-1.5 font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">
                    {hint}
                  </span>
                </span>
              </span>
              <span className="flex-none font-sans text-[11px] font-semibold text-white/45">
                {record.wins}W · {record.podiums}P
              </span>
              <span
                className="flex w-[76px] flex-none items-center justify-end gap-1 font-mono text-[13px] font-bold tabular-nums"
                style={{ color: MONEY_GOLD }}
              >
                {formatSolBalanceLamports(record.rewardsLamports)}
                <SolMark size={10} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Campaign — the free mode, and the emblem rack in the same breath:
          tapping an unlocked realm wears its guardian. */}
      <section className="relative z-10 rounded-2xl p-3.5" style={PANEL_STYLE}>
        {/* The two mastery crests ride the header rather than owning a row of
            their own: they are two icons, and a labelled row cost more height
            than the ten realms beneath it. */}
        <div className="flex items-center justify-between gap-3">
          <p className={SECTION_CLASS}>Campaign</p>
          <span className="flex items-center gap-2">
            {crestStates.map((state) => (
              <button
                key={state.descriptor.id}
                type="button"
                disabled={!state.unlocked || emblem.saving}
                title={state.descriptor.name}
                aria-label={`Wear the ${state.descriptor.name} emblem`}
                aria-pressed={state.descriptor.id === featuredEmblem}
                onClick={() => wearIdentity(state.descriptor.id, wornFrameTier)}
                className="rounded-xl p-0.5 disabled:cursor-not-allowed"
                style={wornRing(state.descriptor.id === featuredEmblem)}
              >
                <EmblemBadge
                  emblemId={state.descriptor.id}
                  size={34}
                  state={
                    state.gold ? "gold" : state.unlocked ? "unlocked" : "locked"
                  }
                />
              </button>
            ))}
            <span
              className="font-mono text-[13px] font-bold tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              ★ {totalStars}
              <span className="text-white/40">/300</span>
            </span>
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-5 justify-items-center gap-y-2.5">
          {zones.map((zone) => (
            <button
              key={zone.zoneId}
              type="button"
              disabled={!zone.unlocked || emblem.saving}
              aria-label={`Wear the ${getZoneGuardian(zone.zoneId).name} emblem`}
              aria-pressed={zone.zoneId === featuredEmblem}
              onClick={() => wearIdentity(zone.zoneId, wornFrameTier)}
              className="flex flex-col items-center gap-0.5 disabled:cursor-not-allowed"
            >
              <span
                className="rounded-2xl p-0.5"
                style={wornRing(zone.zoneId === featuredEmblem)}
              >
                {zone.unlocked ? (
                  <GuardianFaceBlock
                    zoneId={zone.zoneId}
                    size={58}
                    badge={masteryForZone(zone)}
                  />
                ) : (
                  <span
                    className="grid place-items-center text-white/35"
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: "24%",
                      background:
                        "linear-gradient(135deg, #2A3850 0%, #16202F 100%)",
                      boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.14)",
                    }}
                  >
                    <LockKeyhole size={14} />
                  </span>
                )}
              </span>
              <span
                className="font-mono text-[10px] font-bold tabular-nums"
                style={{
                  color: zone.unlocked ? MONEY_GOLD : "rgba(255,255,255,0.25)",
                }}
              >
                ★ {zone.stars}
              </span>
            </button>
          ))}
        </div>
        {emblem.error && (
          <p
            role="alert"
            className="mt-2 text-center font-sans text-xs text-red-300"
          >
            {emblem.error}
          </p>
        )}
      </section>

      <ShareCardSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        data={{
          displayName,
          featuredEmblem,
          frameTier: wornFrameTier,
          ladderPoints: profile.ladderPoints,
          totalStars,
          totalEarnedLamports: profile.totalRewardsLamports,
          entryStreakDays: profile.entryStreakDays,
          bestPrizeRank: bestRankAcrossBoards,
        }}
      />
    </div>
  );
};

export default ProfilePage;
