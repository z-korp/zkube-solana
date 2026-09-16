using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;

namespace ZKube.Integration.Planning
{
    // Pure planning only. Validated account observations and explicit player
    // intentions enter here; network access and signing remain with transport.
    public sealed class TransactionPlanner
    {
        private readonly ProtocolBindings protocol;
        private readonly SessionTokenBindings sessions;
        public TransactionPlanner(ProtocolBindings protocol, SessionTokenBindings sessions)
        { this.protocol = protocol; this.sessions = sessions; }
        private string Pda(params byte[][] seeds) => SolanaAddress.Derive(protocol.ProgramId, seeds, out _);
        private static byte[] Text(string value) => Encoding.UTF8.GetBytes(value);
        private static byte[] Key(string value) => SolanaAddress.Bytes(value);
        private static byte[] Number(ulong value, int length) { var bytes = new byte[length]; NativeWire.Write(bytes, 0, length, value); return bytes; }
        public string Player(string owner) => Pda(Text("player"), Key(owner));
        public string Daily(uint day) => Pda(Text("arena_daily"), Number(day, 4));
        public string ActiveRun(string owner, ulong runId) => Pda(Text("run"), Text("active"), Key(owner), Number(runId, 8));
        public string ArenaPlayer(string daily, string owner) => Pda(Text("arena_player"), Key(daily), Key(owner));
        public string Board(uint day, string kind) => kind == "score" || kind == "theme" ?
            Pda(Text("arena_board"), Key(Daily(day)), Text(kind)) : throw new ArgumentException("Invalid board kind");
        public string ProtocolAddress => Pda(Text("protocol"));
        public string ArcadeAddress => Pda(Text("arcade"));
        public string CreditVaultAddress => Pda(Text("credit_vault"));
        private Dictionary<string, string> ActorAccounts(PlannerActor actor) => new Dictionary<string, string> {
            ["owner_authority"] = actor.Owner, ["actor"] = actor.Signer, ["payer"] = actor.Signer,
            ["session_token"] = actor.SessionToken,
        };
        private SolanaInstruction Instruction(string name, JObject args, Dictionary<string, string> keys, IEnumerable<AccountMeta> remaining = null)
        {
            var instruction = protocol.Instruction(name, args, keys);
            return remaining == null ? instruction : new SolanaInstruction(instruction.ProgramId, instruction.Accounts.Concat(remaining), instruction.Data);
        }
        private TransactionPlan Plan(PlannerActor actor, PlanRoute route, IEnumerable<SolanaInstruction> instructions, ulong reserve = 0, ulong? runId = null) =>
            new TransactionPlan(route, actor.Owner, actor.Signer, instructions, reserve, runId);

        public TransactionPlan Purchase(string owner, uint count, string teamDestination)
        {
            if (count == 0) throw new ArgumentOutOfRangeException(nameof(count));
            return Plan(PlannerActor.Wallet(owner), PlanRoute.Base, new[] { Instruction("purchase_kredits",
                new JObject { ["kredit_count"] = count, ["expected_unit_lamports"] = Protocol.EntryLamports },
                new Dictionary<string, string> { ["protocol"] = ProtocolAddress, ["arcade_config"] = ArcadeAddress,
                    ["player_state"] = Player(owner), ["credit_vault"] = CreditVaultAddress,
                    ["team_destination"] = teamDestination, ["owner"] = owner }) });
        }

        public TransactionPlan SetFeaturedIdentity(PlannerActor actor, byte emblem, byte frame)
        {
            if (emblem > PlanningConstants.MaxEmblemId || frame > PlanningConstants.MaxFrameTier)
                throw new ArgumentOutOfRangeException("Featured identity is outside the supported catalog");
            var keys = ActorAccounts(actor); keys["player_state"] = Player(actor.Owner);
            return Plan(actor, PlanRoute.Base, new[] { Instruction("set_featured_emblem",
                new JObject { ["emblem_id"] = emblem, ["frame_tier"] = frame }, keys) });
        }

        public TransactionPlan Claim(PlannerActor actor, uint day, string kind, uint position)
        {
            if ((kind != "score" && kind != "theme") || position >= Protocol.ArenaBoardCapacity)
                throw new ArgumentException("Invalid board claim position");
            var keys = ActorAccounts(actor);
            keys["arena_daily"] = Daily(day); keys["arena_board"] = Board(day, kind); keys["player_state"] = Player(actor.Owner);
            return Plan(actor, PlanRoute.Base, new[] { Instruction("claim_daily_prize", new JObject {
                ["board"] = new JObject { [kind] = new JObject() }, ["position"] = position }, keys) });
        }

        public static IReadOnlyList<ValidatedBoardReward> SelectEntryClaims(IEnumerable<ValidatedBoardReward> candidates, string owner, uint currentDay, long now)
        {
            uint first = currentDay > PlanningConstants.ClaimLookbackDays ? currentDay - PlanningConstants.ClaimLookbackDays : 0;
            return Array.AsReadOnly(candidates.Where(c => c != null && c.Owner == owner && !c.Claimed &&
                    c.DayId >= first && c.DayId < currentDay && c.SealedAt > 0 &&
                    now <= checked(c.SealedAt + (long)Protocol.ClaimWindowSeconds))
                .OrderBy(c => c.SealedAt).ThenBy(c => c.DayId).ThenBy(c => c.Kind, StringComparer.Ordinal)
                .GroupBy(c => c.BoardAddress, StringComparer.Ordinal).Select(group => group.First())
                .Take(PlanningConstants.MaxAutoClaims).ToArray());
        }

        public static IReadOnlyList<ValidatedBoardReward> ReadEntryClaims(AccountBindings bindings, IEnumerable<BoardObservation> observations,
            string owner, uint currentDay, long now)
        {
            var candidates = new List<ValidatedBoardReward>();
            int count = 0;
            foreach (var observation in observations)
            {
                if (++count > PlanningConstants.ClaimLookbackDays * 2) return Array.Empty<ValidatedBoardReward>();
                if (observation?.Account == null) continue;
                try { candidates.AddRange(bindings.BoardRewards(observation.Account, observation.DayId, observation.Kind, owner)); }
                catch (FormatException) { /* Optional malformed claims never prevent entry. */ }
            }
            return SelectEntryClaims(candidates, owner, currentDay, now);
        }

        private static void RequireFreeSlot(PlannerActor actor, PlayerPlanSnapshot player, AccountEnvelope occupied)
        {
            if (player == null || player.Owner != actor.Owner) throw new ArgumentException("Missing matching player state");
            if (player.DailyRunId != 0) throw new InvalidOperationException("Resume the active run in this slot");
            if (occupied != null) throw new InvalidOperationException("Run ID is already occupied; reconcile before preparation");
            if (player.NextRunId == ulong.MaxValue) throw new InvalidOperationException("Run ID sequence exhausted");
        }

        public TransactionPlan RecordCampaignStars(PlannerActor actor, byte[] stars)
        {
            if (stars == null || stars.Length != 25) throw new ArgumentException("Campaign record requires 25 packed bytes");
            var keys = ActorAccounts(actor);
            keys["player_state"] = Player(actor.Owner);
            return Plan(actor, PlanRoute.Base, new[] { Instruction("record_campaign_stars",
                new JObject { ["stars"] = new JArray(stars.Select(value => (int)value)) }, keys) }, PlanningConstants.SettlementReserveLamports);
        }

        public TransactionPlan PrepareDaily(PlannerActor actor, PlayerPlanSnapshot player, DailyEntrySnapshot daily,
            IEnumerable<ValidatedBoardReward> rewards, long now, AccountEnvelope occupied = null)
        {
            RequireFreeSlot(actor, player, occupied);
            if (player.Kredits < 1) throw new InvalidOperationException("Buy a Kredit before entering Daily");
            var claims = SelectEntryClaims(rewards, actor.Owner, daily.DayId, now);
            var keys = ActorAccounts(actor);
            keys["protocol"] = ProtocolAddress; keys["arcade_config"] = ArcadeAddress;
            keys["player_state"] = Player(actor.Owner); keys["current_daily"] = Daily(daily.DayId);
            keys["following_daily"] = Daily(daily.FollowingDayId); keys["arena_player"] = ArenaPlayer(Daily(daily.DayId), actor.Owner);
            keys["credit_vault"] = CreditVaultAddress; keys["active_run"] = ActiveRun(actor.Owner, player.NextRunId);
            var remaining = claims.SelectMany(c => new[] { new AccountMeta(Daily(c.DayId), false, true), new AccountMeta(Board(c.DayId, c.Kind), false, true) });
            return Plan(actor, PlanRoute.Base, new[] { Instruction("enter_arena", new JObject { ["run_id"] = player.NextRunId,
                ["expected_entry_lamports"] = Protocol.EntryLamports, ["auto_claim_positions"] = new JArray(claims.Select(c => c.Position)) }, keys, remaining) }, runId: player.NextRunId);
        }

        public TransactionPlan Delegate(PlannerActor actor, ulong runId, string validator)
        {
            SolanaAddress.Bytes(validator);
            var active = ActiveRun(actor.Owner, runId); var keys = ActorAccounts(actor);
            keys["pda"] = active; keys["buffer_pda"] = Pda(Text("buffer"), Key(active));
            keys["delegation_record_pda"] = SolanaAddress.Derive(PlanningConstants.DelegationProgram, new[] { Text("delegation"), Key(active) }, out _);
            keys["delegation_metadata_pda"] = SolanaAddress.Derive(PlanningConstants.DelegationProgram, new[] { Text("delegation-metadata"), Key(active) }, out _);
            return Plan(actor, PlanRoute.Base, new[] { Instruction("delegate_active_run", new JObject(), keys,
                new[] { new AccountMeta(validator, false, false) }) }, PlanningConstants.SettlementReserveLamports, runId);
        }

        public TransactionPlan PrepareAndDelegate(TransactionPlan prepared, PlannerActor actor, string validator)
        {
            if (prepared.Route != PlanRoute.Base || prepared.RunId == null || prepared.Owner != actor.Owner ||
                prepared.FeePayer != actor.Signer || actor.SessionToken == null ||
                actor.SessionToken != sessions.Derive(actor.Owner, actor.Signer, protocol.ProgramId))
                throw new ArgumentException("Prepare and delegate do not share one device boundary");
            var delegated = Delegate(actor, prepared.RunId.Value, validator);
            return Plan(actor, PlanRoute.Base, prepared.Instructions.Concat(delegated.Instructions), PlanningConstants.SettlementReserveLamports, prepared.RunId);
        }

        public TransactionPlan RunAction(PlannerActor actor, RunPlanSnapshot run, string action, byte[] seed = null,
            byte row = 0, byte start = 0, byte destination = 0, byte column = 0)
        {
            if (actor.Owner != run.Owner) throw new ArgumentException("Run belongs to another owner");
            var keys = ActorAccounts(actor); keys["active_run"] = ActiveRun(run.Owner, run.RunId);
            var args = new JObject(); string instruction;
            switch (action)
            {
                case "vrf": instruction = "request_vrf"; break;
                case "move": instruction = "play_move"; args["expected_action"] = run.Summary.ActionCounter;
                    args["expected_move"] = run.Summary.Moves; args["row"] = row; args["start"] = start; args["destination"] = destination; break;
                case "bonus": instruction = "apply_bonus"; args["expected_action"] = run.Summary.ActionCounter;
                    args["row"] = row; args["column"] = column; break;
                case "reroll": instruction = "request_reroll"; args["expected_action"] = run.Summary.ActionCounter; break;
                case "finish": instruction = "finish_run"; args["reason"] = new JObject { ["abandon"] = new JObject() }; break;
                default: throw new ArgumentException("Unknown run action");
            }
            if (action != "finish")
            {
                if (seed == null || seed.Length != 32) throw new ArgumentException("VRF client seed must contain 32 bytes");
                // JSON.NET treats byte[] as one binary value. IDL fixed arrays
                // require one numeric token per byte for every VRF action.
                args["client_seed"] = new JArray(seed.Select(value => (int)value));
                keys["delegation_record_active"] = SolanaAddress.Derive(PlanningConstants.DelegationProgram,
                    new[] { Text("delegation"), Key(keys["active_run"]) }, out _);
                keys["program_identity"] = Pda(Text("identity"));
            }
            return Plan(actor, PlanRoute.ResolvedEr, new[] { Instruction(instruction, args, keys) }, runId: run.RunId);
        }

        public TransactionPlan Commit(PlannerActor actor, RunPlanSnapshot run)
        {
            if (actor.Owner != run.Owner) throw new ArgumentException("Run belongs to another owner");
            if (!run.Terminal) throw new InvalidOperationException("Wait for an accepted terminal run before committing");
            return Plan(actor, PlanRoute.ResolvedEr, new[] { Instruction("commit_run", new JObject(), new Dictionary<string, string> {
                ["payer"] = actor.Signer, ["active_run"] = ActiveRun(run.Owner, run.RunId) }) }, runId: run.RunId);
        }

        public TransactionPlan Consume(PlannerActor actor, RunPlanSnapshot run, bool abandonFirst = false)
        {
            if (actor.Owner != run.Owner) throw new ArgumentException("Run belongs to another owner");
            if (!abandonFirst && !run.Terminal) throw new InvalidOperationException("Wait for terminal copy-back before consuming");
            var list = new List<SolanaInstruction>();
            if (abandonFirst) list.AddRange(RunAction(actor, run, "finish").Instructions);
            var keys = new Dictionary<string, string> { ["active_run"] = ActiveRun(run.Owner, run.RunId),
                ["player_state"] = Player(run.Owner), ["rent_recipient"] = run.RentPayer, ["owner"] = run.Owner };
            keys["arena_daily"] = run.DailyAddress; keys["arena_player"] = ArenaPlayer(run.DailyAddress, run.Owner);
            list.Add(Instruction("consume_arena_run", new JObject(), keys));
            return Plan(actor, PlanRoute.Base, list, runId: run.RunId);
        }

        public TransactionPlan EnableSession(string owner, string device, long now)
        {
            var actor = PlannerActor.Wallet(owner); var keys = ActorAccounts(actor); keys["player_state"] = Player(owner);
            return Plan(actor, PlanRoute.Base, new[] { Instruction("initialize_player", new JObject(), keys),
                sessions.Create(owner, device, owner, protocol.ProgramId, true, checked(now + PlanningConstants.SessionLifetimeSeconds), PlanningConstants.DeviceAllowanceLamports) });
        }

        public TransactionPlan RefillSession(string owner, string device, ulong balance)
        {
            if (balance >= PlanningConstants.DeviceAllowanceLamports) throw new InvalidOperationException("Device signer does not need a refill");
            return Plan(PlannerActor.Wallet(owner), PlanRoute.Base, new[] {
                Transfer(owner, device, PlanningConstants.DeviceAllowanceLamports - balance), Transfer(device, owner, 0) });
        }

        public TransactionPlan RenewSession(string owner, string candidate, long now, AccountEnvelope oldToken,
            string oldDevice, ulong oldBalance)
        {
            if (candidate == oldDevice || now < 0 || now > 9007199254740991L - PlanningConstants.SessionLifetimeSeconds ||
                (oldDevice == null && oldBalance != 0)) throw new ArgumentException("Invalid session renewal inputs");
            var instructions = new List<SolanaInstruction>();
            if (oldToken != null)
            {
                var token = sessions.Decode(oldToken);
                if (token.Authority != owner || token.SessionSigner != oldDevice || token.FeePayer != owner || token.TargetProgram != protocol.ProgramId)
                    throw new ArgumentException("Previous session relationships are invalid");
                if (token.ValidUntil <= now) instructions.AddRange(RevokeExpiredSession(owner, oldToken, now).Instructions);
            }
            if (oldBalance != 0) instructions.Add(Transfer(oldDevice, owner, oldBalance));
            instructions.AddRange(EnableSession(owner, candidate, now).Instructions);
            return Plan(PlannerActor.Wallet(owner), PlanRoute.Base, instructions);
        }

        // Matches the current client: reclaim the allowance and delete the local
        // signer only after confirmation. The token remains until its expiry.
        public TransactionPlan RevokeSession(string owner, string device, ulong balance) => balance == 0 ? null :
            Plan(PlannerActor.Wallet(owner), PlanRoute.Base, new[] { Transfer(device, owner, balance) });

        public TransactionPlan RevokeExpiredSession(string payer, AccountEnvelope envelope, long now)
        {
            var token = sessions.Decode(envelope);
            if (token.TargetProgram != protocol.ProgramId || token.ValidUntil > now) throw new ArgumentException("Session is not expired");
            return Plan(PlannerActor.Wallet(payer), PlanRoute.Base, new[] { new SolanaInstruction(sessions.ProgramId,
                new[] { new AccountMeta(envelope.Address, false, true), new AccountMeta(token.FeePayer, false, true),
                    new AccountMeta(token.Authority, false, false), new AccountMeta(PlanningConstants.SystemProgram, false, false) },
                PlanningConstants.RevokeSessionDiscriminator) });
        }

        private static SolanaInstruction Transfer(string from, string to, ulong amount)
        {
            var data = new byte[12]; NativeWire.Write(data, 0, 4, 2); NativeWire.Write(data, 4, 8, amount);
            return new SolanaInstruction(PlanningConstants.SystemProgram, new[] { new AccountMeta(from, true, true), new AccountMeta(to, false, true) }, data);
        }
    }
}
