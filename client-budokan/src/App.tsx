import { Toaster } from "./ui/elements/sonner";
import { TooltipProvider } from "@/ui/elements/tooltip";
import PageNavigator from "@/ui/navigation/PageNavigator";
import { useNavigationStore } from "@/stores/navigationStore";
import type { PageId } from "@/stores/navigationStore";
import { getToastPlacement } from "@/utils/toast";
import SpectatorScreen from "@/ui/pages/SpectatorScreen";
import SolanaPlayScreen from "@/ui/pages/SolanaPlayScreen";
import MapPage from "@/ui/pages/MapPage";
import SettingsPage from "@/ui/pages/SettingsPage";
import RewardsPage from "@/ui/pages/RewardsPage";
import LeaderboardPage from "@/ui/pages/LeaderboardPage";
import ProfilePage from "@/ui/pages/ProfilePage";
import DailyChallengePage from "@/ui/pages/DailyChallengePage";
import BossRevealPage from "@/ui/pages/BossRevealPage";
import TournamentPage from "@/ui/pages/TournamentPage";
import HomePage from "@/ui/pages/HomePage";

const pageComponents: Partial<Record<PageId, React.ReactNode>> = {
  home: <HomePage />,
  play: <SolanaPlayScreen />,
  solana: <SolanaPlayScreen />,
  map: <MapPage />,
  ranks: <LeaderboardPage />,
  settings: <SettingsPage />,
  rewards: <RewardsPage />,
  profile: <ProfilePage />,
  daily: <DailyChallengePage />,
  boss: <BossRevealPage />,
  tournament: <TournamentPage />,
};

// Spectator mode: ?pda=<gameStatePda> → show bot game read-only, no wallet needed
const SPECTATOR_PDA = new URLSearchParams(window.location.search).get("pda");

export default function App() {
  const currentPage = useNavigationStore((s) => s.currentPage);

  if (SPECTATOR_PDA) {
    return (
      <TooltipProvider>
        <div className="h-screen w-screen overflow-hidden">
          <SpectatorScreen pda={SPECTATOR_PDA} />
        </div>
        <Toaster position={getToastPlacement()} />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <PageNavigator>
        {pageComponents[currentPage] ?? pageComponents.home}
      </PageNavigator>
      <Toaster position={getToastPlacement()} />
    </TooltipProvider>
  );
}
