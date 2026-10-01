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
    // The pause, as the wireframe draws it: a clean dark screen over the board
    // with "Paused" over the level and realm, the card of goals as they stand,
    // the card of the four settings, and Resume with End run; nothing of the
    // HUD shows through. End run asks first on the same composition: "End this
    // run?", its cost, then Keep playing or End run. Each settings row is one
    // button named for its state ("Dialog Sound: on"); a tap anywhere on the
    // row flips it.
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
        // any dialog the board opens later draws above this one. The shield is
        // the scrim's colour at full strength.
        private static PauseDialog Open(BoardView view, BoardArt art, string name, Action<PauseDialog, ScreenKit> draw)
        {
            var shield = view.GetComponentsInChildren<Image>(true).Single(image => image.name == "Modal input shield");
            shield.color = SkinUi.WithAlpha(art.Token(SkinTokens.Scrim), 1); shield.raycastTarget = true;
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
                kit.Title("Paused", Subtitle(session)), Piece.Grow, GoalCard(kit, state, session), SettingsCard(kit, rows), Piece.Grow,
                kit.Buttons(new[] { ("Dialog Resume", "Resume", resume, ScreenKit.Kind.Primary, SkinSlots.IconPlay),
                    ("Dialog " + BoardController.EndRun, BoardController.EndRun, end, ScreenKit.Kind.Secondary, SkinSlots.IconFlag) })));

        // The question, and its cost with what stays, centred on the card.
        public static PauseDialog Confirm(BoardView view, BoardArt art, string cost, string detail, Action keep, Action end) =>
            Open(view, art, "End run dialog", (dialog, kit) => {
                var inside = kit.Inside();
                float costHeight = inside.Block(cost, inside.Width, inside.CaptionDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                float detailHeight = inside.Block(detail, inside.Width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                kit.Compose(Piece.Grow, kit.Title("End this run?", null),
                    kit.Card(null, new Piece(costHeight + detailHeight, rect => {
                        inside.Text("Dialog cost", cost, new Rect(rect.x, rect.yMax - costHeight, rect.width, costHeight), inside.CaptionDp, SkinTokens.Text,
                            SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                        if (detail != null)
                            inside.Text("Dialog cost detail", detail, new Rect(rect.x, rect.y, rect.width, detailHeight), inside.SmallDp, SkinTokens.TextMuted,
                                SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                    })),
                    Piece.Grow,
                    kit.Buttons(new[] { ("Dialog Keep playing", "Keep playing", keep, ScreenKit.Kind.Primary, SkinSlots.IconPlay),
                        ("Dialog " + BoardController.EndRun, BoardController.EndRun, end, ScreenKit.Kind.Secondary, SkinSlots.IconFlag) }));
            });

        // "Level 14 · Tiki", or "Daily · Tiki".
        private static string Subtitle(BoardSession session)
        {
            string realm = PageCatalog.Load().Realm(session.RealmId).realmName;
            return session.Daily ? "Daily · " + realm : "Level " + HudLayout.LevelNumber(session.RealmId, HudLayout.CampaignLevel(session)) + " · " + realm;
        }

        // The goals as they stand. A Campaign lists the score and its two goals,
        // each count over its bar, or a ring until a one-move goal is met; a
        // Daily lists its score, multiplier and objective.
        private static Piece GoalCard(ScreenKit kit, RunSummary state, BoardSession session)
        {
            float u = kit.U, iconU = kit.Step(38, 32);
            var rules = session.Rules; var inside = kit.Inside();
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
                }
                return kit.Card(null, inside.GoalRows(goals, ScreenKit.GoalMode.Progress, iconU));
            }
            string N(ulong number) => number.ToString("N0", CultureInfo.InvariantCulture);
            var rows = new List<Piece> {
                inside.Row("Score goal", inside.Icon("Score goal icon", SkinSlots.GoalScore, iconU), "Score", null, inside.Value("Score goal value", N(state.DailyScore)), false),
                inside.Row("Multiplier", new ScreenKit.Side((iconU + 4) * u, 16 * u, rect => kit.Ui.Piece("Multiplier icon", SkinSlots.MultiplierRing, rect, kit.Parent)),
                    "Multiplier", null, inside.Value("Multiplier value", HudLayout.PressureValue(state), SkinTokens.Accent), true) };
            if (rules.ObjectiveKind != 0)
            {
                var goal = PageCatalog.Load().Goal(rules.ObjectiveKind, rules.ObjectiveValue);
                rows.Add(inside.Row("Objective", inside.Icon("Objective icon", goal.Pictogram(rules.BonusType), iconU), goal.text, null,
                    inside.Value("Objective value", N(state.ObjectiveTotal)), true));
            }
            return kit.Card(null, rows);
        }

        // The settings, a row each: its switch, or its value and ›.
        private static Piece SettingsCard(ScreenKit kit, Row[] rows)
        {
            float u = kit.U; var inside = kit.Inside();
            return kit.Card(null, rows.Select((row, i) => {
                var right = row.On.HasValue
                    ? new ScreenKit.Side(52 * u, 26 * u, rect => kit.Ui.Toggle("Dialog " + row.Name + " switch", rect, row.On.Value, _ => row.Invoke(), kit.Parent))
                    : inside.Value("Dialog " + row.Name + " value", row.Value + " ›", SkinTokens.Text);
                var line = inside.Row("Dialog " + row.Name, row.Icon == null ? (ScreenKit.Side?)null : inside.Icon("Dialog " + row.Name + " icon", row.Icon, 26),
                    row.Label, null, right, i > 0);
                return new Piece(line.Height, rect => {
                    var face = kit.Ui.Rect<Image>("Dialog " + row.Name, rect, kit.Parent); face.color = Color.clear; face.raycastTarget = true;
                    var button = face.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = face;
                    button.onClick.AddListener(() => row.Invoke());
                    line.Draw(rect);
                });
            }));
        }

        public void Close()
        {
            if (this == null) return;
            gameObject.SetActive(false); ui?.Dispose(); Destroy(gameObject);
        }
    }
}
