import { initializeStorage } from "@/platform/storage";

await initializeStorage();
await import("@/backend/solana/main");
