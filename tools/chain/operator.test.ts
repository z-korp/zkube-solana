import { createHash, verify } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey, SystemProgram, Transaction, VersionedTransaction, type Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { accountCoder, assertDevnetRelease, devnetConnection, programDataAddress, UPGRADEABLE_LOADER } from "./chainRelease.js";
import { parseDeposit, parseOperatorArgs, runOperator } from "./cli.js";
import { deploymentRelease, deploymentTransactions, type DeploymentInput } from "./deploymentPlan.js";
import { quoteBundle, readBundle, type OperatorBundle } from "./operatorPlan.js";
import { executeBundle } from "./operatorRuntime.js";
import { checkFreshTransaction, checkLaunchWindow, observeDeposits } from "./operatorState.js";
import { deriveProtocolConfigPda } from "./pdas.js";
import { executeTransaction, fingerprint, loadPinnedKeypair, publicTransaction, type TransactionReceipt } from "./operatorTransaction.js";

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

  it("operator_top_up_rejects_seeded_balance_drift_and_a_closed_window", async () => {
    const state = releaseConnection();
    const protocol = state.protocol;
    const daily = accountCoder.decode("arenaDaily", Buffer.from(fixture.plans.accounts.daily.data, "base64"));
    const day = daily.dayId;
    protocol.authority = payer; protocol.launchDayId = day - 1; protocol.suspendedUntilDay = 0;
    daily.status = { open: {} };
    const calls = { ...state.calls, getSlot: vi.fn(async () => 1), getBlockTime: vi.fn(async () => day * 86400 + 60),
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
    calls.getBlockTime.mockResolvedValue(day * 86400 + 86340);
    await expect(checkFreshTransaction(connection, bundle, 0)).rejects.toThrow("not open for funding");
    await expect(checkLaunchWindow(connection, { kind: "launch", input: { launchCutoffUnixTimestamp: day * 86400 } } as never))
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

  it("operator_cli_options_and_exact_amounts_fail_closed", async () => {
    expect(parseDeposit("daily:current:0.001000001SOL")).toEqual({ selector: "current", lamports: "1000001" });
    for (const bad of ["daily:current:1", "daily:current:0SOL", "daily:current:1.0000000001SOL", "daily:current:-1SOL"]) {
      expect(() => parseDeposit(bad)).toThrow();
    }
    expect(() => parseOperatorArgs(["execute", "--bundle", "x", "--until-day", "4"])).toThrow("not valid");
    expect(() => parseOperatorArgs(["plan", "upgrade", "--bundle", "x"])).toThrow("Choose");
    expect(() => readBundle(JSON.stringify({ schema: "old", fingerprint: "0".repeat(64) }))).toThrow("fingerprint or shape");
    expect(await runOperator(["--help"], {})).toContain("inclusive transaction index");
  });
});
