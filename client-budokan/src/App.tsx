import { Toaster } from "./ui/elements/sonner";
import { TooltipProvider } from "@/ui/elements/tooltip";
import PageNavigator from "@/ui/navigation/PageNavigator";
import { useNavigationStore } from "@/stores/navigationStore";
import type { PageId } from "@/stores/navigationStore";
import { getToastPlacement } from "@/utils/toast";
import SpectatorScreen from "@/ui/pages/SpectatorScreen";
import SpectatorTournamentScreen from "@/ui/pages/SpectatorTournamentScreen";
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

// Spectator modes (no wallet needed, read-only)
const _params = new URLSearchParams(window.location.search);
const SPECTATOR_PDA    = _params.get("pda");
const TOURNAMENT_ID    = _params.get("tournament");
const BOT_PDA          = _params.get("botpda");

export default function App() {
  const currentPage = useNavigationStore((s) => s.currentPage);

  // ?tournament=<id>[&botpda=<pda>] → tournament spectator view
  if (TOURNAMENT_ID) {
    return (
      <TooltipProvider>
        <SpectatorTournamentScreen
          tournamentId={Number(TOURNAMENT_ID)}
          botPda={BOT_PDA}
        />
        <Toaster position={getToastPlacement()} />
      </TooltipProvider>
    );
  }

  // ?pda=<gameStatePda> → single game spectator view
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
