import type { ReactNode } from "react";

import "@/hooks";
import { useNavigationStore, type PageId } from "@/stores/navigationStore";
import { TooltipProvider } from "@/ui/elements/tooltip";
import { Toaster } from "@/ui/elements/sonner";
import PageNavigator from "@/ui/navigation/PageNavigator";
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
}

function PortPlaceholder({ title }: { title: string }) {
  return (
    <main className="flex h-full min-h-0 items-center justify-center px-6 pb-24 text-center text-white">
      <div>
        <h1 className="font-display text-3xl">{title}</h1>
        <p className="mt-2 font-sans text-sm text-white/60">
          Original zKube screen port in progress
        </p>
      </div>
    </main>
  );
}

const pageComponents: Record<PageId, ReactNode> = {
  home: <PortPlaceholder title="Home" />,
  rewards: <PortPlaceholder title="Rewards" />,
  profile: <PortPlaceholder title="Profile" />,
  ranks: <PortPlaceholder title="Leaderboard" />,
  settings: <PortPlaceholder title="Settings" />,
  play: <PortPlaceholder title="Play" />,
  daily: <PortPlaceholder title="Daily Challenge" />,
  boss: <PortPlaceholder title="Guardian" />,
  map: <PortPlaceholder title="Map" />,
  spectate: <PortPlaceholder title="Spectate" />,
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
