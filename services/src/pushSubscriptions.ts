import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Web Push subscriptions, keyed by the wallet they belong to.
 *
 * **No proof of ownership is required to register one, and that is deliberate.**
 * A subscription only ever causes a push to the device that registered it, and
 * everything it could reveal — who placed where, and for how much — is already
 * public in the board account. Requiring an owner signature would buy no
 * privacy and would cost a wallet approval at the exact moment a player has
 * just been told there is money waiting.
 *
 * What registration does need is abuse control, which is what the caps below
 * are: a bounded number of devices per wallet and a bounded store overall, so
 * an attacker cannot turn the keeper into an amplifier or fill its volume.
 */

/** Devices one wallet may be notified on. */
export const MAX_SUBSCRIPTIONS_PER_OWNER = 5;
/** Total subscriptions the store will hold before refusing new wallets. */
export const MAX_SUBSCRIPTIONS = 50_000;

export interface PushSubscriptionRecord {
  /** Base58 wallet this device wants prize notifications for. */
  owner: string;
  /** Push service URL issued by the browser; unique per device per site. */
  endpoint: string;
  /** Base64url P-256 public key for payload encryption (RFC 8291). */
  p256dh: string;
  /** Base64url auth secret for payload encryption (RFC 8291). */
  auth: string;
  addedAt: number;
}

interface StoredFile {
  schemaVersion: 1;
  subscriptions: PushSubscriptionRecord[];
}

const SCHEMA_VERSION = 1;
const FILE_NAME = "push-subscriptions.json";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Reject anything that is not a plausible browser push registration. */
export function validateSubscription(
  value: unknown,
): PushSubscriptionRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const owner = record.owner;
  const endpoint = record.endpoint;
  const keys = record.keys as Record<string, unknown> | undefined;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (
    typeof owner !== "string" ||
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    !BASE58.test(owner) ||
    endpoint.length > 1_024 ||
    p256dh.length > 256 ||
    auth.length > 64 ||
    !BASE64URL.test(p256dh) ||
    !BASE64URL.test(auth)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  // Push services are always public HTTPS. This also refuses an endpoint
  // pointed back at the keeper's own network.
  if (url.protocol !== "https:") return null;
  return { owner, endpoint, p256dh, auth, addedAt: Date.now() };
}

/**
 * Durable subscription store on the keeper's volume.
 *
 * Same durability class as the archive: a Devnet recovery aid rather than the
 * Mainnet design. Losing it costs notifications, never money — a reward stays
 * claimable in the app whether or not anyone was told about it.
 */
export class PushSubscriptionStore {
  private cache: PushSubscriptionRecord[] | null = null;

  constructor(private readonly root: string) {}

  async all(): Promise<PushSubscriptionRecord[]> {
    if (this.cache) return this.cache;
    const path = await this.path();
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as StoredFile;
      if (parsed?.schemaVersion !== SCHEMA_VERSION ||
          !Array.isArray(parsed.subscriptions)) {
        this.cache = [];
      } else {
        this.cache = parsed.subscriptions.filter(
          (record): record is PushSubscriptionRecord =>
            validateSubscription({
              owner: record?.owner,
              endpoint: record?.endpoint,
              keys: { p256dh: record?.p256dh, auth: record?.auth },
            }) !== null,
        );
      }
    } catch {
      // A missing or corrupt file is an empty store, never a fatal error: the
      // keeper's real work must not stop because notifications cannot be read.
      this.cache = [];
    }
    return this.cache;
  }

  async forOwners(owners: readonly string[]): Promise<PushSubscriptionRecord[]> {
    const wanted = new Set(owners);
    return (await this.all()).filter((record) => wanted.has(record.owner));
  }

  /** Register a device, replacing any earlier record for the same endpoint. */
  async add(record: PushSubscriptionRecord): Promise<"added" | "full"> {
    const existing = await this.all();
    const others = existing.filter((item) => item.endpoint !== record.endpoint);
    const mine = others.filter((item) => item.owner === record.owner);
    if (others.length >= MAX_SUBSCRIPTIONS && mine.length === 0) return "full";
    // Oldest device drops off rather than refusing the newest one, so a player
    // who reinstalls is never the one locked out.
    const kept = mine.length >= MAX_SUBSCRIPTIONS_PER_OWNER
      ? others.filter(
          (item) =>
            item.owner !== record.owner ||
            item.addedAt > mine[0]!.addedAt,
        )
      : others;
    await this.write([...kept, record]);
    return "added";
  }

  async removeEndpoints(endpoints: readonly string[]): Promise<number> {
    if (endpoints.length === 0) return 0;
    const drop = new Set(endpoints);
    const existing = await this.all();
    const kept = existing.filter((record) => !drop.has(record.endpoint));
    if (kept.length === existing.length) return 0;
    await this.write(kept);
    return existing.length - kept.length;
  }

  private async write(records: PushSubscriptionRecord[]): Promise<void> {
    const sorted = [...records].sort((left, right) =>
      left.addedAt - right.addedAt || left.endpoint.localeCompare(right.endpoint)
    );
    const path = await this.path();
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify(
          { schemaVersion: SCHEMA_VERSION, subscriptions: sorted } satisfies StoredFile,
        ),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Rename is the right primitive here, unlike the archive: this file is
    // mutable state, not an append-only commitment.
    await rename(temporary, path);
    this.cache = sorted;
  }

  private async path(): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const resolved = await realpath(this.root);
    const target = join(resolved, FILE_NAME);
    if (dirname(target) !== resolved) {
      throw new Error("push subscription path escaped its root");
    }
    return target;
  }
}
