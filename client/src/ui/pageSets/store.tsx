import type { PageId } from "@/stores/navigationStore";
import LocalNameGate from "@/backend/local/LocalNameGate";
import StoreSettingsSheet from "@/ui/components/settings/StoreSettingsSheet";
import MapPage from "@/ui/pages/MapPage";
import PlayScreen from "@/ui/pages/PlayScreen";
import StoreArcadePage from "@/ui/pages/store/StoreArcadePage";
import StoreProfilePage from "@/ui/pages/store/StoreProfilePage";
import Loading from "@/ui/screens/Loading";

export function PageSurface({ currentPage }: { currentPage: PageId }) {
  switch (currentPage) {
    case "arcade":
      return <StoreArcadePage />;
    case "profile":
      return <StoreProfilePage />;
    case "play":
      return <PlayScreen />;
    case "map":
      return <MapPage />;
    case "spectate":
      return <Loading />;
  }
}

export function SettingsSurface() {
  return <StoreSettingsSheet />;
}

export function DisconnectedSurface() {
  return <LocalNameGate />;
}
