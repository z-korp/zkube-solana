using System;
using System.Collections.Generic;
using System.Linq;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Local
{
    public enum LocalActionKind { Move, Bonus, Reroll, Finish }
    public readonly struct LocalRunAction
    {
        public readonly LocalActionKind Kind;
        public readonly byte Row, Start, Destination, Reason;
        public LocalRunAction(LocalActionKind kind, byte row = 0, byte start = 0, byte destination = 0, byte reason = 3)
        { Kind = kind; Row = row; Start = start; Destination = destination; Reason = reason; }
    }
    public sealed class LocalDaily
    {
        public uint DayId { get; }
        public byte Realm { get; }
        public byte ObjectiveKind { get; }
        public byte ObjectiveValue { get; }
        public long OpensAt => (long)DayId * 86400;
        public long FreezesAt => ((long)DayId + 1) * 86400;
        internal LocalDaily(uint day, byte realm, byte kind, byte value)
        { DayId = day; Realm = realm; ObjectiveKind = kind; ObjectiveValue = value; }
    }
    public sealed class LocalRunView
    {
        private readonly CoreRunToken token;
        private readonly byte[] request;
        public string RunId { get; }
        public string Mode { get; }
        public byte Realm { get; }
        public byte Level { get; }
        public CoreRunToken Token => new CoreRunToken(token.Config, token.State);
        public BuildConfigRequest Rules => BuildConfigRequest.Decode(request);
        internal LocalRunView(string id, string mode, byte realm, byte level, CoreRunToken token, BuildConfigRequest rules)
        { RunId = id; Mode = mode; Realm = realm; Level = level; this.token = new CoreRunToken(token.Config, token.State); request = rules.Encode(); }
    }
    public sealed class LocalRunUpdate
    {
        private readonly (byte[] Config, byte[] Response)[] transitions;
        public LocalRunView View { get; }
        // Decode fresh copies so callers cannot mutate a queued accepted transition.
        public IReadOnlyList<RunTransition> Transitions => Array.AsReadOnly(transitions.Select(value => RunTransition.Decode(value.Config, value.Response)).ToArray());
        internal LocalRunUpdate(LocalRunView view, IEnumerable<(byte[] Config, byte[] Response)> transitions)
        { View = view; this.transitions = transitions.Select(value => ((byte[])value.Config.Clone(), (byte[])value.Response.Clone())).ToArray(); }
    }
}
