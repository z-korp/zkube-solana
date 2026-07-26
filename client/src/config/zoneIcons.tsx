import {
  Anvil,
  Bird,
  Castle,
  Landmark,
  Mountain,
  Palmtree,
  Pyramid,
  Shell,
  Snowflake,
  Sun,
  type LucideIcon,
} from "lucide-react";

const ZONE_ICONS: Readonly<Record<number, LucideIcon>> = {
  1: Shell,
  2: Pyramid,
  3: Snowflake,
  4: Landmark,
  5: Anvil,
  6: Castle,
  7: Sun,
  8: Palmtree,
  9: Bird,
  10: Mountain,
};

export function ZoneIcon({
  zoneId,
  className,
}: {
  zoneId: number;
  className?: string;
}) {
  const Icon = ZONE_ICONS[zoneId] ?? Mountain;
  return <Icon className={className} aria-hidden />;
}
