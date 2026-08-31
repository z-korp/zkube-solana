import type { PageId } from "@/stores/navigationStore";
import SettingsSheet from "@/ui/components/settings/SettingsSheet";
import ArcadePage from "@/ui/pages/ArcadePage";
import MapPage from "@/ui/pages/MapPage";
import PlayScreen from "@/ui/pages/PlayScreen";
import ProfilePage from "@/ui/pages/ProfilePage";
import SpectatorScreen from "@/ui/pages/SpectatorScreen";
import ConnectScreen from "@/ui/screens/ConnectScreen";

export function PageSurface({ currentPage }: { currentPage: PageId }) {
  switch (currentPage) {
    case "arcade":
      return <ArcadePage />;
    case "profile":
      return <ProfilePage />;
    case "play":
      return <PlayScreen />;
    case "map":
      return <MapPage />;
    case "spectate":
      return <SpectatorScreen />;
  }
}

export function SettingsSurface() {
  return <SettingsSheet />;
}

export function DisconnectedSurface({ revealDone }: { revealDone?: boolean }) {
  return <ConnectScreen revealDone={revealDone} />;
}
