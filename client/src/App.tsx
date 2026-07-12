import type { ReactNode } from "react";

import { useNavigationStore, type PageId } from "@/stores/navigationStore";
import { TooltipProvider } from "@/ui/elements/tooltip";
import { Toaster } from "@/ui/elements/sonner";
import PageNavigator from "@/ui/navigation/PageNavigator";
import BossRevealPage from "@/ui/pages/BossRevealPage";
import DailyChallengePage from "@/ui/pages/DailyChallengePage";
import HomePage from "@/ui/pages/HomePage";
import LeaderboardPage from "@/ui/pages/LeaderboardPage";
import MapPage from "@/ui/pages/MapPage";
import PlayScreen from "@/ui/pages/PlayScreen";
import ProfilePage from "@/ui/pages/ProfilePage";
import RewardsPage from "@/ui/pages/RewardsPage";
import SettingsPage from "@/ui/pages/SettingsPage";
import SpectatorScreen from "@/ui/pages/SpectatorScreen";
import { getToastPlacement } from "@/utils/toast";

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
      pendingPreviewLevel: null,
      pendingLevelCompletion: null,
    });
  }
}

const pageComponents: Record<PageId, ReactNode> = {
  home: <HomePage />,
  rewards: <RewardsPage />,
  profile: <ProfilePage />,
  ranks: <LeaderboardPage />,
  settings: <SettingsPage />,
  play: <PlayScreen />,
  daily: <DailyChallengePage />,
  boss: <BossRevealPage />,
  map: <MapPage />,
  spectate: <SpectatorScreen />,
};

export default function App() {
  const currentPage = useNavigationStore((state) => state.currentPage);

  return (
    <TooltipProvider>
      <PageNavigator>{pageComponents[currentPage]}</PageNavigator>
      <Toaster position={getToastPlacement()} />
    </TooltipProvider>
  );
}
