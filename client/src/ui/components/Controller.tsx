import { Gamepad2 } from "lucide-react";

import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useNavigationStore } from "@/stores/navigationStore";
import { Button } from "@/ui/elements/button";
import { truncatePublicKey } from "@/utils/solanaDisplay";

export default function Controller({ className = "" }: { className?: string }) {
  const { publicKey } = useEmbeddedIdentity();
  const navigate = useNavigationStore((state) => state.navigate);
  const address = publicKey.toBase58();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => navigate("profile")}
      className={`gap-2 ${className}`}
      title={`Open profile for ${address}`}
    >
      <Gamepad2 size={16} />
      <span>{truncatePublicKey(address)}</span>
    </Button>
  );
}
