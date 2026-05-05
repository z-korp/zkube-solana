/**
 * WeeklyTab — Placeholder (Dojo/Starknet rewards non disponibles sur Solana)
 * Ce composant sera remplacé quand le système de rewards Solana sera prêt.
 */
import { Trophy } from "lucide-react";

const WeeklyTab: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <Trophy size={40} className="text-white/20" />
      <p className="font-sans text-sm font-semibold text-white/40">
        Weekly rewards coming soon
      </p>
    </div>
  );
};

export default WeeklyTab;
