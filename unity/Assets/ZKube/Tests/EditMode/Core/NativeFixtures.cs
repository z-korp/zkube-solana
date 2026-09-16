using System;
using System.IO;
using UnityEngine;

namespace ZKube.Core.Tests
{
    public static class NativeFixtures
    {
        [Serializable] public sealed class Trajectories { public int schemaVersion; public string coreVersion; public Trajectory[] cases; public LocalRandomness[] localRandomness; public Step[] campaignBoundary; public Step[] dailyBoundary, protocolQueries; }
        [Serializable] public sealed class LocalRandomness { public string seedHex, outputHex; public uint counter; }
        [Serializable] public sealed class Trajectory { public string name; public string origin; public string configHex; public string initialStateHex; public string finalStateHex; public string finalReplayHex; public Step[] steps; }
        [Serializable] public sealed class Step { public uint operation, day; public string requestHex; public string responseHex; public Gesture gesture; }
        [Serializable] public sealed class Gesture { public uint operation; public byte row, start, destination, column, reason; public string output; }
        private static readonly Lazy<Trajectories> data = new Lazy<Trajectories>(() =>
            JsonUtility.FromJson<Trajectories>(File.ReadAllText(Path.Combine(Application.dataPath, "../../fixtures/native-run-trajectories.json"))));
        public static Trajectories Data => data.Value;
    }
}
