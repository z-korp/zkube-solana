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
import QuestsPage from "@/ui/pages/QuestsPage";
import SettingsPage from "@/ui/pages/SettingsPage";
import SpectatorScreen from "@/ui/pages/SpectatorScreen";
import { getToastPlacement } from "@/utils/toast";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { usePlayerStateSync } from "@/chain/usePlayerStateSync";
import ConnectScreen from "@/ui/screens/ConnectScreen";

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

const pageComponents: Record<PageId, ReactNode> = {
  arcade: <HomePage />,
  campaign: <CampaignPage />,
  quests: <QuestsPage />,
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
  // Hold first paint behind the themed Loading screen until the initial
  // campaign snapshot resolves (which decides the resume theme, so the app
  // opens on the correct background). Spectator/recovery deep-links don't
  // depend on the local campaign; never gate them. A timeout is a safety net.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (
    player.connectionStatus !== "connected" ||
    !player.publicKey ||
    player.sessionStatus !== "ready"
  ) {
    return <ConnectScreen />;
  }
  const gated = currentPage !== "spectate" && currentPage !== "play";
  const ready = campaign !== null || error !== null || loaded || timedOut;
  if (gated && !ready) return <Loading />;

  return (
    <TooltipProvider>
      <PageNavigator>{pageComponents[currentPage]}</PageNavigator>
      <Toaster position={getToastPlacement()} />
    </TooltipProvider>
  );
}
