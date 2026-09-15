using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;
using ZKube.Presentation;

namespace ZKube.Integration.Client.Runs.Tests
{
    public sealed partial class RunClientTests
    {
        private static readonly string Root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
        private static JObject Fixture(string name)
        {
            return ZKube.Integration.Tests.ProgramScenarios.Load(name);
        }
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"], (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        private static async Task<T> Fails<T>(Func<Task> action) where T : Exception
        { try { await action(); } catch (T error) { return error; } Assert.Fail("Expected " + typeof(T).Name); return null; }

        [Test]
        public async Task StaleBoardCannotDelegateOrRequestVrfForASuccessorOrAnotherOwner()
        {
            foreach (bool delegated in new[] { false, true })
            {
                var env = await Environment.Create(); env.Http.States["daily"] = "prepared";
                var initial = await env.Client.Recover("daily");
                var provider = new RunBoardActionProvider(env.Client, initial, new ActiveRunReconciler(env.Accounts));
                env.Http.ReplaceWithSuccessor(true, delegated);
                await Fails<InvalidOperationException>(async () => await provider.ResolveVrf(initial.Token, default));
                Assert.That(env.Http.Sent, Is.Empty); Assert.That(env.Native.KeyLoads, Is.Zero);
            }
            var switched = await Environment.Create(); switched.Http.States["daily"] = "prepared";
            var before = await switched.Client.Recover("daily");
            var stale = new RunBoardActionProvider(switched.Client, before, new ActiveRunReconciler(switched.Accounts));
            await switched.Identity.Disconnect();
            using var other = new DeviceSigner(Enumerable.Repeat((byte)3, 32).ToArray());
            switched.Native.Owner = other.Address; await switched.Identity.Connect(other.Address);
            int requests = switched.Http.Requests;
            var error = await Fails<InvalidOperationException>(async () => await stale.ResolveVrf(before.Token, default));
            StringAssert.Contains("bound run identity changed", error.Message);
            Assert.That(switched.Http.Requests, Is.EqualTo(requests), "Reject stale owner before looking up or mutating another player's slot");
            Assert.That(switched.Http.Sent, Is.Empty); Assert.That(switched.Native.KeyLoads, Is.Zero);
        }

        [Test]
        public async Task BaseConsumptionWorksWithoutAnAvailableDeviceWhileErCommitStillRequiresOne()
        {
            foreach (string mode in new[] { "daily" })
            foreach (string unavailable in new[] { "missing", "expired", "revoked", "depleted" })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "finished"; env.Http.Delegated.Remove(mode);
                env.Native.HasKey = unavailable != "missing"; env.Http.RevokedSession = unavailable == "revoked";
                if (unavailable == "expired") env.Now = env.SessionValidUntil;
                env.Http.SignerBalance = unavailable == "depleted" ? 0UL : 1000000000UL;
                var consumed = await env.Client.FinishAndSettle(mode);
                Assert.That(consumed.Phase, Is.EqualTo("consumed")); Assert.That(consumed.Token, Is.Null);
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "consume_arena_run" }));
                Assert.That(env.Http.SentFeePayers, Is.EqualTo(new[] { env.Owner }));
                ZKube.Integration.Tests.ProgramScenarios.Equivalent(Convert.FromBase64String(env.Http.SentTransactions.Single()), Convert.FromBase64String((string)env.Http.Runs["ownerConsume"][mode]));
                Assert.That(env.Native.KeyLoads, Is.EqualTo(1), "Base consumption first checks whether normal device settlement is available");
                Assert.That(await env.Markers.Load(env.Owner, mode), Is.Null);
                var er = await Environment.Create(); er.Http.States[mode] = "finished";
                er.Native.HasKey = unavailable != "missing"; er.Http.RevokedSession = unavailable == "revoked";
                if (unavailable == "expired") er.Now = er.SessionValidUntil;
                er.Http.SignerBalance = unavailable == "depleted" ? 0UL : 1000000000UL;
                await Fails<InvalidOperationException>(async () => await er.Client.FinishAndSettle(mode));
                Assert.That(er.Http.Sent, Is.Empty); Assert.That(await er.Markers.Load(er.Owner, mode), Is.Not.Null);
            }
        }

        [Test]
        public async Task ConsumingAnOldRunNeverReturnsTheImmediatelyCreatedSuccessorToken()
        {
            var env = await Environment.Create(); env.Http.States["daily"] = "finished"; env.Http.Delegated.Remove("daily");
            env.Http.SuccessorAfterConsume = true;
            var consumed = await env.Client.FinishAndSettle("daily");
            Assert.That(consumed.Phase, Is.EqualTo("consumed")); Assert.That(consumed.Token, Is.Null);
            Assert.That((await env.Markers.Load(env.Owner, "daily")).ActiveRun, Is.EqualTo((string)env.Http.Runs["successor"]["address"]));
            Assert.That(env.Http.Sent, Is.EqualTo(new[] { "consume_arena_run" }));
        }

        [Test]
        public async Task PendingVrfResolvesAfterKeyLossWithoutAReplacementSessionOrRequest()
        {
            var env = await Environment.Create(); env.Http.States["daily"] = "awaitingVrf";
            env.Http.AdvancePendingVrf = true; env.Native.HasKey = false;
            var result = await env.Client.ResolveVrf("daily");
            Assert.That(NativeEngine.Summary(result.Token).Phase, Is.EqualTo((byte)CorePhase.Playing));
            Assert.That(env.Native.KeyLoads, Is.Zero); Assert.That(env.Http.Sent, Is.Empty);
        }

        [Test]
        public async Task AnotherDeviceConsumingAndStartingANewRunCannotFulfillTheOldAction()
        {
            var env = await Environment.Create(); var initial = await env.Client.Recover("daily");
            var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
            env.Http.ConsumeAfterAction = true;
            var result = await env.Client.Apply("daily", binding.Accept(initial), binding, RunClientAction.Reroll);
            Assert.That(result.Phase, Is.EqualTo("consumed")); Assert.That(result.Token, Is.Null);
            Assert.That((await env.Markers.Load(env.Owner, "daily")).ActiveRun, Is.EqualTo((string)env.Http.Runs["successor"]["address"]));
            Assert.That(await env.Journal.Load(env.Owner), Is.Null);
        }

        [Test]
        public async Task ArcadePreparesDelegatesAndRequestsOpeningVrfWithUnavailableOptionalClaims()
        {
            foreach (string mode in new[] { "daily" })
            {
                var env = await Environment.Create(); env.Http.Prepare(mode); env.Http.FailClaims = true;
                var prepared = await env.Client.StartDaily();
                Assert.That(prepared.Phase, Is.EqualTo("delegated"));
                Assert.That(NativeEngine.Summary(prepared.Token).Phase, Is.EqualTo((byte)CorePhase.AwaitingVrf));
                var ready = await env.Client.ResolveVrf(mode);
                Assert.That(NativeEngine.Summary(ready.Token).Phase, Is.EqualTo((byte)CorePhase.Playing));
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "enter_arena", "delegate_active_run", "request_vrf" }));
                Assert.That(await env.Markers.Load(env.Owner, mode), Is.Not.Null);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            }
        }

        [Test]
        public async Task ArcadeRecoversWithoutADeviceKeyAndUsesProgramSnapshots()
        {
            var env = await Environment.Create(); env.Native.HasKey = false;
            foreach (string mode in new[] { "daily" })
            {
                var state = await env.Client.Recover(mode);
                Assert.That(state.Phase, Is.EqualTo("delegated"));
                Assert.That(state.Token.State, Is.EqualTo(Convert.FromBase64String((string)env.Http.Row(mode, "playing")["token"]["state"])));
            }
            Assert.That(await env.Markers.Load(env.Owner, "daily"), Is.Not.Null);
            Assert.That(env.Http.Sent, Is.Empty); Assert.That(env.Native.KeyLoads, Is.Zero);
        }

        [Test]
        public async Task RerollAcceptanceAndMissedVrfReturnNativeSnapshotsWithoutInventedHistory()
        {
            foreach (string mode in new[] { "daily" })
            {
                var env = await Environment.Create(); var initial = await env.Client.Recover(mode);
                var provider = new RunBoardActionProvider(env.Client, initial, new ActiveRunReconciler(env.Accounts));
                var board = provider.Bind(initial, mode);
                var result = await provider.Submit(board.Accepted, new BoardAction(BoardActionKind.Reroll), default);
                Assert.That(NativeEngine.Summary(result.Token).ActionCounter, Is.EqualTo(1));
                Assert.That(NativeEngine.Summary(result.Token).Phase, Is.EqualTo((byte)CorePhase.AwaitingVrf));
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "request_reroll" }));
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                env.Http.States[mode] = "rerolled";
                var arrived = await provider.ResolveVrf(result.Token, default);
                Assert.That(arrived.IsSnapshot, Is.True);
                Assert.That(arrived.Transition, Is.Null);
                Assert.That(NativeEngine.Summary(arrived.Token).Phase, Is.EqualTo((byte)CorePhase.Playing));
                Assert.That(arrived.Token.Config, Is.EqualTo(board.Accepted.Config));
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "request_reroll" }));
            }
        }

        [Test]
        public async Task UncertainActionPreservesJournalAndLocatorAndBlocksAnotherIntent()
        {
            var env = await Environment.Create(); var campaign = await env.Client.Recover("daily");
            await env.Client.Recover("daily"); env.Http.Confirmed = false;
            var binding = new RunPresentationBinding(campaign, new ActiveRunReconciler(env.Accounts));
            await Fails<RunExecutionException>(async () => await env.Client.Apply("daily", binding.Accept(campaign), binding, RunClientAction.Reroll));
            Assert.That(await env.Journal.Load(env.Owner), Is.Not.Null);
            await Fails<InvalidOperationException>(async () => await env.Client.StartDaily());
            Assert.That(env.Http.Sent.Count, Is.EqualTo(1));
            Assert.That(await env.Markers.Load(env.Owner, "daily"), Is.Not.Null);
            env.Http.Confirmed = true;
            var recovered = await env.Client.Recover("daily");
            Assert.That(NativeEngine.Summary(recovered.Token).ActionCounter, Is.EqualTo(1));
            Assert.That(env.Http.Sent.Count, Is.EqualTo(1)); Assert.That(await env.Journal.Load(env.Owner), Is.Null);
        }

        [Test]
        public async Task BoundRecoveryObservesAcceptedActionWithoutResubmitting()
        {
            var env = await Environment.Create(); var initial = await env.Client.Recover("daily");
            var native = new ActiveRunReconciler(env.Accounts);
            var provider = new RunBoardActionProvider(env.Client, initial, native);
            var board = provider.Bind(initial, "Arcade"); env.Http.Confirmed = false;
            await Fails<RunExecutionException>(async () => await provider.Submit(board.Accepted, new BoardAction(BoardActionKind.Reroll), default));
            var pending = await env.Journal.Load(env.Owner);
            Assert.That((await env.Journal.Load(env.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(env.Http.Sent.Count, Is.EqualTo(1));
            env.Http.Confirmed = true;
            var recovered = await provider.Recover(default);
            Assert.That(recovered.IsSnapshot, Is.True); Assert.That(recovered.Transition, Is.Null);
            Assert.That(NativeEngine.Summary(recovered.Token).ActionCounter, Is.EqualTo(1));
            Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            Assert.That(await env.Markers.Load(env.Owner, "daily"), Is.Not.Null);
            Assert.That(env.Http.Sent.Count, Is.EqualTo(1));
            var duplicate = await provider.Recover(default);
            Assert.That(duplicate.Token.State, Is.EqualTo(recovered.Token.State));
            Assert.That(env.Http.Sent.Count, Is.EqualTo(1));
        }

        [Test]
        public async Task BoundRecoveryNeverReconcilesAfterTheRunSlotOrOwnerChanges()
        {
            foreach (bool ownerChanges in new[] { false, true })
            {
                var env = await Environment.Create(); var initial = await env.Client.Recover("daily");
                var provider = new RunBoardActionProvider(env.Client, initial, new ActiveRunReconciler(env.Accounts));
                var board = provider.Bind(initial, "Arcade"); env.Http.Confirmed = false;
                await Fails<RunExecutionException>(async () => await provider.Submit(board.Accepted, new BoardAction(BoardActionKind.Reroll), default));
                string signature = (await env.Journal.Load(env.Owner)).Signature;
                if (ownerChanges)
                {
                    await env.Identity.Disconnect();
                    env.Native.Owner = (string)Fixture("plans")["inputs"]["device"];
                    await env.Identity.Connect();
                }
                else env.Http.ReplaceWithSuccessor(false, true);
                int requests = env.Http.Requests;
                env.Http.Confirmed = true;
                Assert.That(await provider.Recover(default), Is.Null);
                Assert.That((await env.Journal.Load(env.Owner)).Signature, Is.EqualTo(signature));
                Assert.That(env.Http.Sent.Count, Is.EqualTo(1));
                if (ownerChanges) Assert.That(env.Http.Requests, Is.EqualTo(requests));
            }
        }

        [Test]
        public async Task TerminalCommitAndConsumeRequireCopybackAndClearArcadeLocator()
        {
            var env = await Environment.Create(); await env.Client.Recover("daily");
            var result = await env.Client.FinishAndSettle("daily");
            Assert.That(result.Marker, Is.Null);
            Assert.That(env.Http.Sent, Is.EqualTo(new[] { "finish_run", "commit_run", "consume_arena_run" }));
            Assert.That(await env.Markers.Load(env.Owner, "daily"), Is.Null);
        }

        [Test]
        public async Task ChangedBoardAndChangedRulesAreRejectedBeforeSigning()
        {
            var env = await Environment.Create(); var initial = await env.Client.Recover("daily");
            var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
            env.Http.States["daily"] = "rerolled";
            await Fails<InvalidOperationException>(async () => await env.Client.Apply("daily", binding.Accept(initial), binding, RunClientAction.Reroll));
            Assert.That(env.Http.Sent, Is.Empty); Assert.That(env.Native.KeyLoads, Is.Zero);
            var native = RunClient.NativeCandidate(binding.Accept(initial), RunClientAction.Reroll, 0, 0, 0);
            var current = await env.Client.Recover("daily");
            Assert.That(BoardActionResult.Verified(binding.Accept(current), native).IsSnapshot, Is.True);
            Assert.That(BoardActionResult.Verified(native.Token, native).Transition, Is.SameAs(native));
            env.Http.States["daily"] = "playing"; env.Http.ChangedRules = true;
            var changedRules = await env.Client.Recover("daily");
            Assert.Throws<InvalidOperationException>(() => binding.Accept(changedRules));
        }


        [Test]
        public async Task StaleTerminalContinueNeverFinishesASuccessorInEitherMode()
        {
            foreach (string mode in new[] { "daily" })
            foreach (bool delegated in new[] { false, true })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "finished";
                var initial = await env.Client.Recover(mode);
                var provider = new RunBoardActionProvider(env.Client, initial, new ActiveRunReconciler(env.Accounts));
                env.Http.ReplaceWithSuccessor(false, delegated, mode);
                var result = await provider.FinishAndSettle(default);
                Assert.That(result.Phase, Is.EqualTo("run-unavailable"));
                Assert.That(env.Http.Sent, Is.Empty); Assert.That(env.Native.KeyLoads, Is.Zero);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            }
            var switched = await Environment.Create(); switched.Http.States["daily"] = "finished";
            var before = await switched.Client.Recover("daily");
            var stale = new RunBoardActionProvider(switched.Client, before, new ActiveRunReconciler(switched.Accounts));
            await switched.Identity.Disconnect(); int requests = switched.Http.Requests;
            Assert.That((await stale.FinishAndSettle(default)).Phase, Is.EqualTo("identity-changed"));
            Assert.That(switched.Http.Requests, Is.EqualTo(requests)); Assert.That(switched.Http.Sent, Is.Empty);
        }

        [Test]
        public async Task BaseSettlementPayerMatchesAuthorizedSignerAvailability()
        {
            var oracle = Fixture("runs");
            foreach (string condition in new[] { "ready", "missing", "expired", "revoked", "depleted" })
            {
                string mode = "daily";
                var env = await Environment.Create(); env.Http.States[mode] = "finished"; env.Http.Delegated.Remove(mode);
                var state = await env.Client.Recover(mode);
                var provider = new RunBoardActionProvider(env.Client, state, new ActiveRunReconciler(env.Accounts));
                env.Native.HasKey = condition != "missing"; env.Http.RevokedSession = condition == "revoked";
                if (condition == "expired") env.Now = env.SessionValidUntil;
                if (condition == "depleted") env.Http.SignerBalance = 0;
                var result = await provider.FinishAndSettle(default);
                Assert.That(result.Phase, Is.EqualTo("consumed"), mode + "/" + condition);
                Assert.That(env.Http.SentFeePayers, Is.EqualTo(new[] { condition == "ready" ? (string)Fixture("plans")["inputs"]["device"] : env.Owner }), mode + "/" + condition);
                string fixture = condition == "ready" ? "deviceConsume" : "ownerConsume";
                ZKube.Integration.Tests.ProgramScenarios.Equivalent(Convert.FromBase64String(env.Http.SentTransactions.Single()), Convert.FromBase64String((string)oracle[fixture][mode]));
                Assert.That(env.Native.OwnerPrompts, Is.EqualTo(condition == "ready" ? 0 : 1));
            }
        }

        [Test]
        public async Task InvalidOrFailedSessionReadsAndExactFeeFailureNeverPromptTheOwnerFallback()
        {
            foreach (string failure in new[] { "malformed", "rpc", "fee" })
            {
                var env = await Environment.Create(); env.Http.States["daily"] = "finished"; env.Http.Delegated.Clear();
                var state = await env.Client.Recover("daily");
                var provider = new RunBoardActionProvider(env.Client, state, new ActiveRunReconciler(env.Accounts));
                env.Http.MalformedSession = failure == "malformed"; env.Http.FailSessionRead = failure == "rpc";
                if (failure == "fee") env.Http.ActualDeviceBalance = 0;
                if (failure == "malformed") await Fails<FormatException>(async () => await provider.FinishAndSettle(default));
                else if (failure == "rpc") await Fails<IOException>(async () => await provider.FinishAndSettle(default));
                else Assert.That((await Fails<RunExecutionException>(async () => await provider.FinishAndSettle(default))).Result.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage));
                Assert.That(env.Native.OwnerPrompts, Is.Zero); Assert.That(env.Http.Sent, Is.Empty);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                Assert.That(await env.Markers.Load(env.Owner, "daily"), Is.Not.Null);
            }
        }

        [Test]
        public async Task MissingTokenCannotHideMalformedFundingOrALocalKeyMismatch()
        {
            foreach (string mode in new[] { "daily" })
            foreach (string malformed in new[] { "key", "owner", "data", "executable", "balance" })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "finished"; env.Http.Delegated.Remove(mode);
                var initial = await env.Client.Recover(mode);
                var provider = new RunBoardActionProvider(env.Client, initial, new ActiveRunReconciler(env.Accounts));
                env.Http.RevokedSession = true;
                if (malformed == "key") env.Native.SeedByte = 3;
                else env.Http.MalformedFunding = malformed;
                await Fails<FormatException>(async () => await provider.FinishAndSettle(default));
                Assert.That(env.Native.OwnerPrompts, Is.Zero, mode + "/" + malformed);
                Assert.That(env.Http.Sent, Is.Empty);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                Assert.That(await env.Markers.Load(env.Owner, mode), Is.Not.Null);
            }
        }

        [Test]
        public async Task UncertainConsumptionKeepsOneDeviceSignatureAndNeverFallsBackToOwner()
        {
            foreach (string mode in new[] { "daily" })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "finished"; env.Http.Delegated.Remove(mode);
                var initial = await env.Client.Recover(mode);
                var provider = new RunBoardActionProvider(env.Client, initial, new ActiveRunReconciler(env.Accounts));
                env.Http.Confirmed = false;
                var error = await Fails<RunExecutionException>(async () => await provider.FinishAndSettle(default));
                Assert.That(error.Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                string signature = (await env.Journal.Load(env.Owner)).Signature;
                await Fails<InvalidOperationException>(async () => await provider.FinishAndSettle(default));
                Assert.That((await env.Journal.Load(env.Owner)).Signature, Is.EqualTo(signature));
                Assert.That(env.Http.Sent.Count, Is.EqualTo(1)); Assert.That(env.Native.OwnerPrompts, Is.Zero);
                env.Http.Confirmed = true;
                await env.Client.Recover(mode);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                Assert.That(env.Http.Sent.Count, Is.EqualTo(1)); Assert.That(env.Native.OwnerPrompts, Is.Zero);
            }
        }

        [Test]
        public async Task DelayedCopybackRechecksSessionBeforeBaseAndNeverConsumesEarly()
        {
            foreach (string mode in new[] { "daily" })
            foreach (bool expire in new[] { false, true })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "finished";
                var initial = await env.Client.Recover(mode);
                var provider = new RunBoardActionProvider(env.Client, initial, new ActiveRunReconciler(env.Accounts));
                env.Http.CopybackPolls = 5;
                env.Http.AfterCopyback = () => { if (expire) env.Now = env.SessionValidUntil; };
                var pending = await Fails<RunExecutionException>(async () => await provider.FinishAndSettle(default));
                Assert.That(pending.Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                string signature = (await env.Journal.Load(env.Owner)).Signature;
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "commit_run" }));
                Assert.That(env.Native.OwnerPrompts, Is.Zero);
                await Fails<InvalidOperationException>(async () => await provider.FinishAndSettle(default));
                Assert.That((await env.Journal.Load(env.Owner)).Signature, Is.EqualTo(signature));
                for (int attempt = 0; attempt < 6 && await env.Journal.Load(env.Owner) != null; attempt++)
                {
                    try { await provider.Recover(default); }
                    catch (RunExecutionException error) { Assert.That(error.Result.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); }
                }
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                var result = await provider.FinishAndSettle(default);
                Assert.That(result.Phase, Is.EqualTo("consumed"));
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "commit_run", "consume_arena_run" }));
                Assert.That(env.Http.CopybackPolls, Is.Zero);
                ZKube.Integration.Tests.ProgramScenarios.Equivalent(Convert.FromBase64String(env.Http.SentTransactions.Last()), Convert.FromBase64String((string)env.Http.Runs[expire ? "ownerConsume" : "deviceConsume"][mode]));
                Assert.That(env.Native.OwnerPrompts, Is.EqualTo(expire ? 1 : 0));
            }
        }

        [Test]
        public async Task MoneyBoardRealmComesFromTheValidatedAccountInEachMode()
        {
            foreach (string mode in new[] { "daily" })
            {
                var env = await Environment.Create(); var observed = await env.Client.Recover(mode);
                byte expected = (byte)env.Accounts.ActiveRun(observed.Account, env.Owner)["map_id"];
                var native = new ActiveRunReconciler(env.Accounts);
                var binding = new RunPresentationBinding(observed, native);
                var board = new RunBoardActionProvider(env.Client, observed, native).Bind(observed, "Run");
                Assert.That(binding.RealmId, Is.EqualTo(expected)); Assert.That(board.RealmId, Is.EqualTo(expected));
                CollectionAssert.AreEqual(observed.Token.State, board.Accepted.State);
                Assert.That(env.Http.Sent, Is.Empty);
            }
        }

        private sealed class Environment
        {
            public string Owner;
            public AccountBindings Accounts;
            public RunStateStore Markers;
            public TransactionJournal Journal;
            public NativeWallet Native;
            public ClientIdentity Identity;
            public long Now, SessionValidUntil;
            public Http Http;
            public RunClient Client;
            public Store Storage;
            public static async Task<Environment> Create()
            {
                var value = new Environment(); var plans = Fixture("plans");
                string idl = File.ReadAllText(Root + "/unity/Assets/ZKube/Integration/Generated/solana.json");
                var protocol = new ProtocolBindings(idl); var tokens = new SessionTokenBindings(File.ReadAllText(Root + "/unity/Assets/ZKube/Integration/Generated/session.json"));
                value.Owner = (string)plans["inputs"]["owner"];
                value.Accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
                var planner = new TransactionPlanner(protocol, tokens); var storage = new Store(); value.Storage = storage;
                value.Journal = new TransactionJournal(storage); value.Markers = new RunStateStore(storage, value.Accounts, tokens);
                value.Native = new NativeWallet { Owner = value.Owner };
                var wallet = new WalletClient(value.Native); var identity = new ClientIdentity(wallet); value.Identity = identity; await identity.Connect();
                value.Http = new Http(protocol, plans, Fixture("runs"));
                var rpc = new SolanaRpcTransport(value.Http, "https://base.invalid/", "https://router.invalid/", value.Http.Genesis, protocol.ProgramId);
                var records = new SessionRecordStore(storage, tokens, protocol.ProgramId);
                var decoded = tokens.Decode(Envelope(plans["accounts"]["session"]));
                value.SessionValidUntil = decoded.ValidUntil; value.Now = (long)plans["inputs"]["now"];
                await records.Replace(await records.Load(value.Owner), new SessionRecords(value.Owner,
                    new SessionRecord(value.Owner, (string)plans["inputs"]["device"], (string)plans["accounts"]["session"]["address"], decoded.ValidUntil), null));
                Func<long> now = () => value.Now;
                var persistence = new RunPersistence(value.Markers);
                var reconciler = new RunInstructionReconciler(protocol, value.Accounts, planner, rpc, persistence.Accept);
                var executor = new TransactionExecutor(planner, rpc, wallet, value.Journal);
                value.Client = new RunClient(identity, new SessionAccess(wallet, records, tokens, rpc, protocol.ProgramId, now), value.Accounts,
                    planner, rpc, value.Markers, new RunRecovery(protocol.ProgramId, PlanningConstants.DelegationProgram, tokens, value.Accounts),
                    value.Journal, executor, reconciler, now, protocol);
                return value;
            }
        }
        private sealed class Store : IPublicClientStore
        {
            public Action AfterJournalComplete;
            private readonly Dictionary<string, string> values = new Dictionary<string, string>();
            public Task<string> Read(string owner, string field) { values.TryGetValue(owner + field, out string value); return Task.FromResult(value); }
            public Task Write(string owner, string field, string value) { values[owner + field] = value; return Task.CompletedTask; }
            public async Task<bool> CompareExchange(string owner, string field, string expected, string value)
            { if (await Read(owner, field) != expected) return false; values[owner + field] = value;
                if (field == "journal" && value == null) AfterJournalComplete?.Invoke(); return true; }
        }
        private sealed class NativeWallet : INativeWalletTransport
        {
            public string Owner; public bool HasKey = true; public int KeyLoads, OwnerPrompts; public byte SeedByte = 2;
            public Task<string> Request(string json)
            {
                var request = JObject.Parse(json); var result = new JObject { ["requestId"] = request["requestId"], ["ok"] = true, ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(Owner)) };
                if ((string)request["operation"] == "signTransactions")
                {
                    OwnerPrompts++; using var signer = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
                    result["transaction"] = Convert.ToBase64String(signer.PartialSign(Convert.FromBase64String((string)request["transaction"])));
                }
                return Task.FromResult(result.ToString());
            }
            public Task<byte[]> LoadDeviceSeed(string owner) { KeyLoads++; return Task.FromResult(HasKey ? Enumerable.Repeat(SeedByte, 32).ToArray() : null); }
            public Task<byte[]> CreateDeviceSeed(string owner) => throw new InvalidOperationException("No session creation in run recovery");
            public Task RemoveDeviceSeed(string owner) => throw new InvalidOperationException("No key deletion in run recovery");
        }
        private sealed class Http : IJsonRpcHttp
        {
            public readonly JObject Runs;
            private readonly JObject plans;
            private readonly ProtocolBindings protocol;
            public readonly Dictionary<string,string> States = new Dictionary<string,string> { ["daily"] = "playing" };
            public readonly HashSet<string> Delegated = new HashSet<string> { "daily" };
            public readonly List<string> Sent = new List<string>();
            public readonly List<string> SentFeePayers = new List<string>();
            public readonly List<string> SentTransactions = new List<string>();
            public int Requests;
            public bool Confirmed = true;
            public bool FailedOnChain, SuppressSendEffects, FailObservation;
            public ulong BlockHeight = 10000;
            public bool ChangedRules;
            public bool FailClaims;
            public bool AdvancePendingVrf, ConsumeAfterAction;
            public bool SuccessorAfterConsume;
            public bool RevokedSession, MalformedSession, FailSessionRead;
            public string MalformedFunding;
            public ulong ActualDeviceBalance = 1000000000;
            public int CopybackPolls; public Action AfterCopyback;
            private string commitWaiting, successorMode = "daily";
            private bool successorVisible, successorOpening;
            public ulong SignerBalance = 1000000000;
            public string Genesis = (string)Fixture("transport")["inputs"]["expectedGenesis"];
            private JToken player;
            public Http(ProtocolBindings protocol, JObject plans, JObject runs) { this.protocol = protocol; this.plans = plans; Runs = runs; player = runs["player"]; }
            public void Prepare(string mode) { player = Runs["initialPlayers"][mode]; States["daily"] = null; Delegated.Clear(); }
            public void ReplaceWithSuccessor(bool opening, bool delegated, string mode = "daily")
            {
                States[mode] = null; successorMode = mode; player = Runs["successors"][mode]["player"]; Delegated.Remove(mode);
                successorVisible = true; successorOpening = opening;
                if (delegated) Delegated.Add(mode + "-next"); else Delegated.Remove(mode + "-next");
            }
            public JToken Row(string mode, string state) => ChangedRules && mode == "daily" && state == "playing" ? Runs["rulesChanged"] :
                Runs["cases"].Single(row => (string)row["id"] == "active-" + mode + "-" + state);
            private string Mode(string address) => (string)Runs["successor"]["address"] == address ? successorMode + "-next" :
                (string)Row("daily", "playing")["address"] == address ? "daily" : "daily";
            private JToken Account(string address)
            {
                if (address == (string)plans["accounts"]["session"]["address"])
                {
                    if (FailSessionRead) throw new IOException("Synthetic session read unavailable");
                    if (RevokedSession) return JValue.CreateNull();
                }
                JToken source = address == (string)player["address"] ? player : ((JObject)plans["accounts"]).Properties().Where(property => property.Name != "expiredSession").Select(property => property.Value).SingleOrDefault(row => (string)row["address"] == address);
                foreach (string mode in new[] { "daily" })
                    if (address == (string)Row(mode, "playing")["address"])
                    {
                        source = States[mode] == null ? null : Row(mode, States[mode]);
                        if (AdvancePendingVrf && States[mode] == "awaitingVrf") States[mode] = "rerolled";
                    }
                if (address == (string)Runs["successor"]["address"] && successorVisible) source = successorOpening && successorMode == "daily" ? Runs["successorPrepared"] : Runs["successors"][successorMode]["run"];
                if (source != null) return new JObject { ["owner"] = MalformedSession && address == (string)plans["accounts"]["session"]["address"] ? PlanningConstants.SystemProgram : source["owner"], ["executable"] = false, ["lamports"] = 1000000000,
                    ["data"] = new JArray(source["data"], "base64") };
                if (address == (string)plans["inputs"]["device"]) return new JObject {
                    ["owner"] = MalformedFunding == "owner" ? protocol.ProgramId : PlanningConstants.SystemProgram,
                    ["executable"] = MalformedFunding == "executable",
                    ["lamports"] = MalformedFunding == "balance" ? 9007199254740992UL : SignerBalance,
                    ["data"] = new JArray(MalformedFunding == "data" ? "AA==" : "", "base64") };
                return JValue.CreateNull();
            }
            public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                await Task.Yield(); cancellation.ThrowIfCancellationRequested(); Requests++; var request = JObject.Parse(json); JToken result;
                JObject Context(JToken value) => new JObject { ["context"] = new JObject { ["slot"] = 10000 }, ["value"] = value };
                if (FailObservation && new[] { "getDelegationStatus", "getAccountInfo", "getMultipleAccounts" }.Contains((string)request["method"]))
                    throw new IOException("Synthetic post-confirmation observation unavailable");
                switch ((string)request["method"])
                {
                    case "getGenesisHash": result = new JValue(Genesis); break;
                    case "getAccountInfo": result = Context(Account((string)request["params"][0])); break;
                    case "getMultipleAccounts":
                        if (FailClaims && request["params"][0].Count() > 3 && !request["params"][0].Values<string>().Contains((string)player["address"]))
                            throw new IOException("Synthetic optional board batch unavailable");
                        result = Context(new JArray(request["params"][0].Values<string>().Select(Account))); break;
                    case "getMinimumBalanceForRentExemption": result = new JValue(890880); break;
                    case "getDelegationStatus":
                        string requestedMode = Mode((string)request["params"][0]);
                        if (commitWaiting == requestedMode && CopybackPolls > 0 && --CopybackPolls == 0)
                        { Delegated.Remove(commitWaiting); commitWaiting = null; AfterCopyback?.Invoke(); }
                        bool delegated = Delegated.Contains(requestedMode);
                        result = new JObject { ["isDelegated"] = delegated, ["fqdn"] = delegated ? "https://er.invalid/" : null }; break;
                    case "getIdentity": result = new JObject { ["identity"] = plans["inputs"]["validator"], ["fqdn"] = "https://er.invalid/" }; break;
                    case "getLatestBlockhash": result = Context(new JObject { ["blockhash"] = plans["inputs"]["blockhash"], ["lastValidBlockHeight"] = 11000 }); break;
                    case "getFeeForMessage": result = Context(new JValue(5000)); break;
                    case "getBalance": result = Context(new JValue((string)request["params"][0] == (string)plans["inputs"]["device"] ? ActualDeviceBalance : 1000000000UL)); break;
                    case "simulateTransaction": result = Context(new JObject { ["err"] = null, ["logs"] = new JArray(), ["unitsConsumed"] = 1 }); break;
                    case "sendTransaction":
                        byte[] bytes = Convert.FromBase64String((string)request["params"][0]);
                        SentTransactions.Add(Convert.ToBase64String(bytes));
                        SentFeePayers.Add(TransactionSignatures.Describe(bytes).FeePayer);
                        foreach (var instruction in TransactionSignatures.Describe(bytes).Instructions.Where(ix => ix.ProgramId == protocol.ProgramId))
                        {
                            var decoded = protocol.DecodeInstruction(instruction); Sent.Add(decoded.Name);
                            if (SuppressSendEffects) continue;
                            string mode = Mode(decoded.Accounts[decoded.Name == "delegate_active_run" ? "pda" : "active_run"]);
                            if (decoded.Name == "enter_arena") { States[mode] = "prepared"; player = Runs["preparedPlayers"][mode]; }
                            if (decoded.Name == "delegate_active_run") Delegated.Add(mode);
                            if (decoded.Name == "request_vrf") States[mode] = "playing";
                            if (decoded.Name == "request_reroll") States[mode] = "awaitingVrf";
                            if (decoded.Name == "request_reroll" && ConsumeAfterAction)
                                ReplaceWithSuccessor(false, true, mode);
                            if (decoded.Name == "finish_run") States[mode] = "finished";
                            if (decoded.Name == "commit_run") { if (CopybackPolls > 0) commitWaiting = mode; else Delegated.Remove(mode); }
                            if (decoded.Name.StartsWith("consume_", StringComparison.Ordinal))
                            { if (Delegated.Contains(mode)) throw new InvalidOperationException("Consumed before copy-back"); if (SuccessorAfterConsume) ReplaceWithSuccessor(true, true, mode); else { States[mode] = null; player = Runs["consumedPlayers"][mode]; } }
                        }
                        result = new JValue(TransactionSignatures.ValidateFullySigned(bytes)); break;
                    case "getSignatureStatuses": result = Context(new JArray { Confirmed ? new JObject { ["slot"] = 9999, ["confirmationStatus"] = "confirmed", ["err"] = FailedOnChain ? new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") } : null } : JValue.CreateNull() }); break;
                    case "getBlockHeight": result = new JValue(BlockHeight); break;
                    default: throw new InvalidOperationException("Unexpected offline RPC " + request["method"]);
                }
                return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString();
            }
        }
    }
}
