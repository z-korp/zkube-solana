using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Integration.Client;
using ZKube.Integration.Tests;
using ZKube.Integration.Planning;

namespace ZKube.Integration.App.Tests
{
    public sealed class HeldCall
    {
        public readonly TaskCompletionSource<bool> Started = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource<bool> Completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task Entered => Started.Task;
        public void Release() => Completion.TrySetResult(true);
    }

    public sealed partial class MoneyTestEnvironment
    {
        public sealed class Call { public string Operation; }
        public IReadOnlyList<Call> Calls => Http.Requests.ToArray().Select(row => new Call { Operation = (string)row["method"] })
            .Concat(Native.Operations.ToArray().Concat(observations).Select(value => new Call { Operation = value })).ToArray();
        private readonly List<string> observations = new List<string>();
        private int forbidden;
        public int ForbiddenCalls => forbidden;
        public string UiScenario { get; private set; }
        public Func<long> Clock => () => Now;
        public string SentSignature { get; private set; }
        public bool HasActiveKey => Native.Seed != null;
        public bool HasCandidateKey => Native.Candidate != null;
        public uint KreditPack { get; private set; } = 1;
        public uint ClaimDay => (uint)Ui["claimDay"];
        public uint ClaimPoints => (uint)claim["points"];
        public ulong ClaimAmount => (ulong)claim["amountLamports"];
        public bool Consumed { get; private set; }
        private JObject Ui;
        private JToken expected, claim;
        private readonly List<JToken> after = new List<JToken>();
        private bool applied, failReadback, corruptReadback;
        private HeldCall walletHold;

        public static async Task<MoneyTestEnvironment> Create(string scenario)
        {
            var value = new MoneyTestEnvironment();
            await value.ConfigureScenario(scenario);
            return value;
        }

        private async Task ConfigureScenario(string scenario)
        {
            UiScenario = scenario; Ui = Fixture("ui");
            Http.Blockhash = (string)Plans["inputs"]["blockhash"];
            if (scenario == "public-disconnected" || scenario == "campaign-playable") return;
            if (scenario == "owner-overview" || scenario == "pending-confirmed-failure")
            {
                UseDailyRun();
                if (scenario.StartsWith("pending-"))
                { Http.Confirmation = "processed"; await Services.Journal.Begin(Purchase()); }
                return;
            }
            AddEconomy(); Http.Add(Plans["accounts"]["player"]);
            if (scenario.Contains("pending")) Http.Confirmation = "processed";
            if (scenario.Contains("failed-enable")) Http.StatusError = new JArray("InstructionError", 0);
            if (scenario.StartsWith("kredit-"))
            {
                if (scenario.StartsWith("kredit-buy-")) KreditPack = uint.Parse(scenario.Substring("kredit-buy-".Length));
                expected = Solana["transactions"].Single(row => (string)row["id"] == "purchase-" + KreditPack);
                after.Add(Ui["purchases"].Single(row => (uint)row["pack"] == KreditPack)["player"]);
                return;
            }
            if (!scenario.Contains("missing-session") && !scenario.StartsWith("session-enable") &&
                scenario != "session-owner-decline" && scenario != "session-fee-shortage" && scenario != "session-failed-enable")
                await ReadySession();
            if (scenario == "daily-playable")
            { Http.Add(Plans["accounts"]["following"]); return; }
            if (scenario.StartsWith("profile-"))
            {
                Http.Add(scenario == "profile-fresh" ? Ui["fresh"] : scenario == "profile-auto" ? Ui["profiles"][0]["player"] : Ui["profile"]);
                byte emblem = 8, border = 3;
                if (scenario == "profile-auto") { emblem = 0; border = 0; }
                if (scenario == "profile-border-only") emblem = 0;
                if (scenario == "profile-explicit-auto-target") { emblem = 12; border = 0; }
                expected = Ui["profiles"].Single(row => (byte)row["emblem"] == emblem && (byte)row["border"] == border)["transaction"];
                if (scenario == "profile-superseded") { emblem = 10; border = 4; }
                after.Add(Ui["profiles"].Single(row => (byte)row["emblem"] == emblem && (byte)row["border"] == border)["player"]);
                return;
            }
            if (scenario.StartsWith("claim-"))
            {
                Http.Add(Ui["profile"]); Http.Add(Ui["claimDaily"]);
                string kind = scenario.Split('-')[1], variant = scenario.Substring(("claim-" + kind + "-").Length);
                if (variant.StartsWith("pending-") || variant == "missing-session") variant = "sealed";
                foreach (string board in new[] { "score", "theme" })
                {
                    var row = Ui["claims"].Single(value => (string)value["kind"] == board && (string)value["variant"] == (board == kind ? variant : "sealed"));
                    Http.Add(row["before"]);
                    if (board == kind) claim = row;
                }
                expected = claim["transaction"]; after.Add(claim["after"]); after.Add(claim["playerAfter"]);
                return;
            }
            if (scenario.StartsWith("session-"))
            {
                UseDailyRun();
                if (scenario == "session-current" || scenario.Contains("refill")) {
                    Http.Add(Ui["currentToken"]);
                    var token = Services.Tokens.Decode(Envelope(Ui["currentToken"]));
                    await Services.Sessions.Replace(await Services.Sessions.Load(Owner), new SessionRecords(Owner,
                        new SessionRecord(Owner, (string)Plans["inputs"]["device"], (string)Ui["currentToken"]["address"], token.ValidUntil), null));
                }
                if (scenario.Contains("refill") || scenario.EndsWith("-zero")) SetBalance((string)Plans["inputs"]["device"], 0);
                if (scenario.Contains("refill"))
                { after.Add(SystemAccount((string)Plans["inputs"]["device"], 5_000_000)); }
                else if (!scenario.Contains("disable") && scenario != "session-current")
                {
                    after.Add(Ui["renewedToken"]);
                    after.Add(SystemAccount((string)Fixture("device")["inputs"]["candidate"], 5_000_000));
                }
            }
        }

        private static JObject SystemAccount(string address, ulong balance) => new JObject {
            ["address"] = address, ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["lamports"] = balance, ["data"] = "" };
        private void SetBalance(string address, ulong balance) => Http.Add(SystemAccount(address, balance));
        public void AdvanceClock(long seconds) { Assert.That(seconds, Is.GreaterThan(0)); Now += seconds; }
        public HeldCall HoldNextRead(string method)
        {
            var hold = new HeldCall(); Http.DelayMethod = method; Http.Entered = hold.Started; Http.Release = hold.Completion; return hold;
        }
        public HeldCall HoldNextWallet() => walletHold = new HeldCall();
        public void ConfirmPendingSuccess() { Http.Confirmation = "confirmed"; Http.StatusError = null; ApplyAfter(); }
        public void ConfirmPendingFailure() { Http.Confirmation = "confirmed"; Http.StatusError = new JArray("InstructionError", 0); }
        public void FailFirstReadAfterJournalClear() => failReadback = true;
        public void CorruptFirstReadAfterJournalClear() { failReadback = true; corruptReadback = true; }
        private void ApplyAfter()
        {
            if (applied || SentSignature == null || Http.StatusError != null) return;
            foreach (var row in after) Http.Add(row); applied = true;
        }
        private async Task<string> SignOwner(JObject request)
        {
            if (UiScenario.StartsWith("profile-") || UiScenario.StartsWith("claim-"))
            { forbidden++; throw new InvalidOperationException("Unexpected owner signature"); }
            var hold = walletHold; walletHold = null;
            if (hold != null) { hold.Started.TrySetResult(true); await hold.Completion.Task; }
            var result = new JObject { ["requestId"] = request["requestId"], ["owner"] = request["owner"], ["ok"] = !UiScenario.Contains("owner-decline") };
            if (!(bool)result["ok"]) result["error"] = "wallet-rejected";
            else
            {
                using var signer = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
                result["transaction"] = Convert.ToBase64String(signer.PartialSign(Convert.FromBase64String((string)request["transaction"])));
            }
            return result.ToString();
        }
        private static JObject Context(JToken value) => new JObject { ["context"] = new JObject { ["slot"] = 1000 }, ["value"] = value };
        private async Task<JToken> UiResponse(JObject request)
        {
            string method = (string)request["method"];
            if (failReadback && SentSignature != null && Http.Confirmation == "confirmed" &&
                (method == "getAccountInfo" || method == "getMultipleAccounts") && await Services.Journal.Load(Owner) == null)
            {
                failReadback = false;
                if (corruptReadback)
                {
                    string target = (string)Ui["renewedToken"]["address"];
                    bool single = method == "getAccountInfo";
                    var addresses = single ? new[] { (string)request["params"][0] } : request["params"][0].Values<string>().ToArray();
                    if (!addresses.Contains(target)) { failReadback = true; return null; }
                    observations.Add("injected-token-owner-after-journal-clear");
                    var values = new JArray(addresses.Select(address => Http.Accounts.TryGetValue(address, out var row)
                        ? (JToken)new JObject { ["owner"] = address == target ? new JValue(Owner) : row["owner"],
                            ["executable"] = row["executable"], ["lamports"] = row["lamports"] ?? new JValue(5_000_000),
                            ["data"] = new JArray(row["data"], "base64") } : JValue.CreateNull()));
                    return Context(single ? values[0] : values);
                }
                else throw new System.IO.IOException("Injected readback failure after acknowledgement");
            }
            switch (method)
            {
                case "getIdentity": return new JObject { ["identity"] = Http.Validator, ["fqdn"] = Http.Er };
                case "getLatestBlockhash": return Context(new JObject { ["blockhash"] = Http.Blockhash, ["lastValidBlockHeight"] = 500 });
                case "getFeeForMessage":
                    if (expected != null) ProgramScenarios.EquivalentMessages((string)request["params"][0], (string)expected["message"]);
                    return Context(new JValue(5400));
                case "getBalance":
                    string address = (string)request["params"][0];
                    ulong balance = address == Owner ? 10_000_000_000 : Http.Accounts.TryGetValue(address, out var account) ? (ulong?)account["lamports"] ?? 0 : 0;
                    return Context(new JValue(UiScenario.Contains("fee-shortage") ? 0 : balance));
                case "simulateTransaction": return Context(new JObject { ["err"] = null, ["logs"] = new JArray(), ["unitsConsumed"] = 1000 });
                case "sendTransaction":
                    var bytes = Convert.FromBase64String((string)request["params"][0]);
                    string signature = TransactionSignatures.ValidateFullySigned(bytes);
                    var pending = await Services.Journal.Load(Owner);
                    Assert.That(pending, Is.Not.Null); Assert.That(pending.Transaction, Is.EqualTo(bytes));
                    SentSignature = signature;
                    if (Http.Confirmation == "confirmed") ApplyAfter();
                    if (UiScenario == "daily-playable") AcceptDaily(bytes);
                    return new JValue(signature);
                default: return null;
            }
        }

        private void AcceptDaily(byte[] bytes)
        {
            var instructions = TransactionSignatures.Describe(bytes).Instructions
                .Where(value => value.ProgramId == Services.Protocol.ProgramId).Select(Services.Protocol.DecodeInstruction).ToArray();
            string phase;
            if (instructions.Any(value => value.Name == "enter_arena"))
            { Http.Add(Ui["enteredPlayer"]); phase = "playing"; }
            else if (instructions.Any(value => value.Name == "request_reroll")) phase = "rerolled";
            else if (instructions.Any(value => value.Name == "finish_run")) phase = "finished";
            else if (instructions.Any(value => value.Name == "consume_arena_run"))
            {
                Http.Add(Ui["consumedPlayer"]); Consumed = true;
                string address = (string)Runs["cases"][0]["address"];
                Http.Accounts.Remove(address); Http.Delegated.Remove(address); return;
            }
            else throw new InvalidOperationException("Unexpected Daily test transaction: " + string.Join(",", instructions.Select(value => value.Name)));
            var row = Runs["cases"].Single(value => (string)value["id"] == "active-daily-" + phase);
            Http.Add(row);
            if (phase == "finished") Http.Delegated.Remove((string)row["address"]);
            else Http.Delegated.Add((string)row["address"]);
        }
    }
}
