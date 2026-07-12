// Compat shim: single source of truth for bonus enums lives in the Solana
// reboot module; the original UI imports them from this path.
export { BonusType } from "@/solana/reboot/bonusTypes";
export { getBonusType } from "@/config/mutatorConfig";
