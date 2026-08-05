import { useEffect, useState, type ReactNode } from "react";

import { useCampaign } from "@/contexts/campaign";
import { useNavigationStore, type PageId } from "@/stores/navigationStore";
import { TooltipProvider } from "@/ui/elements/tooltip";
import { Toaster } from "@/ui/elements/sonner";
import Loading from "@/ui/screens/Loading";
import PageNavigator from "@/ui/navigation/PageNavigator";
import HomePage from "@/ui/pages/HomePage";
import CampaignPage from "@/ui/pages/CampaignPage";
import ArenaPage from "@/ui/pages/ArenaPage";
import MapPage from "@/ui/pages/MapPage";
import PlayScreen from "@/ui/pages/PlayScreen";
import ProfilePage from "@/ui/pages/ProfilePage";
import SettingsPage from "@/ui/pages/SettingsPage";
import SpectatorScreen from "@/ui/pages/SpectatorScreen";
import { getToastPlacement } from "@/utils/toast";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { usePlayerStateSync } from "@/chain/usePlayerStateSync";
import { useNotifications } from "@/hooks/useNotifications";
import BootReveal from "@/ui/components/shared/BootReveal";
import ConnectScreen from "@/ui/screens/ConnectScreen";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { DevFixturesProvider } from "@/dev/DevFixturesProvider";
import { CapabilityDiagnostics } from "@/dev/CapabilityDiagnostics";

const params = new URLSearchParams(window.location.search);
const spectatePlayer = params.get("player");
const spectatePda = params.get("pda");
if (spectatePlayer || spectatePda) {
  useNavigationStore.setState({
    currentPage: "spectate",
    spectateTarget: {
      player: spectatePlayer ?? undefined,
      pda: spectatePda ?? undefined,
      runId: params.get("run") ?? undefined,
    },
  });
} else {
  const recoverRun = params.get("recover");
  if (recoverRun && /^[1-9]\d*$/.test(recoverRun)) {
    useNavigationStore.setState({
      currentPage: "play",
      gameId: null,
      recoveryRunId: BigInt(recoverRun),
      pendingLevelCompletion: null,
    });
  }
}

// DEV-only: `?page=<id>` deep-links a menu screen for local screenshots.
// Guarded by DEV_BYPASS_ACTIVE (import.meta.env.DEV) — dead-code-eliminated in prod.
if (DEV_BYPASS_ACTIVE) {
  const devPage = params.get("page");
  const devPages = ["arcade", "campaign", "ranks", "profile", "settings"];
  if (devPage && devPages.includes(devPage)) {
    useNavigationStore.setState({ currentPage: devPage as PageId });
  }
}

const pageComponents: Record<PageId, ReactNode> = {
  arcade: <HomePage />,
  campaign: <CampaignPage />,
  profile: <ProfilePage />,
  ranks: <ArenaPage />,
  settings: <SettingsPage />,
  play: <PlayScreen />,
  map: <MapPage />,
  spectate: <SpectatorScreen />,
};

export default function App() {
  const player = useConnectedPlayer();
  const currentPage = useNavigationStore((state) => state.currentPage);
  const { campaign, error, loaded } = useCampaign();
  // One PlayerState watch keeps Arcade progression and Campaign completion in
  // agreement without mixing their presentation surfaces.
  usePlayerStateSync();
  // Mount the opt-in notification observers once at the app root so "you won"
  // and "new Daily is open" alerts fire across the whole in-session lifetime,
  // not only while Settings is open. Fully inert until the player opts in
  // (Settings toggle) and the browser grants permission; local/in-session only.
  // Safe to also mount on Settings — each fire persists its baseline before
  // notifying and carries an OS-level dedupe tag.
  useNotifications();
  // Hold first paint behind the themed Loading screen until the initial
  // campaign snapshot resolves (which decides the resume theme, so the app
  // opens on the correct background). Spectator/recovery deep-links don't
  // depend on the local campaign; never gate them. A timeout is a safety net.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  // Every cold start opens on the boot reveal, which doubles as the mask for
  // the silent reconnect and the first chain reads. It plays as an overlay
  // above whatever mounts underneath, so when the icon detonates a connected
  // player is already looking at the app and a disconnected one at the connect
  // screen — the confetti carries over both. Held here so a later mid-session
  // disconnect never replays the ceremony.
  const [bootRevealDone, setBootRevealDone] = useState(false);
  // The overlay outlives its own hand-over: the world keeps lifting and debris
  // keeps falling after the connect action appears, so it is torn down only
  // once every particle has cleared.
  const [bootRevealGone, setBootRevealGone] = useState(false);
  // DEV-ONLY: skip the connect gate and render the populated menus from fixture
  // providers. `import.meta.env.DEV` is a literal `false` in production, so this
  // branch (and everything it imports under src/dev/) is dead-code-eliminated.
  if (import.meta.env.DEV && DEV_BYPASS_ACTIVE) {
    return (
      <DevFixturesProvider>
        <TooltipProvider>
          <PageNavigator>{pageComponents[currentPage]}</PageNavigator>
          <CapabilityDiagnostics />
          <Toaster position={getToastPlacement()} />
        </TooltipProvider>
      </DevFixturesProvider>
    );
  }
  const reveal = bootRevealGone ? null : (
    <BootReveal
      onSettled={() => setBootRevealDone(true)}
      onFinished={() => setBootRevealGone(true)}
    />
  );
  if (
    player.connectionStatus !== "connected" ||
    !player.publicKey ||
    player.sessionStatus !== "ready"
  ) {
    return (
      <>
        <ConnectScreen revealDone={bootRevealDone} ownsTitle={bootRevealGone} />
        {reveal}
      </>
    );
  }
  const gated = currentPage !== "spectate" && currentPage !== "play";
  const ready = campaign !== null || error !== null || loaded || timedOut;
  if (gated && !ready) {
    return (
      <>
        <Loading />
        {reveal}
      </>
    );
  }

  return (
    <TooltipProvider>
      <PageNavigator>{pageComponents[currentPage]}</PageNavigator>
      <Toaster position={getToastPlacement()} />
      {reveal}
    </TooltipProvider>
  );
}
