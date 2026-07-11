import { Toaster } from "./ui/elements/sonner";
import { TooltipProvider } from "@/ui/elements/tooltip";
import PageNavigator from "@/ui/navigation/PageNavigator";
import { useNavigationStore } from "@/stores/navigationStore";
import type { PageId } from "@/stores/navigationStore";
import RebootPlayScreen from "@/ui/pages/RebootPlayScreen";
import RebootDailyChallengePage from "@/ui/pages/RebootDailyChallengePage";
import RebootHomePage from "@/ui/pages/RebootHomePage";
import RebootInfoPage from "@/ui/pages/RebootInfoPage";
import RebootMapPage from "@/ui/pages/RebootMapPage";
import RebootProfilePage from "@/ui/pages/RebootProfilePage";
import RebootRewardsPage from "@/ui/pages/RebootRewardsPage";
import RebootLeaderboardPage from "@/ui/pages/RebootLeaderboardPage";
import RebootBossRevealPage from "@/ui/pages/RebootBossRevealPage";
import RebootSpectatorScreen from "@/ui/pages/RebootSpectatorScreen";

// URL hydration: /?player=<pubkey> or /?pda=<activeRun pda> (+ optional
// &run=<id>) opens the read-only spectator directly.
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
}

const pageComponents: Partial<Record<PageId, React.ReactNode>> = {
  home: <RebootHomePage />,
  play: <RebootPlayScreen />,
  solana: <RebootPlayScreen />,
  map: <RebootMapPage />,
  ranks: <RebootLeaderboardPage />,
  settings: <RebootInfoPage page="settings" />,
  rewards: <RebootRewardsPage />,
  profile: <RebootProfilePage />,
  daily: <RebootDailyChallengePage />,
  boss: <RebootBossRevealPage />,
  tournament: <RebootDailyChallengePage />,
  spectate: <RebootSpectatorScreen />,
};

export default function App() {
  const currentPage = useNavigationStore((s) => s.currentPage);

  return (
    <TooltipProvider>
      <PageNavigator>
        {pageComponents[currentPage] ?? pageComponents.home}
      </PageNavigator>
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}
