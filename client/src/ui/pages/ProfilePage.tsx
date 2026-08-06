import React, { useMemo, useState } from "react";
import { LockKeyhole, Pencil, Share2 } from "lucide-react";

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
import type { ZoneProgressData } from "@/config/profileData";
import { useDaily } from "@/contexts/daily";
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import ShareCardSheet from "@/ui/components/profile/ShareCardSheet";
import {
  EmblemBadge,
  GuardianFaceBlock,
  MONEY_GOLD,
  SolMark,
} from "@/ui/components/economy";
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

function rimForZone(
  zone: ZoneProgressData | undefined,
): "white" | "silver" | "gold" {
  if (!zone) return "white";
  if (zone.perfectionClaimed || zone.stars >= zone.maxStars) return "gold";
  if (zone.bossCleared) return "silver";
  return "white";
}

/**
 * Profile — one scroll of display. Identity at the top (the pencil edits the
 * name in place), the competition records under it, the realm grid at the
 * bottom — which is also the emblem rack: tapping a realm wears its guardian.
 * Nothing here links to Settings — that sheet lives behind Home's gold gear.
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

  const wearEmblem = (emblemId: number) => {
    if (emblem.saving || emblemId === featuredEmblem) return;
    void emblem.save(emblemId).catch(() => undefined);
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

  const records: Array<{ label: string; record: CompetitionRecord }> = [
    { label: "Daily", record: profile.dailyRecord },
    { label: "Weekly", record: profile.weeklyRecord },
    { label: "Season", record: profile.seasonRecord },
  ];

  const saveName = () => {
    void playerLabel
      .save(nameInput)
      .then(() => setEditingName(false))
      .catch(() => undefined);
  };

  return (
    <div className="relative flex min-h-full flex-col gap-3 px-4 pb-[104px] pt-7">
      <ZoneBackdrop zoneId={backdropZoneId} />

      {/* The page title wears the same crown as zKube on Home. */}
      <h1
        className="relative z-10 text-center font-display text-[46px] leading-none"
        style={{ color: "#FFF4D7", textShadow: "0 4px 20px rgba(0,0,0,0.7)" }}
      >
        Profile
      </h1>

      {/* Home's rhythm exactly: the free height splits 1:2 around the content
          — 1 share under the crown, 2 below the realms. */}
      <div className="min-h-[16px] flex-1" />

      {/* Identity — the worn emblem out front (change it by tapping a realm
          in the rack below), the pencil edits the name in place. The balance
          is a readout (Home's plate taps here). */}
      <section
        className="relative z-10 rounded-2xl p-4"
        style={PANEL_STYLE}
      >
        <button
          type="button"
          aria-label="Share profile card"
          onClick={() => setShareOpen(true)}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border border-white/[0.12] bg-black/40 text-white/65"
        >
          <Share2 size={14} />
        </button>
        <div className="flex items-center gap-3">
          <span className="flex-none">
            {featuredEmblem >= 1 && featuredEmblem <= 10 ? (
              <GuardianFaceBlock
                zoneId={featuredEmblem}
                size={92}
                rim={rimForZone(
                  zones.find((zone) => zone.zoneId === featuredEmblem),
                )}
              />
            ) : (
              <EmblemBadge
                emblemId={featuredEmblem}
                totalStars={totalStars}
                size={92}
              />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {editingName ? (
              <form
                className="flex items-center gap-2"
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
              <div className="flex items-center gap-1.5">
                <span className="truncate font-display text-[28px] leading-tight text-white">
                  {displayName}
                </span>
                <button
                  type="button"
                  aria-label="Edit display name"
                  onClick={() => {
                    setNameInput(playerLabel.label?.displayName ?? "");
                    setEditingName(true);
                  }}
                  className="grid h-7 w-7 flex-none place-items-center rounded-md border border-white/[0.12] bg-white/[0.07] text-white/60"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
            <p className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] font-semibold text-white/50">
              {truncatePublicKey(address)}
              {balance !== null && (
                <span
                  className="flex items-center gap-1 rounded-md border border-white/[0.1] bg-black/40 px-2 py-1 text-xs font-bold tabular-nums"
                  style={{ color: MONEY_GOLD }}
                >
                  {balance}
                  <SolMark size={10} />
                  <span className="font-sans text-[8px] font-bold uppercase tracking-[0.1em] text-white/45">
                    wallet
                  </span>
                </span>
              )}
              <span
                className="flex items-center gap-1 rounded-md border border-white/[0.1] bg-black/40 px-2 py-1 text-xs font-bold tabular-nums"
                style={{ color: MONEY_GOLD }}
              >
                {formatSolBalanceLamports(profile.totalRewardsLamports)}
                <SolMark size={10} />
                <span className="font-sans text-[8px] font-bold uppercase tracking-[0.1em] text-white/45">
                  earned
                </span>
              </span>
            </p>
          </div>
        </div>
        {playerLabel.error && (
          <p role="alert" className="mt-2 font-sans text-xs text-red-300">
            {playerLabel.error}
          </p>
        )}
      </section>

      {/* Competition records — did last night pay? */}
      <section className="relative z-10 rounded-2xl p-4" style={PANEL_STYLE}>
        <p className={SECTION_CLASS}>Competition records</p>
        <div className="mt-1">
          {records.map(({ label, record }) => (
            <div
              key={label}
              className="flex items-center gap-3 border-t border-white/[0.05] py-3 first:border-t-0"
            >
              <span
                className="flex-none rounded-lg px-2 py-1 font-mono text-xs font-black text-[#181205]"
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
                <span className="block font-sans text-[15px] font-extrabold text-white">
                  {label}
                </span>
                <span className="block font-sans text-[11px] font-semibold text-white/45">
                  {record.wins} {record.wins === 1 ? "win" : "wins"} ·{" "}
                  {record.podiums} {record.podiums === 1 ? "podium" : "podiums"}
                </span>
              </span>
              <span
                className="flex items-center gap-1.5 font-mono text-[15px] font-bold tabular-nums"
                style={{ color: MONEY_GOLD }}
              >
                {formatSolBalanceLamports(record.rewardsLamports)}
                <SolMark size={12} />
              </span>
            </div>
          ))}
          <div className="flex items-center gap-3 border-t border-white/[0.10] pt-3">
            <span className="min-w-0 flex-1 font-sans text-[13px] font-extrabold uppercase tracking-[0.08em] text-white/70">
              Total earned
            </span>
            <span
              className="flex items-center gap-1.5 font-mono text-[17px] font-bold tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(profile.totalRewardsLamports)}
              <SolMark size={12} />
            </span>
          </div>
        </div>
      </section>

      {/* The realm grid — how deep am I, and the emblem rack: tapping an
          unlocked realm wears its guardian; the worn one carries the accent
          ring. The two mastery crests hang on the same rack. */}
      <section className="relative z-10 rounded-2xl p-4" style={PANEL_STYLE}>
        <p className={SECTION_CLASS}>Realms · ★ {totalStars}/300</p>
        <div className="mt-3 grid grid-cols-5 justify-items-center gap-y-3.5">
          {zones.map((zone) => (
            <button
              key={zone.zoneId}
              type="button"
              disabled={!zone.unlocked || emblem.saving}
              aria-label={`Wear the ${getZoneGuardian(zone.zoneId).name} emblem`}
              aria-pressed={zone.zoneId === featuredEmblem}
              onClick={() => wearEmblem(zone.zoneId)}
              className="flex flex-col items-center gap-1 disabled:cursor-not-allowed"
            >
              <span
                className="rounded-2xl p-0.5"
                style={wornRing(zone.zoneId === featuredEmblem)}
              >
                {zone.unlocked ? (
                  <GuardianFaceBlock
                    zoneId={zone.zoneId}
                    size={54}
                    rim={rimForZone(zone)}
                  />
                ) : (
                  <span
                    className="grid place-items-center text-white/35"
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: "24%",
                      background:
                        "linear-gradient(135deg, #2A3850 0%, #16202F 100%)",
                      boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.14)",
                    }}
                  >
                    <LockKeyhole size={15} />
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
        <div className="mt-3 flex justify-center gap-8 border-t border-white/[0.05] pt-3">
          {crestStates.map((state) => (
            <button
              key={state.descriptor.id}
              type="button"
              disabled={!state.unlocked || emblem.saving}
              aria-label={`Wear the ${state.descriptor.name} emblem`}
              aria-pressed={state.descriptor.id === featuredEmblem}
              onClick={() => wearEmblem(state.descriptor.id)}
              className="flex flex-col items-center gap-1 disabled:cursor-not-allowed"
            >
              <span
                className="rounded-2xl p-0.5"
                style={wornRing(state.descriptor.id === featuredEmblem)}
              >
                <EmblemBadge
                  emblemId={state.descriptor.id}
                  size={54}
                  state={
                    state.gold ? "gold" : state.unlocked ? "unlocked" : "locked"
                  }
                />
              </span>
              <span className="font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-white/45">
                {state.descriptor.name}
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

      <div className="flex-[2]" />

      <ShareCardSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        data={{
          displayName,
          address,
          featuredEmblem,
          totalStars,
          totalEarnedLamports: profile.totalRewardsLamports,
          records,
        }}
      />
    </div>
  );
};

export default ProfilePage;
