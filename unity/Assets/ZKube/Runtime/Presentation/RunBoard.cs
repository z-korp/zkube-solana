using System;
using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    // The board of a local run (a Campaign level in both products, or the Realms
    // Daily): one board kept for the app's life, shown while a run plays. A
    // finished run stays on the board for a moment, then leaves with its outcome
    // (none for a Daily); leaving without a result leaves with none. While the
    // run's progress could not be saved, a banner over the board says so.
    public sealed class RunBoard : MonoBehaviour
    {
        public const float TerminalHoldSeconds = 1.2f;
        // Over the board it is a banner; on a page it is one of the page's notices, at the bottom.
        public const string UnsavedWarning = "Progress is not saved. Keep the app open; closing it may lose this result.";
        public BoardController Board { get; private set; }
        public bool Playing => Board != null && Board.gameObject.activeSelf;
        private Func<bool> unsaved;
        private Action<CampaignOutcome> finished;
        private Action left;
        private Coroutine outcome;
        private GameObject warningRoot;

        // The app's board, or none: one is made when the first run opens.
        public void Initialize(BoardController board = null)
        {
            if (Board != null || warningRoot != null) throw new InvalidOperationException("The run board was already initialized");
            if (board != null) Attach(board);
            warningRoot = AppShell.CanvasRoot("Unsaved progress", transform, 80);
            var banner = Rect("Save warning", warningRoot.transform);
            banner.anchorMin = new Vector2(0, 1); banner.anchorMax = Vector2.one; banner.pivot = new Vector2(.5f, 1);
            banner.sizeDelta = new Vector2(0, 76); banner.gameObject.AddComponent<Image>().color = new Color(.35f, .12f, .03f, .98f);
            var warning = Rect("Save warning text", banner).gameObject.AddComponent<TextMeshProUGUI>();
            warning.font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + SkinUi.FontName(SkinUi.Type.Body)); warning.fontSize = 18; warning.color = Color.white;
            warning.alignment = TextAlignmentOptions.Center; warning.raycastTarget = false; warning.text = UnsavedWarning;
            var text = warning.rectTransform; text.anchorMin = Vector2.zero; text.anchorMax = Vector2.one;
            text.offsetMin = Vector2.one * 14; text.offsetMax = -Vector2.one * 14;
            warningRoot.SetActive(false);
        }
        private void Attach(BoardController board)
        {
            Board = board;
            Board.Host = new BoardHostHooks { Exit = Exit, Terminal = Terminal };
            Board.gameObject.SetActive(false);
        }

        // Plays session; finished receives the run's outcome, left is called when
        // the board is left without one.
        public void Open(BoardSession session, Func<bool> unsavedProgress, Action<CampaignOutcome> finishedRun, Action leftRun)
        {
            if (Board == null)
            {
                var made = new GameObject("Run board", typeof(BoardController)).GetComponent<BoardController>();
                made.transform.SetParent(transform, false); Attach(made);
            }
            StopOutcome();
            unsaved = unsavedProgress; finished = finishedRun; left = leftRun;
            Board.gameObject.SetActive(true); Board.Bind(session);
        }
        // Hides the board without leaving to a page: its identity is gone.
        public void Close()
        {
            StopOutcome(); unsaved = null; finished = null; left = null;
            if (Board != null) Board.gameObject.SetActive(false);
            if (warningRoot != null) warningRoot.SetActive(false);
        }
        private void Exit() { var then = left; Close(); then?.Invoke(); }
        private void Terminal(BoardController source)
        { if (source == Board && outcome == null) outcome = StartCoroutine(Outcome()); }
        private IEnumerator Outcome()
        {
            yield return new WaitForSecondsRealtime(TerminalHoldSeconds);
            outcome = null;
            if (!Playing || Board.State == null || Board.Session == null || Board.RecoveryRequired) yield break;
            var state = Board.State; var session = Board.Session;
            var result = session.Daily ? null : new CampaignOutcome { Realm = session.RealmId, Level = HudLayout.CampaignLevel(session),
                Score = state.Score, StarSources = state.LatchedStarSources, EndReason = state.EndReason, PrimaryProgress = state.PrimaryProgress,
                Goals = new CampaignGoals { Points = session.Rules.PointsRequired, PrimaryKind = session.Rules.PrimaryKind,
                    PrimaryValue = session.Rules.PrimaryValue, PrimaryCount = session.Rules.PrimaryCount,
                    SecondaryKind = session.Rules.SecondaryKind, SecondaryValue = session.Rules.SecondaryValue, SecondaryCount = session.Rules.SecondaryCount },
                MovesLeft = HudLayout.MovesLeft(state, session) };
            var then = finished; Close(); then?.Invoke(result);
        }
        private void StopOutcome() { if (outcome != null) StopCoroutine(outcome); outcome = null; }
        private void Update()
        {
            if (warningRoot == null) return;
            bool show = Playing && unsaved?.Invoke() == true;
            if (warningRoot.activeSelf != show) warningRoot.SetActive(show);
            if (!show) return;
            var rect = (RectTransform)warningRoot.transform.GetChild(0);
            rect.anchorMin = new Vector2(Screen.safeArea.xMin / Screen.width, Screen.safeArea.yMax / Screen.height);
            rect.anchorMax = new Vector2(Screen.safeArea.xMax / Screen.width, Screen.safeArea.yMax / Screen.height);
            rect.anchoredPosition = Vector2.zero;
        }
        private void OnDestroy() { Close(); if (Board != null) Board.Host = null; }
        private static RectTransform Rect(string name, Transform parent)
        { var value = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>(); value.SetParent(parent, false); return value; }
    }
}
