import { createHash, verify } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey, SystemProgram, Transaction, VersionedTransaction, type Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { accountCoder, assertDevnetRelease, devnetConnection, programDataAddress, UPGRADEABLE_LOADER } from "./chainRelease.js";
import { checkRelease, parseDeposit, parseOperatorArgs, runOperator } from "./cli.js";
import { deploymentRelease, deploymentTransactions, upgradeRelease, upgradeTransactions, type DeploymentInput, type UpgradeInput } from "./deploymentPlan.js";
import { quoteBundle, readBundle, type OperatorBundle } from "./operatorPlan.js";
import { executeBundle } from "./operatorRuntime.js";
import { assertUpgradeRelease, checkFreshTransaction, checkLaunchWindow, observeDeposits, LANDING_SECONDS } from "./operatorState.js";
import { deriveProtocolConfigPda } from "./pdas.js";
import { executeTransaction, fingerprint, loadPinnedKeypair, publicTransaction, type TransactionReceipt } from "./operatorTransaction.js";
import { dailyWindow } from "../../services/src/zkubeCore.js";
// The instant a day opens; the core owns the boundary (07:00 UTC).
const opens = (day: number) => dailyWindow(day).opensAt;

vi.mock("node:crypto", async original => ({ ...await original<typeof import("node:crypto")>(), verify: vi.fn(() => true) }));
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
vi.mock("./chainRelease.js", async original => ({ ...await original<typeof import("./chainRelease.js")>(), devnetConnection: vi.fn() }));
const fixture = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8"));
const payer = new PublicKey(fixture.deployment.payer);
const blockhash = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const scratch = fileURLToPath(new URL("../../build/operator-tests", import.meta.url));
afterEach(() => { vi.restoreAllMocks(); rmSync(scratch, { recursive: true, force: true }); });

function io() {
  const order: string[] = [];
  let saved: TransactionReceipt | undefined;
  const persist = vi.fn((receipt: TransactionReceipt) => { saved = structuredClone(receipt); order.push(receipt.state); });
  const loadSigner = vi.fn((key: string) => ({ publicKey: new PublicKey(key), secretKey: new Uint8Array(64) }) as Keypair);
  vi.spyOn(VersionedTransaction.prototype, "sign").mockImplementation(function (this: VersionedTransaction) {
    order.push("sign"); this.signatures = this.signatures.map(() => new Uint8Array(64).fill(3));
  });
  const calls = {
    getLatestBlockhash: vi.fn(async () => ({ blockhash, lastValidBlockHeight: 10 })),
    getFeeForMessage: vi.fn(async () => ({ context: { slot: 1 }, value: 5000 })),
    getBalance: vi.fn(async () => 10_000_000_000),
    simulateTransaction: vi.fn(async () => { order.push("simulate"); return { value: { err: null,
      accounts: [{ lamports: 9_999_995_000 }] } }; }),
    sendRawTransaction: vi.fn(async () => { order.push("send"); expect(saved?.state).toBe("pending"); return saved!.signature; }),
    confirmTransaction: vi.fn(async () => { order.push("confirm"); return { value: { err: null } }; }),
    getSignatureStatus: vi.fn(async () => ({ value: { err: null, confirmationStatus: "confirmed" } })),
    getSignatureStatuses: vi.fn(async (signatures: string[]) => ({ context: { slot: 1 },
      value: signatures.map(() => ({ err: null as unknown, confirmationStatus: "confirmed" })) })),
    isBlockhashValid: vi.fn(async () => ({ value: true })),
    getBlockHeight: vi.fn(async () => 20),
  };
  const plan = publicTransaction("Bounded transfer", payer, new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer, toPubkey: new PublicKey(fixture.deployment.buffer), lamports: 1 })),
  { maximumFeeLamports: 5000, maximumSpendLamports: 5001, reserveLamports: 100_000_000 });
  return { calls, connection: calls as unknown as Connection, plan, loadSigner, persist, order };
}

function releaseConnection() {
  const protocol = accountCoder.decode("protocolConfig", Buffer.from(fixture.plans.accounts.protocol.data, "base64"));
  const release = { rpc: "https://api.devnet.solana.com", allocationBytes: 32,
    programDataSha256: createHash("sha256").update(Buffer.alloc(32)).digest("hex"),
    upgradeAuthority: payer.toBase58() };
  const program = Buffer.alloc(36); program.writeUInt32LE(2); programDataAddress().toBuffer().copy(program, 4);
  const data = Buffer.alloc(77); data.writeUInt32LE(3); data[12] = 1; payer.toBuffer().copy(data, 13);
  const info = (bytes: Buffer, executable = false, owner = UPGRADEABLE_LOADER) =>
    ({ data: bytes, executable, owner, lamports: 10_000_000_000, rentEpoch: 0 });
  const calls = {
    getGenesisHash: vi.fn(async () => SOLANA_DEVNET_GENESIS_HASH),
    getMultipleAccountsInfo: vi.fn(async () => [info(program, true), info(data)]),
    getAccountInfo: vi.fn(async () => info(await accountCoder.encode("protocolConfig", protocol), false, ZKUBE_PROGRAM_ID)),
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })),
    getLatestBlockhash: vi.fn(async () => ({ blockhash, lastValidBlockHeight: 10 })),
    getBalance: vi.fn(async () => 10_000_000_000),
  };
  return { calls, connection: calls as unknown as Connection, release, protocol, info };
}

/**
 * A deployed program and the upgrade planned against it: ProgramData holds 2,048 bytes of an older
 * program, the artifact is the fixture's, and the protocol, the clock and today's Daily are the test's.
 */
function upgradeState() {
  const state = releaseConnection();
  const expected = fixture.deployment;
  mkdirSync(scratch, { recursive: true });
  const artifactPath = scratch + "/upgrade.so", artifact = Buffer.from(expected.artifact, "base64");
  writeFileSync(artifactPath, artifact);
  const older = Buffer.alloc(2048, 9);
  const input: UpgradeInput = { artifactPath, artifactBytes: artifact.length,
    artifactSha256: createHash("sha256").update(artifact).digest("hex"), payer: expected.payer, buffer: expected.buffer,
    authority: expected.authority, bufferRentLamports: expected.bufferRentLamports,
    deployed: { programDataSha256: createHash("sha256").update(older).digest("hex"), allocationBytes: older.length } };
  const release = upgradeRelease(input, "https://api.devnet.solana.com");
  const world = { held: older as Buffer, buffer: false, suspendedUntilDay: 0, now: opens(20740) + 3600,
    daily: undefined as Buffer | undefined, deployedSlot: 7, deployedAt: opens(20740) + 600 };
  const program = Buffer.alloc(36); program.writeUInt32LE(2); programDataAddress().toBuffer().copy(program, 4);
  const programData = () => {
    const header = Buffer.alloc(45); header.writeUInt32LE(3); header.writeBigUInt64LE(BigInt(world.deployedSlot), 4);
    header[12] = 1; new PublicKey(expected.authority).toBuffer().copy(header, 13);
    return state.info(Buffer.concat([header, world.held]));
  };
  const calls = { ...state.calls, getSlot: vi.fn(async () => 1),
    getBlockTime: vi.fn(async (slot: number) => slot === world.deployedSlot ? world.deployedAt : world.now),
    getMultipleAccountsInfo: vi.fn(async () => [state.info(program, true), programData()]),
    getAccountInfo: vi.fn(async (address: PublicKey) => {
      if (address.equals(programDataAddress())) return programData();
      if (address.toBase58() === expected.buffer) return world.buffer ? state.info(Buffer.alloc(37)) : null;
      if (address.equals(deriveProtocolConfigPda())) {
        return state.info(await accountCoder.encode("protocolConfig",
          { ...state.protocol, authority: payer, suspendedUntilDay: world.suspendedUntilDay }), false, ZKUBE_PROGRAM_ID);
      }
      return world.daily ? state.info(world.daily, false, ZKUBE_PROGRAM_ID) : null;
    }) };
  return { calls, connection: calls as unknown as Connection, input, release, world, artifact, state };
}

describe("one operator plan and execution pipeline", () => {
  it("operator_signer_read_errors_do_not_echo_file_contents", () => {
    vi.mocked(readFileSync).mockReturnValueOnce("invalid private input");
    expect(() => loadPinnedKeypair("unused", payer.toBase58())).toThrow("Unable to read the pinned signer file");
  });
  it("operator_plan_saves_one_public_bundle_without_loading_a_signer", async () => {
    const state = releaseConnection();
    state.protocol.authority = payer;
    const launchDayId = state.protocol.launchDayId;
    const launch = await quoteBundle({ kind: "set-suspension", authority: payer.toBase58(), launchDayId, untilDay: 110 }, state.release, state.connection);
    launch.payload.operation = { kind: "launch", input: { authority: payer.toBase58(), launchDayId } } as never;
    launch.fingerprint = fingerprint(launch.payload);
    mkdirSync(scratch, { recursive: true });
    const launchPath = scratch + "/launch.json", path = scratch + "/suspension.json";
    writeFileSync(launchPath, JSON.stringify(launch));
    vi.mocked(devnetConnection).mockReturnValueOnce(state.connection);
    const result = JSON.parse(await runOperator(["plan", "set-suspension", "--launch-bundle", launchPath,
      "--until-day", "21000", "--bundle", path], { SOLANA_DEVNET_RPC_URL: state.release.rpc, ZKUBE_SIGNER_PATHS: "invalid" }));
    const planned = readBundle(readFileSync(path, "utf8"));
    expect(result.fingerprint).toBe(planned.fingerprint);
    expect(planned.receipts).toEqual({});
    expect(planned.payload.transactions).toHaveLength(1);
    expect(Buffer.from(planned.payload.transactions[0]!.instructions[0]!.data, "base64").readUInt32LE(8)).toBe(21000);
    expect(state.calls.getGenesisHash).toHaveBeenCalledTimes(1);
  });
  it("operator_missing_fingerprint_loads_no_keypair", async () => {
    const state = releaseConnection();
    const bundle = await quoteBundle({ kind: "set-suspension", authority: payer.toBase58(), launchDayId: 100, untilDay: 110 }, state.release, state.connection);
    const connect = vi.fn(), loadSigner = vi.fn(), persist = vi.fn();
    for (const approval of [undefined, "0".repeat(64)]) {
      await expect(executeBundle(JSON.stringify(bundle), { approval, connect, loadSigner, persist })).rejects.toThrow("before loading any keypair");
    }
    expect(connect).not.toHaveBeenCalled(); expect(loadSigner).not.toHaveBeenCalled();
    mkdirSync(scratch, { recursive: true });
    const path = scratch + "/missing-approval.json"; writeFileSync(path, JSON.stringify(bundle));
    await expect(runOperator(["execute", "--bundle", path], { ZKUBE_SIGNER_PATHS: "invalid" })).rejects.toThrow("ZKUBE_APPROVAL");
  });

  it("operator_rebuild_rejects_changed_instruction_bytes_before_loading_a_signer", async () => {
    const state = releaseConnection();
    const bundle = await quoteBundle({ kind: "set-suspension", authority: payer.toBase58(), launchDayId: 100, untilDay: 110 }, state.release, state.connection);
    bundle.payload.transactions[0]!.instructions[0]!.data = Buffer.alloc(12).toString("base64");
    bundle.fingerprint = fingerprint(bundle.payload);
    const loadSigner = vi.fn();
    await expect(executeBundle(JSON.stringify(bundle), { approval: bundle.fingerprint,
      connect: () => state.connection, loadSigner, persist: vi.fn() })).rejects.toThrow("Rebuilt transaction differs");
    expect(loadSigner).not.toHaveBeenCalled(); expect(state.calls.getGenesisHash).not.toHaveBeenCalled();
  });

  it("operator_signed_simulation_and_durable_receipt_precede_relay", async () => {
    const test = io();
    await executeTransaction(test);
    expect(test.order).toEqual(["sign", "simulate", "pending", "send", "confirm", "confirmed"]);
    expect(test.calls.simulateTransaction).toHaveBeenCalledWith(expect.any(VersionedTransaction),
      expect.objectContaining({ sigVerify: true, accounts: { encoding: "base64", addresses: [payer.toBase58()] } }));
  });

  it("operator_receipts_resume_without_repeating_confirmed_transactions", async () => {
    const test = io(); const existing = await executeTransaction(test);
    test.loadSigner.mockClear(); test.calls.sendRawTransaction.mockClear(); test.calls.simulateTransaction.mockClear();
    const result = await executeTransaction({ ...test, existing });
    expect(result.state).toBe("confirmed");
    expect(test.loadSigner).not.toHaveBeenCalled(); expect(test.calls.sendRawTransaction).not.toHaveBeenCalled();
    expect(test.calls.simulateTransaction).not.toHaveBeenCalled();
    vi.mocked(verify).mockImplementationOnce(() => false);
    await expect(executeTransaction({ ...test, existing })).rejects.toThrow("Receipt differs");
  });

  it("operator_pending_receipts_relay_the_same_bytes_without_loading_a_signer", async () => {
    const test = io(); const existing = { ...await executeTransaction(test), state: "pending" as const };
    test.calls.getSignatureStatus.mockResolvedValue({ value: null } as never);
    test.loadSigner.mockClear(); test.persist(existing);
    await executeTransaction({ ...test, existing });
    expect(test.loadSigner).not.toHaveBeenCalled();
    expect(test.calls.sendRawTransaction).toHaveBeenLastCalledWith(Buffer.from(existing.raw, "base64"), expect.anything());
  });

  it("operator_fee_spend_reserve_and_simulation_failures_prevent_relay", async () => {
    const test = io();
    test.calls.getFeeForMessage.mockResolvedValueOnce({ context: { slot: 1 }, value: 5001 });
    await expect(executeTransaction(test)).rejects.toThrow("Fee or payer reserve");
    expect(test.loadSigner).not.toHaveBeenCalled();
    test.calls.getBalance.mockResolvedValueOnce(100_005_000);
    await expect(executeTransaction(test)).rejects.toThrow("Fee or payer reserve");
    test.calls.simulateTransaction.mockResolvedValueOnce({ value: { err: null, accounts: [{ lamports: 1 }] } });
    await expect(executeTransaction(test)).rejects.toThrow("Simulation failed");
    expect(test.calls.sendRawTransaction).not.toHaveBeenCalled(); expect(test.persist).not.toHaveBeenCalled();
  });

  it("operator_release_checks_devnet_and_programdata", async () => {
    const state = releaseConnection();
    await assertDevnetRelease(state.connection, state.release);
    expect(state.calls.getGenesisHash).toHaveBeenCalledTimes(1);
    await expect(assertDevnetRelease(state.connection, { ...state.release, programDataSha256: "0".repeat(64) })).rejects.toThrow("differs from the release");
    state.calls.getGenesisHash.mockResolvedValueOnce("other genesis");
    await expect(assertDevnetRelease(state.connection, state.release)).rejects.toThrow("Devnet genesis");
  });

  it("operator_until_is_an_inclusive_bounded_index_and_activation_requires_the_keeper", async () => {
    const state = releaseConnection();
    const bundle = await quoteBundle({ kind: "set-suspension", authority: payer.toBase58(), launchDayId: 100, untilDay: 110 }, state.release, state.connection);
    const connect = vi.fn(), loadSigner = vi.fn(), persist = vi.fn();
    for (const until of [-1, 1, NaN]) await expect(executeBundle(JSON.stringify(bundle), {
      approval: bundle.fingerprint, until, connect, loadSigner, persist })).rejects.toThrow("index");
    bundle.payload.operation = { kind: "launch", input: { keeperReleaseFingerprint: "1".repeat(64) } } as never;
    bundle.fingerprint = fingerprint(bundle.payload);
    await expect(executeBundle(JSON.stringify(bundle), { approval: bundle.fingerprint, until: 0,
      connect, loadSigner, persist })).rejects.toThrow("staged keeper release");
    expect(connect).not.toHaveBeenCalled(); expect(loadSigner).not.toHaveBeenCalled();
  });

  it("operator_until_stops_after_the_requested_transaction_and_resumes_that_prefix", async () => {
    const test = io();
    mkdirSync(scratch, { recursive: true });
    const artifact = Buffer.from(fixture.deployment.artifact, "base64"), artifactPath = scratch + "/bounded.so";
    writeFileSync(artifactPath, artifact);
    const input: DeploymentInput = { ...fixture.deployment, artifactPath, artifactBytes: artifact.length,
      artifactSha256: createHash("sha256").update(artifact).digest("hex") };
    const calls = { ...test.calls, getGenesisHash: vi.fn(async () => SOLANA_DEVNET_GENESIS_HASH),
      getMultipleAccountsInfo: vi.fn(async (addresses: PublicKey[]) => addresses.map(() => null)) };
    const connection = calls as unknown as Connection;
    const bundle = await quoteBundle({ kind: "deploy", input }, deploymentRelease(input, "https://api.devnet.solana.com"), connection);
    const options = { approval: bundle.fingerprint, until: 1, connect: () => connection, loadSigner: test.loadSigner,
      persist: (saved: OperatorBundle) => test.persist(saved.receipts[Math.max(...Object.keys(saved.receipts).map(Number))]!) };
    const result = await executeBundle(JSON.stringify(bundle), options);
    expect(Object.keys(result.receipts)).toEqual(["0", "1"]);
    expect(calls.getGenesisHash).toHaveBeenCalledTimes(1);
    expect(calls.sendRawTransaction).toHaveBeenCalledTimes(2);
    test.loadSigner.mockClear(); calls.sendRawTransaction.mockClear();
    await executeBundle(JSON.stringify(result), options);
    expect(test.loadSigner).not.toHaveBeenCalled(); expect(calls.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("operator_resume_reads_every_recorded_status_in_batches_not_one_call_each", async () => {
    // A deployment interrupted after 353 transactions resumes with two status
    // calls, not 353: a public endpoint limits each method to a few dozen a second.
    const test = io();
    mkdirSync(scratch, { recursive: true });
    const artifact = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(353 * 512 + 96, 1)]);
    const artifactPath = scratch + "/long.so";
    writeFileSync(artifactPath, artifact);
    const input: DeploymentInput = { ...fixture.deployment, artifactPath, artifactBytes: artifact.length,
      artifactSha256: createHash("sha256").update(artifact).digest("hex") };
    const calls = { ...test.calls, getGenesisHash: vi.fn(async () => SOLANA_DEVNET_GENESIS_HASH),
      getMultipleAccountsInfo: vi.fn(async (addresses: PublicKey[]) => addresses.map(() => null)) };
    const connection = calls as unknown as Connection;
    const bundle = await quoteBundle({ kind: "deploy", input }, deploymentRelease(input, "https://api.devnet.solana.com"), connection);
    const options = { approval: bundle.fingerprint, until: 352, connect: () => connection, loadSigner: test.loadSigner,
      persist: (saved: OperatorBundle) => test.persist(saved.receipts[Math.max(...Object.keys(saved.receipts).map(Number))]!) };
    const sent = await executeBundle(JSON.stringify(bundle), options);
    expect(Object.keys(sent.receipts)).toHaveLength(353);
    for (const call of [calls.getSignatureStatuses, calls.getSignatureStatus, test.loadSigner, calls.sendRawTransaction]) call.mockClear();
    const resumed = await executeBundle(JSON.stringify(sent), options);
    expect(calls.getSignatureStatuses.mock.calls.map(([signatures]) => signatures.length)).toEqual([256, 97]);
    expect(calls.getSignatureStatus).not.toHaveBeenCalled();
    expect(test.loadSigner).not.toHaveBeenCalled(); expect(calls.sendRawTransaction).not.toHaveBeenCalled();
    expect(Object.values(resumed.receipts).every((receipt) => receipt.state === "confirmed")).toBe(true);
    // A recorded transaction that failed is still refused, read from the batch.
    calls.getSignatureStatuses.mockImplementationOnce(async (signatures: string[]) => ({ context: { slot: 1 },
      value: signatures.map((_, index) => ({ err: index === 7 ? { InstructionError: [0, "Custom"] } : null, confirmationStatus: "confirmed" })) }));
    await expect(executeBundle(JSON.stringify(sent), options)).rejects.toThrow("recorded transaction failed");
  });

  it("operator_top_up_rejects_seeded_balance_drift_and_a_closed_window", async () => {
    const state = releaseConnection();
    const protocol = state.protocol;
    const daily = accountCoder.decode("arenaDaily", Buffer.from(fixture.plans.accounts.daily.data, "base64"));
    const day = daily.dayId;
    protocol.authority = payer; protocol.launchDayId = day - 1; protocol.suspendedUntilDay = 0;
    daily.status = { open: {} };
    const calls = { ...state.calls, getSlot: vi.fn(async () => 1), getBlockTime: vi.fn(async () => opens(day) + 60),
      getAccountInfo: vi.fn(async (address: PublicKey) => {
        const name = address.equals(deriveProtocolConfigPda()) ? "protocolConfig" : "arenaDaily";
        return state.info(await accountCoder.encode(name, name === "protocolConfig" ? protocol : daily), false, ZKUBE_PROGRAM_ID);
      }) };
    const connection = calls as unknown as Connection;
    const deposits = await observeDeposits(connection, payer.toBase58(), day - 1, [{ selector: "current", lamports: "1" }]);
    const bundle = await quoteBundle({ kind: "top-up", authority: payer.toBase58(), launchDayId: day - 1, deposits }, state.release, connection);
    await checkFreshTransaction(connection, bundle, 0);
    daily.ledger.seededLamports = daily.ledger.seededLamports.addn(1);
    await expect(checkFreshTransaction(connection, bundle, 0)).rejects.toThrow("Seeded balances changed");
    calls.getBlockTime.mockResolvedValue(opens(day) + 86340);
    await expect(checkFreshTransaction(connection, bundle, 0)).rejects.toThrow("not open for funding");
    await expect(checkLaunchWindow(connection, { kind: "launch", input: { launchCutoffUnixTimestamp: opens(day) } } as never))
      .rejects.toThrow("launch cutoff has expired");
  });

  it("deployment_instruction_bytes_and_accounts_match_the_rust_loader", () => {
    const expected = fixture.deployment;
    mkdirSync(scratch, { recursive: true });
    const artifactPath = scratch + "/program.so", artifact = Buffer.from(expected.artifact, "base64");
    writeFileSync(artifactPath, artifact);
    const input: DeploymentInput = { ...expected, artifactPath, artifactBytes: artifact.length,
      artifactSha256: createHash("sha256").update(artifact).digest("hex") };
    const plans = deploymentTransactions(input);
    expect(plans).toHaveLength(5);
    expect(plans.map(plan => publicTransaction(plan.label, plan.payer, plan.transaction,
      { maximumFeeLamports: 0, maximumSpendLamports: 0, reserveLamports: 0 }).instructions)).toEqual(expected.transactions);
    expect(deploymentRelease(input, "https://api.devnet.solana.com").allocationBytes).toBe(artifact.length + 10_240);
    writeFileSync(artifactPath, Buffer.alloc(artifact.length));
    expect(() => deploymentTransactions(input)).toThrow("Frozen SBF artifact differs");
  });

  it("upgrade_instruction_bytes_and_accounts_match_the_rust_loader", () => {
    const { input, release, artifact } = upgradeState();
    const plans = upgradeTransactions(input).map(plan => publicTransaction(plan.label, plan.payer, plan.transaction,
      { maximumFeeLamports: 0, maximumSpendLamports: 0, reserveLamports: 0 }).instructions);
    // The same buffer as a deployment, then the loader's own Upgrade: same program, ProgramData and authority.
    expect(plans.slice(0, -1)).toEqual(fixture.deployment.transactions.slice(0, -1));
    expect(plans.at(-1)).toEqual(fixture.deployment.upgrade);
    // ProgramData keeps its allocation: the new bytes, then zeros.
    expect(release).toMatchObject({ allocationBytes: 2048, upgradeAuthority: input.authority,
      programDataSha256: createHash("sha256").update(Buffer.concat([artifact, Buffer.alloc(2048 - artifact.length)])).digest("hex") });
    expect(() => upgradeRelease({ ...input, deployed: { ...input.deployed, allocationBytes: artifact.length - 5 } }, release.rpc))
      .toThrow("Program needs 5 more bytes than its ProgramData holds");
    writeFileSync(input.artifactPath, Buffer.alloc(artifact.length));
    expect(() => upgradeTransactions(input)).toThrow("Frozen SBF artifact differs");
  });

  it("an_upgrade_lands_only_while_no_entry_can_reach_a_daily_the_replaced_program_prepared", async () => {
    const test = upgradeState();
    const bundle = await quoteBundle({ kind: "upgrade", input: test.input }, test.release, test.connection);
    const last = bundle.payload.transactions.length - 1, today = 20740;
    expect(bundle.payload.transactions[last]!.label).toBe("Upgrade the program in place");
    // The buffer is written whatever the day is: it changes nothing a player can reach.
    await checkFreshTransaction(test.connection, bundle, 0);
    await checkFreshTransaction(test.connection, bundle, 1);
    test.world.buffer = true;
    await expect(checkFreshTransaction(test.connection, bundle, 0)).rejects.toThrow("Upgrade buffer address is occupied");
    // The upgrade itself is refused while today can be entered, suspended or not yesterday.
    for (const until of [0, today - 1, today]) {
      test.world.suspendedUntilDay = until;
      await expect(checkFreshTransaction(test.connection, bundle, last)).rejects.toThrow(`Day ${today} is not suspended`);
    }
    test.world.suspendedUntilDay = today + 1;
    await checkFreshTransaction(test.connection, bundle, last);
    // Too close to a day that can be entered, it could land there: refused, until that day is suspended too.
    test.world.now = opens(today + 1) - LANDING_SECONDS + 1;
    await expect(checkFreshTransaction(test.connection, bundle, last)).rejects.toThrow(`Day ${today + 1} is not suspended`);
    test.world.now = opens(today + 1) - LANDING_SECONDS - 1;
    await checkFreshTransaction(test.connection, bundle, last);
    test.world.suspendedUntilDay = today + 2; test.world.now = opens(today + 1) - 1;
    await checkFreshTransaction(test.connection, bundle, last);
    // A program that is no longer the one the plan replaces is never upgraded by it.
    test.world.held = Buffer.alloc(2048, 8);
    await expect(checkFreshTransaction(test.connection, bundle, last)).rejects.toThrow("differs from the release");
  });

  it("an_upgrade_bundle_runs_against_the_program_it_replaces_and_resumes_once_it_has_landed", async () => {
    const test = upgradeState(), run = io();
    const calls = { ...run.calls, ...test.calls, getBalance: run.calls.getBalance };
    const connection = calls as unknown as Connection;
    const bundle = await quoteBundle({ kind: "upgrade", input: test.input }, test.release, connection);
    const last = bundle.payload.transactions.length - 1;
    const options = { approval: bundle.fingerprint, connect: () => connection, loadSigner: run.loadSigner,
      persist: (saved: OperatorBundle) => run.persist(saved.receipts[Math.max(...Object.keys(saved.receipts).map(Number))]!) };
    // The buffer is written on an ordinary day; the upgrade waits for a suspended one.
    const written = await executeBundle(JSON.stringify(bundle), { ...options, until: last - 1 });
    expect(Object.keys(written.receipts)).toHaveLength(last);
    await expect(executeBundle(JSON.stringify(written), options)).rejects.toThrow("is not suspended");
    expect(calls.sendRawTransaction).toHaveBeenCalledTimes(last);
    test.world.suspendedUntilDay = 20741;
    const done = await executeBundle(JSON.stringify(written), options);
    expect(Object.keys(done.receipts)).toHaveLength(last + 1);
    expect(calls.sendRawTransaction).toHaveBeenCalledTimes(last + 1);
    // Once it has landed the cluster holds the upgraded bytes: a rerun finds every receipt and signs nothing.
    test.world.held = Buffer.concat([test.artifact, Buffer.alloc(2048 - test.artifact.length)]);
    await assertUpgradeRelease(connection, test.release, test.input.deployed);
    run.loadSigner.mockClear(); calls.sendRawTransaction.mockClear();
    await executeBundle(JSON.stringify(done), options);
    expect(run.loadSigner).not.toHaveBeenCalled(); expect(calls.sendRawTransaction).not.toHaveBeenCalled();
    // Any other bytes at the program stop the bundle before a key is loaded.
    test.world.held = Buffer.alloc(2048, 8);
    await expect(executeBundle(JSON.stringify(bundle), options)).rejects.toThrow("differs from the release");
    expect(run.loadSigner).not.toHaveBeenCalled();
  });

  it("a_suspension_is_not_lifted_for_a_day_whose_daily_another_catalogue_prepared", async () => {
    const test = upgradeState(), today = 20740;
    const daily = accountCoder.decode("arenaDaily", Buffer.from(fixture.plans.accounts.daily.data, "base64"));
    const stored = Buffer.from(daily.rulesHash).toString("hex"), other = "5".repeat(64);
    const launchDayId = test.state.protocol.launchDayId;
    const lift = async (untilDay: number, rulesHash: string) => checkFreshTransaction(test.connection,
      await quoteBundle({ kind: "set-suspension", authority: payer.toBase58(), launchDayId, untilDay }, test.release, test.connection),
      0, () => rulesHash);
    test.world.suspendedUntilDay = today + 1;
    // No Daily today: the first entry after the lift prepares it with the program now deployed.
    await lift(today, other);
    // A Daily today that this build would prepare identically is as good as new.
    test.world.daily = Buffer.from(fixture.plans.accounts.daily.data, "base64");
    await lift(today, stored); await lift(0, stored);
    // One prepared under another catalogue keeps its hash: today stays suspended, tomorrow opens by itself.
    await expect(lift(today, other)).rejects.toThrow(`Day ${today}'s Daily was prepared under another catalogue`);
    await expect(lift(0, other)).rejects.toThrow("leave the day suspended");
    await lift(today + 1, other); await lift(today + 3, other);
    // A day that is not suspended is not being lifted.
    test.world.suspendedUntilDay = today;
    await lift(today - 2, other);
    // A program deployed on an earlier day prepared today's Daily itself, whatever this checkout would compute:
    // an upgrade that never landed leaves the suspension free to lift.
    test.world.suspendedUntilDay = today + 1; test.world.deployedAt = opens(today) - 1;
    await lift(today, other);
  });

  it("plans_made_for_after_an_upgrade_bind_the_upgraded_program_and_wait_for_it", async () => {
    const test = upgradeState();
    const launchDayId = test.state.protocol.launchDayId;
    const upgrade = await quoteBundle({ kind: "upgrade", input: test.input }, test.release, test.connection);
    const launch = structuredClone(upgrade);
    launch.payload.operation = { kind: "launch", input: { authority: payer.toBase58(), launchDayId } } as never;
    launch.payload.release = { ...test.release, ...test.input.deployed };
    launch.fingerprint = fingerprint(launch.payload);
    const launchPath = scratch + "/launch.json", upgradePath = scratch + "/upgrade.json", path = scratch + "/lift.json";
    writeFileSync(launchPath, JSON.stringify(launch)); writeFileSync(upgradePath, JSON.stringify(upgrade));
    // Planned before the upgrade has landed, against the program as it will be.
    vi.mocked(devnetConnection).mockReturnValue(test.connection);
    await runOperator(["plan", "set-suspension", "--launch-bundle", launchPath, "--upgrade-bundle", upgradePath,
      "--until-day", "20740", "--bundle", path], { SOLANA_DEVNET_RPC_URL: test.release.rpc });
    const planned = readBundle(readFileSync(path, "utf8"));
    expect(planned.payload.release).toEqual(test.release);
    // Until the upgrade lands it cannot run; afterwards the plan the launch bundle alone would give cannot.
    const loadSigner = vi.fn();
    await expect(executeBundle(JSON.stringify(planned), { approval: planned.fingerprint,
      connect: () => test.connection, loadSigner, persist: vi.fn() })).rejects.toThrow("differs from the release");
    expect(loadSigner).not.toHaveBeenCalled();
    await expect(runOperator(["plan", "set-suspension", "--launch-bundle", launchPath, "--upgrade-bundle", launchPath,
      "--until-day", "20740", "--bundle", scratch + "/other.json"], { SOLANA_DEVNET_RPC_URL: test.release.rpc }))
      .rejects.toThrow("--upgrade-bundle must be an upgrade bundle");
    test.world.held = Buffer.concat([test.artifact, Buffer.alloc(2048 - test.artifact.length)]);
    await expect(runOperator(["plan", "set-suspension", "--launch-bundle", launchPath,
      "--until-day", "20740", "--bundle", scratch + "/stale.json"], { SOLANA_DEVNET_RPC_URL: test.release.rpc }))
      .rejects.toThrow("differs from the release");
    vi.mocked(devnetConnection).mockReset();
  });

  it("the_release_check_says_whether_the_deployed_program_is_the_build_and_prepared_todays_daily", async () => {
    const test = upgradeState(), today = 20740;
    const artifact = { artifactPath: test.input.artifactPath, artifactSha256: test.input.artifactSha256 };
    const daily = accountCoder.decode("arenaDaily", Buffer.from(fixture.plans.accounts.daily.data, "base64"));
    const stored = Buffer.from(daily.rulesHash).toString("hex");
    // Before the upgrade the cluster holds the older program: the check fails and says what it found.
    await expect(checkRelease(test.connection, artifact, () => stored)).rejects.toThrow("The deployed program is not the reviewed release build");
    test.world.held = Buffer.concat([test.artifact, Buffer.alloc(2048 - test.artifact.length)]);
    test.world.suspendedUntilDay = today + 1;
    expect(await checkRelease(test.connection, artifact, () => stored)).toMatchObject({ deployedIsTheReviewedBuild: true,
      reviewedBuildSha256: test.input.artifactSha256, deployedProgramDataSha256: test.release.programDataSha256,
      today, todaySuspended: true, todaysDaily: "not prepared yet: the day's first entry prepares it", todaysDailyRulesHash: null });
    test.world.daily = Buffer.from(fixture.plans.accounts.daily.data, "base64"); test.world.suspendedUntilDay = 0;
    expect(await checkRelease(test.connection, artifact, () => stored)).toMatchObject({ todaySuspended: false,
      todaysDaily: "prepared by this build's catalogue", todaysDailyRulesHash: stored });
    expect(await checkRelease(test.connection, artifact, () => "5".repeat(64))).toMatchObject({
      todaysDaily: "prepared under another catalogue: the day must stay suspended" });
    // Bytes after the program's own are part of what is deployed.
    test.world.held = Buffer.concat([test.artifact, Buffer.alloc(2048 - test.artifact.length, 1)]);
    await expect(checkRelease(test.connection, artifact, () => stored)).rejects.toThrow("not the reviewed release build");
  });

  it("operator_cli_options_and_exact_amounts_fail_closed", async () => {
    expect(parseDeposit("daily:current:0.001000001SOL")).toEqual({ selector: "current", lamports: "1000001" });
    for (const bad of ["daily:current:1", "daily:current:0SOL", "daily:current:1.0000000001SOL", "daily:current:-1SOL"]) {
      expect(() => parseDeposit(bad)).toThrow();
    }
    expect(() => parseOperatorArgs(["execute", "--bundle", "x", "--until-day", "4"])).toThrow("not valid");
    expect(() => parseOperatorArgs(["plan", "migrate", "--bundle", "x"])).toThrow("Choose");
    expect(parseOperatorArgs(["plan", "upgrade", "--bundle", "build/x"])).toMatchObject({ mode: "plan", operation: "upgrade" });
    expect(() => parseOperatorArgs(["plan", "upgrade", "--bundle", "x", "--upgrade-bundle", "y"])).toThrow("not valid");
    expect(parseOperatorArgs(["check-release"])).toEqual({ help: false, mode: "check-release" });
    expect(() => readBundle(JSON.stringify({ schema: "old", fingerprint: "0".repeat(64) }))).toThrow("fingerprint or shape");
    expect(await runOperator(["--help"], {})).toContain("inclusive transaction index");
  });
});
