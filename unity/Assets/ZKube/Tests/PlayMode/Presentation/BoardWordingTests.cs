using System;
using System.Collections;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    // Players read goals in the catalog's own words. Internal source and board
    // names, and protocol status words, never reach board-visible text.
    public sealed class BoardWordingTests
    {
        private static readonly Regex Internal = new Regex(@"\b(theme|shape|blow|accepted|pending)\b", RegexOptions.IgnoreCase);
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Wording test board"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            board.SetMuted(true); board.SetReducedMotion(false);
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            UnityEngine.Object.Destroy(root); yield return null;
        }
        private static IEnumerator Wait(Func<bool> condition)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!condition())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Timed out waiting for the board");
                yield return null;
            }
        }
        private void AssertPlainWords(string context)
        {
            foreach (var text in board.View.GetComponentsInChildren<TMP_Text>())
                if (text.isActiveAndEnabled && text.alpha > 0)
                    Assert.IsFalse(Internal.IsMatch(text.text), context + ": " + text.name + " shows '" + text.text + "'");
        }
        private void Click(string name) => evidence.Click(name);
        private IEnumerator Watch(IEnumerator input, string context)
        {
            bool done = false;
            IEnumerator Run() { yield return input; done = true; }
            evidence.StartCoroutine(Run());
            while (!done) { AssertPlainWords(context); yield return null; }
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            for (int i = 0; i < 60; i++) { AssertPlainWords(context + " after"); yield return null; }
        }

        [Test] public void NoBoardNoticeUsesProtocolWords()
        {
            foreach (string notice in BoardNotices.All()) Assert.IsFalse(Internal.IsMatch(notice), notice);
        }

        [UnityTest] public IEnumerator EveryBoardTextThroughPlayAndDialogsUsesThePlayersWords()
        {
            foreach (string fixture in new[] { "realm-8-daily", "balam-combo-2", "move-perfect-clear-grant", "realm-8-campaign", "shape-latch", "display-long-campaign-constraint" })
            {
                evidence.Load(fixture); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                AssertPlainWords(fixture);
                int inputs = evidence.Current.steps.Count(step => step.operation != ZKube.Core.Generated.NativeOperation.ApplyVrf &&
                    step.operation != ZKube.Core.Generated.NativeOperation.Finish);
                for (int i = 0; i < inputs; i++) yield return Watch(evidence.PlayNextInput(), fixture + " input " + i);
                if (board.State.Phase != (byte)ZKube.Core.Generated.CorePhase.Playing) continue;
                Click("Pause"); yield return null; AssertPlainWords(fixture + " pause");
                Click("Dialog Resume"); yield return Wait(() => !board.Paused);
                if (board.Session.Daily) continue;
                for (int star = 0; star < 3; star++)
                {
                    Click("Goal plate " + star); yield return null; AssertPlainWords(fixture + " goal " + star);
                    board.View.CloseBubble();
                }
            }
        }
    }
}
