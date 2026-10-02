using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    // DECISIONS 2026-10-02: a chosen bonus shows its button selected and says
    // what to tap; the reroll asks first; a full tablet shows it is full.
    public sealed class BoardBonusTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Board bonus tests");
            board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            yield return Load("realm-8-daily");
            board.SetMuted(true); board.SetReducedMotion(true);
        }
        [UnityTearDown] public IEnumerator TearDown()
        { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Wait(Func<bool> predicate)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!predicate())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Board bonus timed out: " + "Board is still busy or loading");
                yield return null;
            }
        }
        private IEnumerator Load(string name)
        {
            evidence.Load(name);
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            yield return null;
        }
        private Image Piece(string name) => board.View.GetComponentsInChildren<Image>(true).Single(image => image.name == name);
        private TMP_Text Label(string name) => board.View.GetComponentsInChildren<TMP_Text>(true).SingleOrDefault(text => text.name == name);
        private static Rect Bounds(RectTransform rect)
        {
            var corners = new Vector3[4]; rect.GetWorldCorners(corners);
            return Rect.MinMaxRect(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
        }
        private void AssertChosen(bool chosen, string prompt, string at)
        {
            Assert.AreEqual(chosen, board.View.BonusChosen, at);
            Assert.AreEqual(chosen, Piece("Guardian action glow").enabled, at + ": the glow");
            Assert.AreEqual(chosen, Piece("Guardian action chosen").enabled, at + ": the lit face");
            Assert.AreEqual(chosen, Piece("Bonus prompt plate").enabled, at + ": the prompt's plate");
            Assert.AreEqual(chosen ? prompt : "", board.View.PromptText, at);
        }

        // Each guardian's bonus: a tap on its tablet selects it (a gold glow and a
        // lit face) and shows its prompt; both stay through a redraw of the board
        // and a cleared notice, which lost the old prompt; a second tap puts it
        // back, and using it clears both.
        [UnityTest] public IEnumerator ChoosingABonusSelectsItsButtonAndShowsItsPrompt()
        {
            foreach (var (fixture, prompt) in new[] { ("Wave-perfect-clear-continuation", "Tap a row to clear it"),
                ("Hammer-perfect-clear-continuation", "Tap a block to break it"), ("Totem-perfect-clear-continuation", "Tap a block to clear its size") })
            {
                yield return Load(fixture);
                Assert.AreEqual(prompt, BoardNotices.Prompt(board.State.BonusType), fixture);
                AssertChosen(false, prompt, fixture + " before");
                evidence.Click("Guardian action"); yield return null;
                AssertChosen(true, prompt, fixture + " chosen");
                var words = Label("Bonus prompt"); words.ForceMeshUpdate();
                Assert.LessOrEqual(words.GetPreferredValues(words.text, words.rectTransform.rect.width, float.PositiveInfinity).y, words.rectTransform.rect.height + .5f, "The prompt fits its plate");
                Assert.IsTrue(board.View.Layout.Board.Overlaps(Bounds(words.rectTransform)), "The prompt floats on the board's top edge");
                board.View.Status(""); AssertChosen(true, prompt, fixture + " after a cleared notice");
                board.RefreshLayout(); yield return null;
                AssertChosen(true, prompt, fixture + " after a redraw");
                board.Pause(); yield return null; board.Resume(); yield return null;
                AssertChosen(true, prompt, fixture + " after a pause");
                evidence.Click("Guardian action"); yield return null;
                AssertChosen(false, prompt, fixture + " put back");
                uint action = board.State.ActionCounter;
                yield return evidence.PlayNextInput();
                Assert.AreEqual(action + 1, board.State.ActionCounter, fixture + ": the bonus was used");
                AssertChosen(false, prompt, fixture + " used");
                yield return Wait(() => !board.Busy);
            }
        }

        // The prompt and the chosen ring on the compact phone, the emulator's
        // default and the Seeker, at both text sizes.
        [UnityTest] public IEnumerator TheChosenStateFitsEveryPhone()
        {
            yield return Load("Wave-perfect-clear-continuation");
            var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
            board.View.gameObject.SetActive(false);
            var phones = new[] { ("compact", ZKube.Tests.Presentation.Phones.CompactScreen, ZKube.Tests.Presentation.Phones.CompactTopInsetDp, 0f),
                ("emulator", ZKube.Tests.Presentation.Phones.EmulatorScreen, ZKube.Tests.Presentation.Phones.EmulatorTopInsetDp, ZKube.Tests.Presentation.Phones.EmulatorBottomInsetDp),
                ("seeker", ZKube.Tests.Presentation.Phones.SeekerScreen, ZKube.Tests.Presentation.Phones.SeekerTopInsetDp, 0f) };
            foreach (var (phone, screen, top, bottom) in phones)
                foreach (float text in new[] { 1f, 1.3f })
                {
                    string at = phone + " at " + text;
                    var safe = new Rect(0, bottom, screen.width, screen.height - top - bottom);
                    var ui = new SkinUi(art, 1, text);
                    var child = new GameObject("Chosen view"); child.transform.SetParent(root.transform);
                    var view = child.AddComponent<BoardView>(); view.Create(board, art, HudLayout.Build(ui, board.State, board.Session, safe, 1, screen), ui);
                    view.SetBoard(board.State.Grid); view.SetPreview(board.State.HasNextRow, board.State.NextRow);
                    board.State.RerollCharges = Protocol.ChargeCap;
                    view.Summary(board.State, board.Session, true); view.Choose(true);
                    Canvas.ForceUpdateCanvases();
                    var words = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Bonus prompt"); words.ForceMeshUpdate();
                    Assert.AreEqual("Tap a row to clear it", words.text);
                    Assert.LessOrEqual(words.GetPreferredValues(words.text, words.rectTransform.rect.width, float.PositiveInfinity).y, words.rectTransform.rect.height + .5f, at + ": the prompt fits");
                    var plate = Bounds(words.rectTransform);
                    Assert.IsTrue(plate.xMin >= view.Layout.Board.xMin && plate.xMax <= view.Layout.Board.xMax, at + ": the prompt stays on the board");
                    Assert.IsTrue(view.GetComponentsInChildren<Image>().Single(image => image.name == "Guardian action glow").enabled, at);
                    Assert.IsTrue(view.GetComponentsInChildren<Image>().Single(image => image.name == "Guardian action chosen").enabled, at);
                    var full = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Reroll action label");
                    Assert.AreEqual("3/3", full.text, at);
                    if (text == 1) { yield return null; yield return ZKube.Tests.Presentation.Captures.Snap(screen, "bonus-chosen-" + phone); }
                    UnityEngine.Object.Destroy(child); yield return null;
                }
            board.View.gameObject.SetActive(true);
        }

        // The reroll opens a small confirm: what it does, and two buttons. Keeping
        // the row spends nothing; confirming spends the charge.
        [UnityTest] public IEnumerator TheRerollAsksFirstThenSpendsItsCharge()
        {
            Assert.AreEqual(1, board.State.RerollCharges);
            uint action = board.State.ActionCounter; var preview = (byte[])board.State.NextRow.Clone();
            evidence.Click("Reroll action"); yield return null;
            Assert.IsTrue(board.AskingReroll); Assert.IsFalse(board.Busy);
            Assert.AreEqual(action, board.State.ActionCounter, "Asking spends nothing");
            var texts = board.View.GetComponentsInChildren<TMP_Text>().Select(text => text.text).ToArray();
            CollectionAssert.Contains(texts, BoardController.RerollTitle); CollectionAssert.Contains(texts, BoardController.RerollDetail);
            var buttons = board.View.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Dialog ", StringComparison.Ordinal)).Select(button => button.name).ToArray();
            CollectionAssert.AreEquivalent(new[] { "Dialog " + BoardController.RerollConfirm, "Dialog " + BoardController.RerollKeep }, buttons);
            evidence.Click("Dialog " + BoardController.RerollKeep); yield return null;
            Assert.IsFalse(board.AskingReroll); Assert.IsFalse(board.Busy);
            Assert.AreEqual(1, board.State.RerollCharges); Assert.AreEqual(action, board.State.ActionCounter);
            CollectionAssert.AreEqual(preview, board.State.NextRow, "The row is kept");
            Assert.IsFalse(board.View.GetComponentsInChildren<Button>().Any(button => button.name.StartsWith("Dialog ", StringComparison.Ordinal)));

            evidence.Click("Reroll action"); yield return null;
            evidence.Click("Dialog " + BoardController.RerollConfirm);
            Assert.IsTrue(board.Busy); Assert.IsFalse(board.AskingReroll);
            yield return Wait(() => !board.Busy);
            Assert.AreEqual(0, board.State.RerollCharges, "Confirming spends the charge"); Assert.AreEqual(action + 1, board.State.ActionCounter);
            // A pause closes an open question without spending.
            yield return Load("move-perfect-clear-cap");
            evidence.Click("Reroll action"); yield return null; Assert.IsTrue(board.AskingReroll);
            board.Pause(); yield return null;
            Assert.IsFalse(board.AskingReroll); Assert.AreEqual(Protocol.ChargeCap, board.State.RerollCharges);
            board.Resume();
        }

        // At three charges the badge reads 3/3 in a gold ring; below, the count
        // alone. An earn the full tablet cannot take says "Full" over it, and an
        // earned charge rises from it.
        [UnityTest] public IEnumerator AFullTabletShowsItIsFullAndAnEarnAtTheCapSaysSo()
        {
            yield return Load("move-perfect-clear-cap");
            Assert.AreEqual(Protocol.ChargeCap, board.State.RerollCharges);
            Assert.AreEqual("3/3", Label("Reroll action label").text); Assert.IsTrue(Piece("Reroll action full ring").enabled);
            Assert.AreNotEqual("3/3", Label("Guardian action label").text); Assert.IsFalse(Piece("Guardian action full ring").enabled);
            byte charges = board.State.BonusCharges;
            try
            {
                for (byte held = 0; held <= Protocol.ChargeCap; held++)
                {
                    board.State.BonusCharges = held; board.View.Summary(board.State, board.Session, true);
                    Assert.AreEqual(held == Protocol.ChargeCap ? "3/3" : held.ToString(), Label("Guardian action label").text);
                    Assert.AreEqual(held == Protocol.ChargeCap, Piece("Guardian action full ring").enabled);
                }
            }
            finally { board.State.BonusCharges = charges; board.View.Summary(board.State, board.Session, true); }
            var tablet = board.View.Layout.GuardianButton;
            foreach (bool full in new[] { true, false })
            {
                board.View.ShowGains(0, 0, 0, true, false, false, 1, full);
                var note = Label(full ? "Accepted bonus cap" : "Accepted bonus chip");
                Assert.IsNotNull(note); Assert.AreEqual(full ? BoardView.FullNote : "+1", note.text);
                Assert.IsNull(Label(full ? "Accepted bonus chip" : "Accepted bonus cap"));
                var rect = Bounds(note.rectTransform);
                Assert.GreaterOrEqual(rect.yMin, tablet.yMax - 1, "The note stands over the guardian tablet");
                Assert.Less(Mathf.Abs(rect.center.x - tablet.center.x), tablet.width / 2);
                yield return Wait(() => Label("Accepted bonus cap") == null && Label("Accepted bonus chip") == null);
            }
            // A real earned charge, through the controller.
            yield return Load("balam-earned-totem");
            byte before = board.State.BonusCharges;
            var input = evidence.PlayNextInput(); bool rose = false;
            while (input.MoveNext()) { yield return input.Current; rose |= Label("Accepted bonus chip") != null; }
            Assert.Greater(board.State.BonusCharges, before, "The fixture earns a charge");
            Assert.IsTrue(rose || Label("Accepted bonus chip") != null, "The earned charge rises from its tablet");
        }
    }
}
