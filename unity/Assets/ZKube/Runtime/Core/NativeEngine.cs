using System;
using System.Runtime.InteropServices;
using ZKube.Core.Generated;

namespace ZKube.Core
{
    public sealed class NativeEngineException : Exception
    {
        public NativeStatus Status { get; }
        public NativeEngineException(NativeStatus status) : base("Native engine rejected operation: " + status)
        { Status = status; }
    }

    // Opaque snapshots. Only the native engine constructs or validates their bytes.
    public sealed class CoreRunToken
    {
        public byte[] Config { get; }
        public byte[] State { get; }
        public CoreRunToken(byte[] config, byte[] state)
        {
            if (config == null || config.Length != NativeSchema.RunConfigLength ||
                state == null || state.Length != NativeSchema.RunStateLength)
                throw new ArgumentException("Invalid native run token length");
            Config = (byte[])config.Clone();
            State = (byte[])state.Clone();
        }
    }

    public sealed class RunTransition
    {
        public CoreRunToken Token { get; }
        public PresentationEvent[] Events { get; }
        public bool TraceIncluded { get; }
        public static RunTransition Decode(byte[] config, byte[] response) => new RunTransition(config, response);
        internal RunTransition(byte[] config, byte[] response)
        {
            if (response.Length < 10 || NativeWire.Read(response, 0, 2) != NativeSchema.AbiVersion)
                throw new ArgumentException("Invalid native transition version");
            var stateLength = checked((int)NativeWire.Read(response, 2, 4));
            var traceLength = checked((int)NativeWire.Read(response, 6, 4));
            if (stateLength != NativeSchema.RunStateLength || traceLength != response.Length - 10 - stateLength)
                throw new ArgumentException("Invalid native transition length");
            Token = new CoreRunToken(config, NativeWire.Bytes(response, 10, stateLength));
            TraceIncluded = traceLength != 0;
            Events = PresentationTrace.Decode(NativeWire.Bytes(response, 10 + stateLength, traceLength));
        }
    }

    public static class NativeEngine
    {
        [DllImport("zkube_core_ffi", CallingConvention = CallingConvention.Cdecl, EntryPoint = "zkube_core_call")]
        private static extern int Invoke(uint operation, [In] byte[] request, uint requestLength,
            [In, Out] byte[] response, uint capacity, ref uint written);

        public static byte[] Call(uint operation, byte[] request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (NativeCore.AbiVersion() != NativeSchema.AbiVersion || NativeCore.RunStateLength() != NativeSchema.RunStateLength)
                throw new InvalidOperationException("Native engine and generated client versions differ");
            // Generated conservative envelope: no size-query double execution on input.
            var output = new byte[NativeSchema.ResponseCapacity];
            uint written = 0;
            var status = (NativeStatus)Invoke(operation, request, checked((uint)request.Length), output,
                checked((uint)output.Length), ref written);
            if (status != NativeStatus.Success) throw new NativeEngineException(status);
            if (written > output.Length) throw new InvalidOperationException("Native output exceeded capacity");
            return NativeWire.Bytes(output, 0, checked((int)written));
        }

        public static byte[] LocalRowRandomness(byte[] seed, uint counter)
        {
            if (seed == null || seed.Length > 32) throw new ArgumentException("Local seed exceeds 32 bytes", nameof(seed));
            var padded = new byte[32]; seed.CopyTo(padded, 0);
            return Call(LocalRowRandomnessRequest.Operation, new LocalRowRandomnessRequest {
                Seed = padded, SeedLength = checked((byte)seed.Length), Counter = counter
            }.Encode());
        }

        public static byte[] BuildConfig(BuildConfigRequest input) => Call(BuildConfigRequest.Operation, input.Encode());

        public static byte[] MergeCampaignStars(byte[] stored, byte[] incoming)
            => Call(MergeCampaignStarsRequest.Operation, new MergeCampaignStarsRequest { Stored = stored, Incoming = incoming }.Encode());

        public static CoreRunToken Initialize(BuildConfigRequest input)
        {
            var config = BuildConfig(input);
            return new CoreRunToken(config, Call(InitializeRequest.Operation, new InitializeRequest { Config = config }.Encode()));
        }

        public static CoreRunToken Reconcile(BuildConfigRequest config, ReconcileRequest snapshot)
            => Reconcile(BuildConfig(config), snapshot);

        public static CoreRunToken Reconcile(byte[] config, ReconcileRequest snapshot)
        {
            if (snapshot == null) throw new ArgumentNullException(nameof(snapshot));
            snapshot.Config = config;
            return new CoreRunToken(config, Call(ReconcileRequest.Operation, snapshot.Encode()));
        }

        public static RunSummary Summary(CoreRunToken token) => Summary(token.State);
        public static RunSummary Summary(byte[] state)
            => RunSummary.Decode(Call(SummaryRequest.Operation, new SummaryRequest { State = state }.Encode()));

        public static RunTransition ApplyVrf(CoreRunToken token, uint counter, byte[] output, bool trace = true)
            => new RunTransition(token.Config, Call(ApplyVrfRequest.Operation, new ApplyVrfRequest
            { Config = token.Config, State = token.State, Trace = trace ? (byte)1 : (byte)0, Counter = counter, Output = output }.Encode()));

        public static RunTransition PlayMove(CoreRunToken token, uint action, ushort expectedMove, byte row, byte start, byte destination, bool trace = true)
            => new RunTransition(token.Config, Call(PlayMoveRequest.Operation, new PlayMoveRequest
            { Config = token.Config, State = token.State, Trace = trace ? (byte)1 : (byte)0, Action = action,
                ExpectedMove = expectedMove, Row = row, Start = start, Destination = destination }.Encode()));

        public static RunTransition ApplyBonus(CoreRunToken token, uint action, byte row, byte column, bool trace = true)
            => new RunTransition(token.Config, Call(ApplyBonusRequest.Operation, new ApplyBonusRequest
            { Config = token.Config, State = token.State, Trace = trace ? (byte)1 : (byte)0, Action = action, Row = row, Column = column }.Encode()));

        public static RunTransition RequestReroll(CoreRunToken token, uint action, bool trace = true)
            => new RunTransition(token.Config, Call(RequestRerollRequest.Operation, new RequestRerollRequest
            { Config = token.Config, State = token.State, Trace = trace ? (byte)1 : (byte)0, Action = action }.Encode()));

        public static RunTransition Finish(CoreRunToken token, byte reason, bool trace = true)
            => new RunTransition(token.Config, Call(FinishRequest.Operation, new FinishRequest
            { Config = token.Config, State = token.State, Trace = trace ? (byte)1 : (byte)0, Reason = reason }.Encode()));

        public static DailyPair DailyPair(uint day) => Generated.DailyPair.Decode(
            Call(DailyPairIndexRequest.Operation, new DailyPairIndexRequest { Day = day }.Encode()));

        public static byte[] PackCampaignStars(byte[] stars) => Call(PackCampaignStarsRequest.Operation,
            new PackCampaignStarsRequest { Stars = stars }.Encode());
        public static CampaignProgressSummary CampaignProgress(byte[] packed) => CampaignProgressSummary.Decode(
            Call(CampaignProgressRequest.Operation, new CampaignProgressRequest { Stars = packed }.Encode()));
        public static byte[] RecordLocalCampaignResult(byte[] packed, byte realm, byte level, CoreRunToken token) =>
            Call(RecordLocalCampaignResultRequest.Operation, new RecordLocalCampaignResultRequest {
                Stars = packed, Realm = realm, Level = level, State = token.State
            }.Encode());
        public static BuildConfigRequest CampaignRules(byte realm, byte level)
        {
            if (realm < 1 || realm > Protocol.Realms.Length) throw new ArgumentOutOfRangeException(nameof(realm));
            var definition = Protocol.Realms[realm - 1];
            if (level < 1 || level > definition.Levels.Length) throw new ArgumentOutOfRangeException(nameof(level));
            var authored = definition.Levels[level - 1];
            return BuildConfigRequest.Decode(Call(CampaignRulesRequest.Operation, new CampaignRulesRequest {
                Realm = realm, Level = level, Tier = authored.Tier, Primary = authored.Primary, Secondary = authored.Secondary
            }.Encode()));
        }

        public static ushort CampaignMoveBudget(byte level, byte tier)
            => checked((ushort)NativeWire.Read(Call(CampaignMoveBudgetRequest.Operation, new CampaignMoveBudgetRequest { Level = level, Tier = tier }.Encode()), 0, 2));

        public static uint LadderPoints(uint qualified, uint rank)
            => checked((uint)NativeWire.Read(Call(LadderPointsRequest.Operation, new LadderPointsRequest { Qualified = qualified, Rank = rank }.Encode()), 0, 4));

        public static byte LadderTier(ulong points)
            => Call(LadderTierRequest.Operation, new LadderTierRequest { Points = points }.Encode())[0];

        public static ulong LadderTierFloor(byte tier)
            => NativeWire.Read(Call(LadderTierFloorRequest.Operation, new LadderTierFloorRequest { Tier = tier }.Encode()), 0, 8);

        public static byte[] BoardPools(ulong pool, uint themeQualified)
            => Call(DailyBoardPoolsRequest.Operation, new DailyBoardPoolsRequest { Pool = pool, ThemeQualified = themeQualified }.Encode());
        public static byte[] BoardWidth(ulong pool, uint qualified)
            => Call(BoardWidthRequest.Operation, new BoardWidthRequest { Pool = pool, Qualified = qualified }.Encode());
        public static ulong PayoutForRank(ulong pool, byte[] denominator, uint rank)
            => NativeWire.Read(Call(PayoutForRankRequest.Operation, new PayoutForRankRequest { Pool = pool, Denominator = denominator, Rank = rank }.Encode()), 0, 8);
    }
}
