#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Presentation;
using ZKube.Presentation;
using ZKube.Presentation.Evidence;

namespace ZKube.Integration.App
{
    public sealed partial class MoneyOverviewEvidenceHost
    {
        private MoneyPlayableEvidenceGraph playableGraph;
        public MoneyPlayableEvidenceGraph PlayableGraph => playableGraph;
        private BoardController VisibleBoard => active == null ? null : active.GetComponent<MoneyBoardHost>()?.Board;

        // Called only after explicit evidence inputs, never by readiness or
        // screenshots. Native oracle snapshots arrive independently of gestures.
        private IEnumerator PumpPlayable()
        {
            float until = Time.realtimeSinceStartup + 15;
            do
            {
                yield return null;
                if (active == null || stopping) yield break;
                var board = VisibleBoard;
                if (playableGraph?.NextCommand == "oracleVrf" &&
                    (board == null || board.State?.Phase == (byte)CorePhase.AwaitingVrf))
                {
                    var journal = playableGraph.Services.Journal.Load(playableGraph.Owner);
                    while (!journal.IsCompleted && Time.realtimeSinceStartup < until) yield return null;
                    if (!journal.IsCompleted) throw new TimeoutException("Playable journal read is pending");
                    if (journal.GetAwaiter().GetResult() == null)
                    {
                        var delivery = playableGraph.DeliverNextOracle();
                        while (!delivery.IsCompleted && Time.realtimeSinceStartup < until) yield return null;
                        if (!delivery.IsCompleted) throw new TimeoutException("Playable oracle delivery is pending");
                        delivery.GetAwaiter().GetResult();
                    }
                }
                var run = active.GetComponent<MoneyBoardHost>();
                if (!active.Controller.Busy && (board == null || !board.Busy) && (run == null || !run.OperationPending)) yield break;
            } while (Time.realtimeSinceStartup < until);
            throw new TimeoutException("Playable operation remains pending");
        }
        private void RecordRunPointer(string kind, Vector2 point, GameObject hit) =>
            inputs.Add(new Input { control = kind, hit = hit == null ? null : hit.name, screen = point, frame = Time.frameCount });

        private IEnumerator ClickRunControl(string control)
        {
            if (!new[] { "Guardian action", "Reroll action", "Pause", "Dialog Resume", "Dialog Recover run",
                "Dialog Retry settlement", "Dialog Continue", "Dialog End run", "Dialog Back to my runs", "Dialog Check result" }.Contains(control))
                throw new ArgumentException("Unknown run evidence control", nameof(control));
            var button = VisibleBoard.View.GetComponentsInChildren<Button>().Single(value => value.name == control && value.isActiveAndEnabled);
            EvidencePointer.Click(button, RecordRunPointer);
            if (playableGraph != null) yield return PumpPlayable();
            yield return WaitReady();
        }
        public IEnumerator PlayNextInput()
        {
            RequireReady(); var board = VisibleBoard;
            if (playableGraph == null || board == null || !board.Ready || board.Busy || board.Paused || !board.HostInputEnabled)
                throw new InvalidOperationException("A ready playable run fixture is required");
            var step = playableGraph.NextInput ?? throw new InvalidOperationException("The finite trajectory is complete");
            uint before = board.State.ActionCounter;
            if (step.Kind == "move")
            {
                int width = board.View.DisplayGrid[step.Row * 8 + step.Start];
                yield return EvidencePointer.Drag(board.View.Layout.CellCenter(step.Row, step.Start, width),
                    board.View.Layout.CellCenter(step.Row, step.Destination, width), RecordRunPointer);
            }
            else if (step.Kind == "bonus")
            {
                var button = board.View.GetComponentsInChildren<Button>().Single(value => value.name == "Guardian action");
                EvidencePointer.Click(button, RecordRunPointer);
                EvidencePointer.Tap(board.View.Layout.CellCenter(step.Row, step.Column), record: RecordRunPointer);
            }
            else if (step.Kind == "reroll")
                EvidencePointer.Click(board.View.GetComponentsInChildren<Button>().Single(value => value.name == "Reroll action"), RecordRunPointer);
            else throw new InvalidOperationException("The next fixture event is not a player input: " + step.Kind);
            yield return PumpPlayable(); yield return WaitReady();
            if (board == null || board.RecoveryRequired || board.State.ActionCounter != before + 1)
                throw new InvalidOperationException("Input did not produce exactly one accepted native action");
        }
        private IEnumerator PlayableJourney(string directory, List<string> frames)
        {
            yield return Click("Campaign"); yield return Click("Trial 1"); yield return Click("Start trial");
            string path = Path.Combine(directory, "02-playing.png"); yield return Capture(path); frames.Add(path);
            yield return Click("Reroll action");
            path = Path.Combine(directory, "03-accepted.png"); yield return Capture(path); frames.Add(path);
            yield return Click("Pause"); yield return Click("Dialog End run"); yield return Click("Dialog End run");
            yield return Click("Dialog Continue");
            path = Path.Combine(directory, "04-campaign-progress.png"); yield return Capture(path); frames.Add(path);
        }
    }
}
#endif
