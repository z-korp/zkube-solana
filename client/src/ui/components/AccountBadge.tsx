import { Gamepad2 } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useNavigationStore } from "@/stores/navigationStore";
import { Button } from "@/ui/elements/button";
import { truncatePublicKey } from "@/utils/solanaDisplay";

export default function AccountBadge({ className = "" }: { className?: string }) {
  const { publicKey } = useConnectedPlayer();
  const navigate = useNavigationStore((state) => state.navigate);
  const address = publicKey?.toBase58() ?? "";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => navigate("profile")}
      className={`gap-2 ${className}`}
      title={address ? `Open profile for ${address}` : "Open player profile"}
    >
      <Gamepad2 size={16} />
      <span>{address ? truncatePublicKey(address) : "Player"}</span>
    </Button>
  );
}
