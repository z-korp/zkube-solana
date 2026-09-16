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
            Events = PresentationTrace.Decode(NativeWire.Bytes(response, 10 + stateLength, traceLength));
        }
    }

    public static class NativeEngine
    {
        [DllImport("zkube_core_ffi", CallingConvention = CallingConvention.Cdecl, EntryPoint = "zkube_core_call")]
        private static extern int Invoke(uint operation, [In] byte[] request, uint requestLength,
            [In, Out] byte[] response, uint capacity, ref uint written);

        [DllImport("zkube_core_ffi", CallingConvention = CallingConvention.Cdecl, EntryPoint = "zkube_core_abi_version")]
        public static extern uint AbiVersion();

        public static byte[] Call(uint operation, byte[] request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            // The generated response envelope bounds every operation.
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
            return Call(NativeOperation.LocalRowRandomness, NativeRequest.LocalRowRandomness(Seed: padded, SeedLength: checked((byte)seed.Length), Counter: counter));
        }

        public static byte[] BuildConfig(BuildConfigRequest input) => Call(NativeOperation.BuildConfig, input.Encode());

        public static DailyInfo Daily(uint day) => DailyInfo.Decode(
            Call(NativeOperation.Daily, NativeRequest.Daily(day)));

        public static int CompareBoardEntries(ulong leftMetric, long leftTime, byte[] leftOwner,
            ulong rightMetric, long rightTime, byte[] rightOwner)
        {
            byte[] LeftTime = new byte[8], RightTime = new byte[8];
            NativeWire.Write(LeftTime, 0, 8, unchecked((ulong)leftTime));
            NativeWire.Write(RightTime, 0, 8, unchecked((ulong)rightTime));
            return Call(NativeOperation.BoardOrder, NativeRequest.BoardOrder(LeftMetric: leftMetric, LeftTime: LeftTime, LeftOwner: leftOwner, RightMetric: rightMetric, RightTime: RightTime, RightOwner: rightOwner))[0] - 1;
        }

        public static CoreRunToken Initialize(BuildConfigRequest input)
        {
            var config = BuildConfig(input);
            return new CoreRunToken(config, Call(NativeOperation.Initialize, NativeRequest.Initialize(Config: config)));
        }

        public static CoreRunToken Reconcile(BuildConfigRequest config, ReconcileRequest snapshot)
            => Reconcile(BuildConfig(config), snapshot);

        public static CoreRunToken Reconcile(byte[] config, ReconcileRequest snapshot)
        {
            if (snapshot == null) throw new ArgumentNullException(nameof(snapshot));
            snapshot.Config = config;
            return new CoreRunToken(config, Call(NativeOperation.Reconcile, snapshot.Encode()));
        }

        public static RunSummary Summary(CoreRunToken token) => Summary(token.State);
        public static RunSummary Summary(byte[] state)
            => RunSummary.Decode(Call(NativeOperation.Summary, NativeRequest.Summary(State: state)));

        public static RunTransition ApplyVrf(CoreRunToken token, uint counter, byte[] output)
            => new RunTransition(token.Config, Call(NativeOperation.ApplyVrf, NativeRequest.ApplyVrf(Config: token.Config, State: token.State, Counter: counter, Output: output)));

        public static RunTransition PlayMove(CoreRunToken token, uint action, ushort expectedMove, byte row, byte start, byte destination)
            => new RunTransition(token.Config, Call(NativeOperation.PlayMove, NativeRequest.PlayMove(Config: token.Config, State: token.State, Action: action, ExpectedMove: expectedMove, Row: row, Start: start, Destination: destination)));

        public static RunTransition ApplyBonus(CoreRunToken token, uint action, byte row, byte column)
            => new RunTransition(token.Config, Call(NativeOperation.ApplyBonus, NativeRequest.ApplyBonus(Config: token.Config, State: token.State, Action: action, Row: row, Column: column)));

        public static RunTransition RequestReroll(CoreRunToken token, uint action)
            => new RunTransition(token.Config, Call(NativeOperation.RequestReroll, NativeRequest.RequestReroll(Config: token.Config, State: token.State, Action: action)));

        public static RunTransition Finish(CoreRunToken token, byte reason)
            => new RunTransition(token.Config, Call(NativeOperation.Finish, NativeRequest.Finish(Config: token.Config, State: token.State, Reason: reason)));

        public static CampaignProgressSummary CampaignProgress(byte[] stars, byte[] incoming = null) => CampaignProgressSummary.Decode(
            Call(NativeOperation.CampaignProgress, NativeRequest.CampaignProgress(stars, incoming ?? new byte[25])));
        public static CampaignProgressSummary RecordLocalCampaignResult(byte[] stars, byte realm, byte level, CoreRunToken token) =>
            CampaignProgressSummary.Decode(Call(NativeOperation.RecordLocalCampaignResult,
                NativeRequest.RecordLocalCampaignResult(stars, realm, level, token.State)));
        public static BuildConfigRequest CampaignRules(byte realm, byte level)
        {
            if (realm < 1 || realm > Protocol.Realms.Length) throw new ArgumentOutOfRangeException(nameof(realm));
            var definition = Protocol.Realms[realm - 1];
            if (level < 1 || level > definition.Levels.Length) throw new ArgumentOutOfRangeException(nameof(level));
            var authored = definition.Levels[level - 1];
            return BuildConfigRequest.Decode(Call(NativeOperation.CampaignRules, NativeRequest.CampaignRules(Realm: realm, Level: level, Tier: authored.Tier, Primary: authored.Primary, Secondary: authored.Secondary)));
        }

        public static ushort CampaignMoveBudget(byte level, byte tier)
            => checked((ushort)NativeWire.Read(Call(NativeOperation.CampaignMoveBudget, NativeRequest.CampaignMoveBudget(Level: level, Tier: tier)), 0, 2));

        public static uint LadderPoints(uint qualified, uint rank)
            => checked((uint)NativeWire.Read(Call(NativeOperation.LadderPoints, NativeRequest.LadderPoints(Qualified: qualified, Rank: rank)), 0, 4));

        public static byte LadderTier(ulong points)
            => Call(NativeOperation.LadderTier, NativeRequest.LadderTier(Points: points))[0];

        public static ulong LadderTierFloor(byte tier)
            => NativeWire.Read(Call(NativeOperation.LadderTierFloor, NativeRequest.LadderTierFloor(Tier: tier)), 0, 8);

        public static byte[] BoardPools(ulong pool, uint themeQualified)
            => Call(NativeOperation.DailyBoardPools, NativeRequest.DailyBoardPools(Pool: pool, ThemeQualified: themeQualified));
        public static byte[] BoardWidth(ulong pool, uint qualified)
            => Call(NativeOperation.BoardWidth, NativeRequest.BoardWidth(Pool: pool, Qualified: qualified));
        public static ulong PayoutForRank(ulong pool, byte[] denominator, uint rank)
            => NativeWire.Read(Call(NativeOperation.PayoutForRank, NativeRequest.PayoutForRank(Pool: pool, Denominator: denominator, Rank: rank)), 0, 8);
    }
}
