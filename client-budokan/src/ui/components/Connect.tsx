// Migration Solana — Connect délègue au bouton Phantom
import PhantomConnectButton from "@/ui/components/PhantomConnectButton";

// ctaLabel / pendingLabel sont conservés pour la compatibilité des props existants
// mais PhantomConnectButton gère son propre libellé.
const Connect = (_props?: { ctaLabel?: string; pendingLabel?: string }) => {
  return <PhantomConnectButton />;
};

export default Connect;
