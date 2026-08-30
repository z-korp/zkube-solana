import { useEffect, useState, type ReactNode } from "react";

import { useCampaign, useConnectedPlayer } from "@/backend/client";
import PlaytestNameGate from "@/backend/local/PlaytestNameGate";
import { PLAYTEST_ACTIVE } from "@/backend/local/playtest";
import { useNavigationStore, type PageId } from "@/stores/navigationStore";
import { TooltipProvider } from "@/ui/elements/tooltip";
import { Toaster } from "@/ui/elements/sonner";
import Loading from "@/ui/screens/Loading";
import PageNavigator from "@/ui/navigation/PageNavigator";
import ArcadePage from "@/ui/pages/ArcadePage";
import MapPage from "@/ui/pages/MapPage";
import PlayScreen from "@/ui/pages/PlayScreen";
import ProfilePage from "@/ui/pages/ProfilePage";
import SettingsSheet from "@/ui/components/settings/SettingsSheet";
import SpectatorScreen from "@/ui/pages/SpectatorScreen";
import { getToastPlacement } from "@/utils/toast";
import BootReveal from "@/ui/components/shared/BootReveal";
import ConnectScreen from "@/ui/screens/ConnectScreen";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";

const params = new URLSearchParams(window.location.search);
if (import.meta.env.DEV) {
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
}

// DEV-only: `?page=<id>` deep-links a menu screen for local screenshots.
// Guarded by DEV_BYPASS_ACTIVE (import.meta.env.DEV) — dead-code-eliminated in prod.
if (DEV_BYPASS_ACTIVE) {
  const devPage = params.get("page");
  const devPages = ["arcade", "profile", "map", "play"];
  if (devPage && devPages.includes(devPage)) {
    useNavigationStore.setState({ currentPage: devPage as PageId });
  }
}

const pageComponents: Record<PageId, ReactNode> = {
  arcade: <ArcadePage />,
  profile: <ProfilePage />,
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
  const playerReady =
    player.connectionStatus === "connected" &&
    !!player.publicKey &&
    player.sessionStatus === "ready";

  useEffect(() => {
    if (
      PLAYTEST_ACTIVE &&
      player.connectionStatus === "connected" &&
      player.sessionStatus !== "ready"
    ) {
      void player.enable();
    }
  }, [player]);

  if (PLAYTEST_ACTIVE) {
    return playerReady ? (
      <ClientSurface currentPage={currentPage} />
    ) : (
      <PlaytestNameGate />
    );
  }
  // DEV-ONLY: skip the connect gate and render the populated menus from fixture
  // providers. `import.meta.env.DEV` is a literal `false` in production, so this
  // branch (and everything it imports under src/dev/) is dead-code-eliminated.
  if (import.meta.env.DEV && DEV_BYPASS_ACTIVE) {
    return (
      <LocalBackendBootstrap>
        <ClientSurface currentPage={currentPage} />
      </LocalBackendBootstrap>
    );
  }
  // Whether this player lands in the app rather than on the connect screen.
  // The reveal reads it live: the silent reconnect it covers may resolve while
  // the animation is still running.
  const reveal = bootRevealGone ? null : (
    <BootReveal
      onSettled={() => setBootRevealDone(true)}
      onFinished={() => setBootRevealGone(true)}
    />
  );
  if (!playerReady) {
    return (
      <>
        <ConnectScreen revealDone={bootRevealDone} />
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

  return <ClientSurface currentPage={currentPage} overlay={reveal} />;
}

function ClientSurface({
  currentPage,
  overlay = null,
}: {
  currentPage: PageId;
  overlay?: ReactNode;
}) {
  return (
    <TooltipProvider>
      <PageNavigator>{pageComponents[currentPage]}</PageNavigator>
      <SettingsSheet />
      <Toaster position={getToastPlacement()} />
      {overlay}
    </TooltipProvider>
  );
}

/** Connects the development bypass; runs still start through the real menus. */
function LocalBackendBootstrap({ children }: { children: ReactNode }) {
  const player = useConnectedPlayer();

  useEffect(() => {
    if (player.connectionStatus === "disconnected") {
      void player.connectAndEnable("local");
    } else if (
      player.connectionStatus === "connected" &&
      player.sessionStatus !== "ready"
    ) {
      void player.enable();
    }
  }, [player]);

  return children;
}
