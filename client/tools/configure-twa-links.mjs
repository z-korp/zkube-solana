import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fingerprint = process.env.TWA_SHA256_CERT_FINGERPRINT?.trim();
if (!fingerprint || !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(fingerprint)) {
  throw new Error("TWA_SHA256_CERT_FINGERPRINT must be a 32-byte colon-separated SHA-256 fingerprint");
}
const template = readFileSync(resolve(root, "twa/assetlinks.template.json"), "utf8");
const destination = resolve(root, "public/.well-known/assetlinks.json");
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(
  destination,
  `${template.replace("{{TWA_SHA256_CERT_FINGERPRINT}}", fingerprint.toUpperCase()).trim()}\n`,
  { mode: 0o644 },
);
console.log("Configured Digital Asset Links for com.zkorp.zkube");
