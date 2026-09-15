using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    // The PlayMode driver reads Rust trajectories and uses ordinary board input.
    public sealed class BoardHarness : MonoBehaviour
    {
        [Serializable] public sealed class Fixture
        {
            public string name, configRequestHex, configHex, initialStateHex;
            public byte realmId;
            public Step[] steps;
        }
        [Serializable] public sealed class Step
        {
            public uint operation, counter, action;
            public byte row, start, destination, column, reason;
            public string output;
        }
        [Serializable] private sealed class RawList { public RawFixture[] cases; }
        [Serializable] private sealed class RawFixture
        {
            public string name, configHex, initialStateHex;
            public RawStep[] steps;
        }
        [Serializable] private sealed class RawStep { public uint operation; public string requestHex; }
        public BoardController Board { get; private set; }
        public Fixture Current { get; private set; }
        public bool AutoStart = true;
        private int journeyCursor;
        public static Fixture[] Fixtures => JsonUtility.FromJson<RawList>(File.ReadAllText(
            Path.Combine(Application.dataPath, "../../fixtures/native-run-trajectories.json"))).cases.Select(ReadFixture).ToArray();

        private static Fixture ReadFixture(RawFixture raw)
        {
            var authored = raw.name.StartsWith("realm-", StringComparison.Ordinal);
            return new Fixture {
                name = raw.name, configHex = raw.configHex, initialStateHex = raw.initialStateHex,
                configRequestHex = raw.steps.First(s => s.operation == BuildConfigRequest.Operation).requestHex,
                // Synthetic probes use Balam's visual composition explicitly.
                realmId = authored ? byte.Parse(raw.name.Split('-')[1]) : (byte)8,
                steps = raw.steps.Select(ReadStep).Where(s => s != null).ToArray()
            };
        }
        private static Step ReadStep(RawStep raw)
        {
            var bytes = Hex(raw.requestHex);
            switch (raw.operation)
            {
                case ApplyVrfRequest.Operation:
                    var vrf = ApplyVrfRequest.Decode(bytes);
                    return vrf.Trace == 0 ? null : new Step { operation = raw.operation, counter = vrf.Counter,
                        output = BitConverter.ToString(vrf.Output).Replace("-", "") };
                case PlayMoveRequest.Operation:
                    var move = PlayMoveRequest.Decode(bytes);
                    return move.Trace == 0 ? null : new Step { operation = raw.operation, action = move.Action,
                        row = move.Row, start = move.Start, destination = move.Destination };
                case ApplyBonusRequest.Operation:
                    var bonus = ApplyBonusRequest.Decode(bytes);
                    return bonus.Trace == 0 ? null : new Step { operation = raw.operation, action = bonus.Action,
                        row = bonus.Row, column = bonus.Column };
                case RequestRerollRequest.Operation:
                    var reroll = RequestRerollRequest.Decode(bytes);
                    return reroll.Trace == 0 ? null : new Step { operation = raw.operation, action = reroll.Action };
                case FinishRequest.Operation:
                    var finish = FinishRequest.Decode(bytes);
                    return finish.Trace == 0 ? null : new Step { operation = raw.operation, reason = finish.Reason };
                default: return null;
            }
        }
        private void Start()
        {
            Board = GetComponent<BoardController>();
            if (AutoStart) Load("realm-8-daily");
        }
        public void Load(string name)
        {
            Board = GetComponent<BoardController>();
            if (Board.Busy) throw new InvalidOperationException("Wait for the accepted action before loading another fixture");
            Current = Fixtures.Single(f => f.name == name); journeyCursor = 0;
            var config = BuildConfigRequest.Decode(Hex(Current.configRequestHex));
            var token = new CoreRunToken(Hex(Current.configHex), Hex(Current.initialStateHex));
            Board.Bind(new BoardSession(token, config, new OfflineActions(Current), "", Current.realmId));
        }

        public IEnumerator PlayNextInput()
        {
            while (!Board.Ready || Board.Busy) yield return null;
            while (journeyCursor < Current.steps.Length && Current.steps[journeyCursor].operation == ApplyVrfRequest.Operation) journeyCursor++;
            if (journeyCursor >= Current.steps.Length) yield break;
            var step = Current.steps[journeyCursor++];
            if (step.operation == PlayMoveRequest.Operation)
            {
                int width = Board.View.DisplayGrid[step.row * 8 + step.start];
                var from = Board.View.Layout.CellCenter(step.row, step.start, width);
                var to = Board.View.Layout.CellCenter(step.row, step.destination, width);
                yield return Drag(from, to);
            }
            else if (step.operation == ApplyBonusRequest.Operation)
            {
                Click("Guardian action");
                var position = Board.View.Layout.CellCenter(step.row, step.column);
                Tap(position);
            }
            else if (step.operation == RequestRerollRequest.Operation) Click("Reroll action");
            else if (step.operation == FinishRequest.Operation && step.reason == 3)
            {
                Click("Pause"); yield return null; Click("Dialog End run"); yield return null; Click("Dialog End run");
            }
            else if (step.operation == FinishRequest.Operation)
                throw new InvalidOperationException("Deadline is external; bind its accepted state separately");
            while (Board.Busy) yield return null;
            yield return null;
        }
        public IEnumerator Drag(Vector2 from, Vector2 to) => TestBoardPointer.Drag(from, to);
        public void Click(string name) => TestBoardPointer.Click(
            Board.View.GetComponentsInChildren<Button>().Single(button => button.name == name && button.isActiveAndEnabled));
        public void Tap(Vector2 screen, GameObject expected = null) => TestBoardPointer.Tap(screen, expected);
        public static byte[] Hex(string value)
        {
            var bytes = new byte[value.Length / 2];
            for (int i = 0; i < bytes.Length; i++) bytes[i] = Convert.ToByte(value.Substring(i * 2, 2), 16);
            return bytes;
        }

        private sealed class OfflineActions : IBoardActionProvider
        {
            private readonly byte[][] outputs;
            private readonly string seed;
            private int outputIndex;
            public OfflineActions(Fixture fixture)
            {
                outputs = fixture.steps.Where(s => s.operation == ApplyVrfRequest.Operation).Select(s => Hex(s.output)).ToArray();
                seed = fixture.name;
            }
            public async Task<BoardActionResult> Submit(CoreRunToken token, BoardAction action, CancellationToken cancellation)
            {
                await Task.Delay(150, cancellation);
                var state = NativeEngine.Summary(token);
                switch (action.Kind)
                {
                    case BoardActionKind.Move: return NativeEngine.PlayMove(token, state.ActionCounter, state.Moves, action.Row, action.Start, action.Destination);
                    case BoardActionKind.Guardian: return NativeEngine.ApplyBonus(token, state.ActionCounter, action.Row, action.Start);
                    case BoardActionKind.Reroll: return NativeEngine.RequestReroll(token, state.ActionCounter);
                    case BoardActionKind.Abandon: return NativeEngine.Finish(token, 3);
                    default: throw new ArgumentOutOfRangeException(nameof(action));
                }
            }
            public async Task<BoardActionResult> ResolveVrf(CoreRunToken token, CancellationToken cancellation)
            {
                await Task.Delay(250, cancellation);
                var state = NativeEngine.Summary(token);
                byte[] output;
                if (outputIndex < outputs.Length) output = outputs[outputIndex++];
                else using (var hash = SHA256.Create()) output = hash.ComputeHash(Encoding.UTF8.GetBytes(seed + ":" + state.LastVrfCounter));
                return NativeEngine.ApplyVrf(token, state.LastVrfCounter + 1, output);
            }
        }
    }
}
