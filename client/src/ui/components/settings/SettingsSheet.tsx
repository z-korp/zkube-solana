import { useRef, useState } from "react";
import { Check, Copy, ExternalLink, Music2, Volume2 } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useMusicPlayer } from "@/contexts/hooks";
import { useNotifications } from "@/hooks/useNotifications";
import { useNavigationStore } from "@/stores/navigationStore";
import { MONEY_GOLD, mixHex, SolMark } from "@/ui/components/economy";
import ConnectCta from "@/ui/components/shared/ConnectCta";
import Sheet from "@/ui/components/shared/Sheet";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatSolBalance } from "@/utils/currency";
import { errorMessage } from "@/utils/errors";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const SECTION_CLASS =
  "font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45";
const KEY_CLASS =
  "rounded-xl px-3 py-2.5 text-center font-sans text-xs font-extrabold uppercase tracking-[0.06em] disabled:opacity-40";

/** Volume restored by a one-tap re-enable. */
const AUDIO_ON_LEVEL = 0.7;

function sessionLabel(status: string, validUntil?: number): string {
  if (status === "ready" && validUntil) {
    const seconds = validUntil - Math.floor(Date.now() / 1_000);
    if (seconds <= 0) return "Expired";
    const days = Math.floor(seconds / 86_400);
    if (days >= 1) return `${days}d left`;
    const hours = Math.floor(seconds / 3_600);
    if (hours >= 1) return `${hours}h left`;
    return "<1h left";
  }
  if (status === "checking") return "Checking";
  if (status === "expired") return "Expired";
  if (status === "needsRenewal") return "Renew required";
  return "Not enabled";
}

/**
 * Settings is a sheet, not a page: every visit is in-and-out (mute, renew,
 * disconnect), so the gold gear opens this over whatever page the player is
 * on and dismissing lands them right back. Everything that edits app state
 * lives here — except identity, which edits in place on Profile.
 */
const SettingsSheet: React.FC = () => {
  const open = useNavigationStore((state) => state.settingsOpen);
  const closeSettings = useNavigationStore((state) => state.closeSettings);
  // Utility controls wear the zone accent — gold is reserved for money
  // figures and the primary verb, and Connect below keeps it.
  const accent = useThemeColors().accent;
  const keyStyle: React.CSSProperties = {
    background: `linear-gradient(160deg, ${mixHex(accent, 255, 0.42)} 0%, ${accent} 55%, ${mixHex(accent, 0, 0.28)} 100%)`,
    boxShadow: `0 3px 0 ${mixHex(accent, 0, 0.55)}, inset 0 1.5px 0 rgba(255,255,255,0.5)`,
    color: "#0a1628",
  };
  const player = useConnectedPlayer();
  const { musicVolume, effectsVolume, setMusicVolume, setEffectsVolume } =
    useMusicPlayer();
  const notifications = useNotifications();
  const [copied, setCopied] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletStatus, setWalletStatus] = useState("");
  // Level each channel returns to when its mute key is tapped back on.
  const lastMusic = useRef(AUDIO_ON_LEVEL);
  const lastEffects = useRef(AUDIO_ON_LEVEL);
  const address = player.publicKey?.toBase58() ?? "";

  const runWalletAction = async (
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setWalletBusy(true);
    setWalletStatus("");
    try {
      await action();
      setWalletStatus(success);
    } catch (cause) {
      setWalletStatus(errorMessage(cause));
    } finally {
      setWalletBusy(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setWalletStatus("Wallet address copied.");
      window.setTimeout(() => setCopied(false), 1_400);
    } catch (cause) {
      setWalletStatus(errorMessage(cause));
    }
  };

  const notificationsDisabled =
    !notifications.supported || notifications.permission === "denied";

  return (
    <Sheet open={open} onClose={closeSettings} title="Settings">
      <div className="flex flex-col gap-4 pb-2">
        {/* Audio — the icon key mutes in one tap (and restores the last
            level); the slider sets the level. */}
        <section>
          <p className={SECTION_CLASS}>Audio</p>
          <div className="mt-2 flex flex-col gap-2.5">
            {(
              [
                ["Music", Music2, musicVolume, setMusicVolume, lastMusic],
                [
                  "Effects",
                  Volume2,
                  effectsVolume,
                  setEffectsVolume,
                  lastEffects,
                ],
              ] as const
            ).map(([label, Icon, value, onChange, last]) => {
              const on = value > 0;
              return (
                <div key={label} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Toggle ${label.toLowerCase()}`}
                    onClick={() => {
                      if (on) {
                        last.current = value;
                        onChange(0);
                      } else {
                        onChange(last.current || AUDIO_ON_LEVEL);
                      }
                    }}
                    className="grid h-10 w-10 flex-none place-items-center rounded-xl"
                    style={
                      on
                        ? keyStyle
                        : {
                            background: "rgba(0,0,0,0.4)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "rgba(255,255,255,0.45)",
                          }
                    }
                  >
                    <Icon size={17} />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    aria-label={`${label} volume`}
                    value={Math.round(value * 100)}
                    onChange={(event) => {
                      const next = Number(event.target.value) / 100;
                      if (next > 0) last.current = next;
                      onChange(next);
                    }}
                    className="h-2.5 flex-1 cursor-pointer appearance-none rounded-full border border-white/[0.08]"
                    style={{
                      accentColor: accent,
                      background: `linear-gradient(90deg, ${mixHex(accent, 0, 0.25)} 0%, ${accent} ${Math.round(value * 100)}%, rgba(255,255,255,0.16) ${Math.round(value * 100)}%)`,
                    }}
                  />
                  <span
                    className="w-9 flex-none text-right font-mono text-[13px] font-bold tabular-nums"
                    style={{ color: accent }}
                  >
                    {Math.round(value * 100)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Alerts */}
        <section>
          <p className={SECTION_CLASS}>Alerts</p>
          <div className="mt-2 flex items-center justify-between gap-4">
            <p className="font-sans text-sm font-bold text-white/85">
              Daily opens &amp; prize alerts
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={notifications.enabled}
              aria-label="Toggle notifications"
              disabled={notificationsDisabled}
              onClick={() => {
                if (notifications.enabled) {
                  notifications.disable();
                } else {
                  void notifications.requestAndEnable();
                }
              }}
              className="relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={
                notifications.enabled
                  ? {
                      background: `linear-gradient(160deg, ${mixHex(accent, 255, 0.35)}, ${accent})`,
                      borderColor: "transparent",
                    }
                  : {
                      background: "rgba(0,0,0,0.4)",
                      borderColor: "rgba(255,255,255,0.15)",
                    }
              }
            >
              <span
                className={`absolute top-0.5 rounded-full bg-white shadow transition-all ${
                  notifications.enabled ? "left-[24px]" : "left-0.5"
                }`}
                style={{ width: 18, height: 18 }}
              />
            </button>
          </div>
          {notifications.permission === "denied" ? (
            <p className="mt-1.5 font-sans text-xs text-amber-300/90">
              Enable notifications in your browser settings.
            </p>
          ) : !notifications.supported ? (
            <p className="mt-1.5 font-sans text-xs text-white/45">
              This browser does not support notifications.
            </p>
          ) : null}
        </section>

        {/* Wallet */}
        <section>
          <p className={SECTION_CLASS}>Wallet</p>
          {player.publicKey ? (
            <div className="mt-2 space-y-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2.5">
                <p className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-white/90">
                  {truncatePublicKey(address, { head: 8, tail: 8 })}
                </p>
                <button
                  type="button"
                  onClick={() => void handleCopyAddress()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.15] bg-white/[0.08] px-2.5 py-1.5 font-sans text-xs font-semibold text-white/80"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="flex gap-2">
                <span className="flex flex-1 items-center justify-center rounded-full border border-white/[0.08] bg-black/40 px-2 py-1.5 font-mono text-[11px] font-bold text-white">
                  DEVNET
                </span>
                <span className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2 py-1.5 font-mono text-[11px] font-bold tabular-nums text-white">
                  {player.balanceLamports === null
                    ? "—"
                    : formatSolBalance(player.balanceLamports)}
                  <SolMark size={10} />
                </span>
                <span className="flex flex-1 items-center justify-center rounded-full border border-white/[0.08] bg-black/40 px-2 py-1.5 font-mono text-[11px] font-bold text-white">
                  {sessionLabel(
                    player.sessionStatus,
                    player.session?.validUntil,
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={walletBusy || player.balanceLoading}
                  onClick={() =>
                    void runWalletAction(
                      player.refreshBalance,
                      "Balances refreshed.",
                    )
                  }
                  className={KEY_CLASS}
                  style={keyStyle}
                >
                  {player.balanceLoading ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  disabled={walletBusy}
                  onClick={() =>
                    void runWalletAction(
                      player.sessionStatus === "missing"
                        ? player.enable
                        : player.renew,
                      "zKube device session enabled.",
                    )
                  }
                  className={KEY_CLASS}
                  style={keyStyle}
                >
                  {player.sessionStatus === "missing" ||
                  player.sessionStatus === "checking"
                    ? "Enable zKube"
                    : "Renew session"}
                </button>
              </div>

              <a
                href="https://faucet.solana.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 font-sans text-xs font-bold text-white/80"
              >
                Devnet funding guidance <ExternalLink size={13} />
              </a>

              <button
                type="button"
                disabled={walletBusy}
                onClick={() =>
                  void runWalletAction(player.disconnect, "Wallet disconnected.")
                }
                className="w-full rounded-xl border border-red-400/40 bg-red-500/10 py-2.5 font-sans text-sm font-bold text-red-300 disabled:opacity-40"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="mt-2">
              <ConnectCta accentOverride={MONEY_GOLD} />
            </div>
          )}

          {(walletStatus || player.error) && (
            <p
              role="status"
              className="mt-2.5 break-words text-center font-sans text-xs text-white/70"
            >
              {walletStatus || player.error}
            </p>
          )}
        </section>
      </div>
    </Sheet>
  );
};

export default SettingsSheet;
