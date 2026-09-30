using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using Piece = ZKube.Presentation.ScreenKit.Piece;

namespace ZKube.Presentation
{
    // The pause over the dimmed board, as the v3 composites draw it: "Paused"
    // over the level and realm, the card of goals as they stand, the card of
    // the four settings, and Resume with End run. The HUD's guardian stays
    // behind the scrim; there is no second one. End run asks first on the same
    // composition: "End this run?", its cost, then Keep playing or End run.
    // Each settings row is one button named for its state ("Dialog Sound: on");
    // a tap anywhere on the row flips it.
    public sealed class PauseDialog : MonoBehaviour
    {
        public sealed class Row
        {
            public string Name, Label, Value, Icon;
            public bool? On;
            public Action Invoke;
        }

        private SkinUi ui;

        // Opens inside the board's persistent modal shield, as the board's own
        // dialogs do: the shield takes every tap from the first frame (new
        // graphics only take taps once drawn), the board's resume closes it, and
        // any dialog the board opens later draws above this one.
        private static PauseDialog Open(BoardView view, BoardArt art, string name, Action<PauseDialog, ScreenKit> draw)
        {
            var shield = view.GetComponentsInChildren<Image>(true).Single(image => image.name == "Modal input shield");
            shield.color = art.Token(SkinTokens.Scrim); shield.raycastTarget = true;
            var root = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            root.SetParent(shield.transform, false);
            var screen = view.Hud.Screen;
            SkinUi.Place(root, screen, shield.transform);
            var dialog = root.gameObject.AddComponent<PauseDialog>();
            dialog.ui = new SkinUi(art, view.Layout.Density, view.TextScale);
            draw(dialog, new ScreenKit(dialog.ui, root, screen, view.Layout.Frame));
            return dialog;
        }

        public static PauseDialog Pause(BoardView view, BoardArt art, RunSummary state, BoardSession session, Action resume, Row[] rows, Action end) =>
            Open(view, art, "Pause dialog", (dialog, kit) => kit.Compose(
                kit.TitlePlate("Paused", Subtitle(session)), Piece.Grow, GoalCard(kit, state, session), SettingsCard(kit, rows), Piece.Grow,
                kit.Buttons(new[] { ("Dialog Resume", "Resume", resume, true, SkinSlots.IconPlay),
                    ("Dialog " + BoardController.EndRun, BoardController.EndRun, end, false, SkinSlots.IconFlag) })));

        // The question and its cost, one line on the card.
        public static PauseDialog Confirm(BoardView view, BoardArt art, string cost, Action keep, Action end) =>
            Open(view, art, "End run dialog", (dialog, kit) => {
                float size = kit.CaptionDp + 2, width = kit.Inner, u = kit.U;
                float costHeight = kit.Ui.TextHeight(cost, width, size, SkinUi.Type.Caption);
                kit.Compose(Piece.Grow, kit.TitlePlate("End this run?", null),
                    kit.Card(costHeight + 24 * u, card => kit.Ui.Label("Dialog cost", cost,
                        new Rect(card.x + 12 * u, card.yMax - 12 * u - costHeight, width, costHeight), size, SkinTokens.Text, kit.Parent, SkinUi.Type.Caption)),
                    Piece.Grow,
                    kit.Buttons(new[] { ("Dialog Keep playing", "Keep playing", keep, true, SkinSlots.IconPlay),
                        ("Dialog " + BoardController.EndRun, BoardController.EndRun, end, false, SkinSlots.IconFlag) }));
            });

        // "Level 14 · Tiki", or "Daily · Tiki".
        private static string Subtitle(BoardSession session)
        {
            string realm = PageCatalog.Load().Realm(session.RealmId).realmName;
            return session.Daily ? "Daily · " + realm : "Level " + HudLayout.LevelNumber(session.RealmId, HudLayout.CampaignLevel(session)) + " · " + realm;
        }

        // The goals as they stand. A Campaign lists the score and its two goals,
        // each count over its target with its bar, or a ring until a one-move
        // goal is met; a Daily lists its score, multiplier and objective.
        private static Piece GoalCard(ScreenKit kit, RunSummary state, BoardSession session)
        {
            float u = kit.U, iconU = kit.Step(38, 32), inner = kit.Inner, bar = kit.Step(6, 4) * kit.Ui.Density;
            var rules = session.Rules;
            var rows = new List<(string name, string icon, float iconU, float iconTallU, string caption, ScreenKit.GoalLine goal, string number, string token)>();
            if (!session.Daily)
            {
                var goals = ScreenKit.Goals(PageCatalog.Load(), new CampaignGoals { Points = rules.PointsRequired, PrimaryKind = rules.PrimaryKind,
                    PrimaryValue = rules.PrimaryValue, PrimaryCount = rules.PrimaryCount, SecondaryKind = rules.SecondaryKind,
                    SecondaryValue = rules.SecondaryValue, SecondaryCount = rules.SecondaryCount }, rules.BonusType);
                uint[] progress = { state.Score, state.PrimaryProgress, state.SecondaryProgress };
                for (int i = 0; i < goals.Length; i++)
                {
                    // As on the HUD, a met goal reads at least its target.
                    goals[i].Met = (state.LatchedStarSources & 1 << i) != 0;
                    goals[i].Progress = goals[i].Met ? Math.Max(progress[i], goals[i].Target) : progress[i];
                    rows.Add((goals[i].Name, goals[i].Pictogram, iconU, iconU, goals[i].Caption, goals[i], null, null));
                }
            }
            else
            {
                string N(ulong number) => number.ToString("N0", CultureInfo.InvariantCulture);
                rows.Add(("Score goal", SkinSlots.GoalScore, iconU, iconU, "Score", null, N(state.DailyScore), SkinTokens.Score));
                rows.Add(("Multiplier", SkinSlots.MultiplierRing, iconU + 4, 16, "Multiplier", null, HudLayout.PressureValue(state), SkinTokens.Accent));
                if (rules.ObjectiveKind != 0)
                {
                    var goal = PageCatalog.Load().Goal(rules.ObjectiveKind, rules.ObjectiveValue);
                    rows.Add(("Objective", goal.Pictogram(rules.BonusType), iconU, iconU, goal.text, null, N(state.ObjectiveTotal), SkinTokens.Score));
                }
            }
            float Right((string name, string icon, float iconU, float iconTallU, string caption, ScreenKit.GoalLine goal, string number, string token) row) =>
                row.goal == null ? kit.NumeralWidth(row.number) : row.goal.Counter == "fill" ? kit.CountWidth(row.goal) : 28 * u;
            var heights = rows.Select(row => kit.RowHeight(row.caption, null, inner, row.iconU, Right(row))).ToArray();
            return kit.Card(heights.Sum() + 20 * u, card => {
                float y = card.yMax - 10 * u, x = card.x + 12 * u;
                for (int i = 0; i < rows.Count; i++)
                {
                    var row = rows[i]; var rect = new Rect(x, y - heights[i], inner, heights[i]); float right = Right(row);
                    var icon = kit.Row(row.name, rect, row.icon, row.iconU, row.caption, null, right, i > 0);
                    if (icon != null && row.iconTallU != row.iconU)
                        SkinUi.Place(icon.rectTransform, new Rect(rect.x, rect.center.y - row.iconTallU * u / 2, row.iconU * u, row.iconTallU * u), kit.Parent);
                    var goal = row.goal;
                    if (goal == null)
                        kit.Numeral(row.name + " value", row.number, new Rect(rect.xMax - right, rect.y, right, rect.height), row.token);
                    else if (goal.Counter == "fill")
                    {
                        // The count over its bar, the bar full and gold once met.
                        kit.Numeral(row.name + " value", kit.Count(goal), new Rect(rect.xMax - right, rect.y + bar + 4 * u, right, rect.height - bar - 4 * u),
                            goal.Met ? SkinTokens.Accent : SkinTokens.Score);
                        var track = new Rect(rect.xMax - right, rect.y + 6 * u, right, bar);
                        kit.Ui.Piece(row.name + " track", SkinSlots.CounterTrack, track, kit.Parent);
                        float share = goal.Target == 0 ? 1 : Mathf.Clamp01((float)goal.Progress / goal.Target);
                        if (share > 0)
                            kit.Ui.Piece(row.name + " fill", goal.Met ? SkinSlots.CounterFillDone : SkinSlots.CounterFill,
                                new Rect(track.x, track.y, Mathf.Max(track.height, track.width * share), track.height), kit.Parent);
                    }
                    else kit.Ui.Piece(row.name + (goal.Met ? " tick" : " ring"), goal.Met ? SkinSlots.Tick : SkinSlots.CounterRing,
                        new Rect(rect.xMax - 26 * u, rect.center.y - 13 * u, 26 * u, 26 * u), kit.Parent);
                    y -= heights[i];
                }
            });
        }

        // The settings, one 48 dp row each: a switch, or the value and ›.
        private static Piece SettingsCard(ScreenKit kit, Row[] rows)
        {
            float u = kit.U, d = kit.Ui.Density, inner = kit.Inner, iconU = 26, toggle = 64 * d;
            string Value(Row row) => row.Value + " ›";
            float Right(Row row) => row.On.HasValue ? toggle : kit.NumeralWidth(Value(row));
            var heights = rows.Select(row => Mathf.Max(48 * d, kit.RowHeight(row.Label, null, inner, row.Icon == null ? 0 : iconU, Right(row)))).ToArray();
            return kit.Card(heights.Sum() + 12 * u, card => {
                float y = card.yMax - 6 * u, x = card.x + 12 * u;
                for (int i = 0; i < rows.Length; i++)
                {
                    var row = rows[i]; var rect = new Rect(x, y - heights[i], inner, heights[i]);
                    var face = kit.Ui.Rect<Image>("Dialog " + row.Name, rect, kit.Parent); face.color = Color.clear; face.raycastTarget = true;
                    var button = face.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = face;
                    button.onClick.AddListener(() => row.Invoke());
                    kit.Row("Dialog " + row.Name, rect, row.Icon, row.Icon == null ? 0 : iconU, row.Label, null, Right(row), i > 0);
                    if (row.On.HasValue)
                        kit.Ui.Toggle("Dialog " + row.Name + " switch", new Rect(rect.xMax - toggle, rect.y, toggle, rect.height), row.On.Value,
                            _ => row.Invoke(), kit.Parent);
                    else kit.Numeral("Dialog " + row.Name + " value", Value(row), new Rect(rect.xMax - Right(row), rect.y, Right(row), rect.height),
                        SkinTokens.Text);
                    y -= heights[i];
                }
            });
        }

        public void Close()
        {
            if (this == null) return;
            gameObject.SetActive(false); ui?.Dispose(); Destroy(gameObject);
        }
    }
}
