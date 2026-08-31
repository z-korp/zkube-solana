import { useNavigationStore } from "@/stores/navigationStore";
import AudioSettingsControls from "@/ui/components/settings/AudioSettingsControls";
import Sheet from "@/ui/components/shared/Sheet";

export default function StoreSettingsSheet() {
  const open = useNavigationStore((state) => state.settingsOpen);
  const close = useNavigationStore((state) => state.closeSettings);
  return (
    <Sheet open={open} onClose={close} title="Settings">
      <div className="pb-2">
        <AudioSettingsControls />
      </div>
    </Sheet>
  );
}
