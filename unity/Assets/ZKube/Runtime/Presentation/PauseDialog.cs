using System;
using System.Collections;
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
    // The pause, as the wireframe lays it out, over the game as it stood,
    // softened and dimmed (DECISIONS 2026-10-02): "Paused" over the level and
    // realm, the card of goals as they stand, the card of the four settings,
    // and Resume with End run. End run asks first on the same composition:
    // "End this run?", its cost, then Keep playing or End run. Each settings
    // row is one button named for its state ("Dialog Sound: on"); a tap
    // anywhere on the row flips it.
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
        // any dialog the board opens later draws above this one. The shield
        // holds the paused scene under its scrim.
        private static PauseDialog Open(BoardView view, BoardArt art, string name, Action<PauseDialog, ScreenKit> draw)
        {
            var shield = view.GetComponentsInChildren<Image>(true).Single(image => image.name == "Modal input shield");
            shield.raycastTarget = true;
            var screen = view.Hud.Screen;
            var scene = PausedScene.Under(shield, screen, art.Token(SkinTokens.Scrim));
            var root = new GameObject(name, typeof(RectTransform), typeof(CanvasGroup)).GetComponent<RectTransform>();
            root.SetParent(shield.transform, false);
            SkinUi.Place(root, screen, shield.transform);
            var dialog = root.gameObject.AddComponent<PauseDialog>();
            dialog.ui = new SkinUi(art, view.Layout.Density, view.TextScale);
            draw(dialog, new ScreenKit(dialog.ui, root, screen, view.Layout.Frame));
            scene.Cover(root.GetComponent<CanvasGroup>());
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
                inside.Row("Score goal", inside.Pictogram("Score goal", SkinSlots.GoalScore, null, iconU), "Score", null, inside.Value("Score goal value", N(state.DailyScore)), false),
                inside.Row("Multiplier", inside.Multiplier("Multiplier", iconU), "Multiplier", null, inside.Value("Multiplier value", HudLayout.PressureValue(state), SkinTokens.Accent), true) };
            if (rules.ObjectiveKind != 0)
            {
                var goal = PageCatalog.Load().Goal(rules.ObjectiveKind, rules.ObjectiveValue);
                rows.Add(inside.Row("Objective", inside.Pictogram("Objective", goal.Pictogram(rules.BonusType), goal.chip, iconU), goal.text, null,
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

    // The game behind the pause: one capture of the board as it stood when the
    // pause opened, softened by downsampling, under a dim scrim. The capture
    // takes one frame, during which the shield is clear and the dialog hidden;
    // it stays for the dialogs that follow (the end-run confirm, a settings
    // switch redrawing the pause) until the board closes its modal.
    public sealed class PausedScene : MonoBehaviour
    {
        public const string Name = "Paused scene";
        // The scrim's strength over the softened game.
        public const float ScrimAlpha = .62f;
        private RawImage image;
        private Image shield;
        private Color scrim;
        private CanvasGroup waiting;
        private RenderTexture soft;
        private bool capturing;
        public bool Ready => soft != null;
        public Texture Texture => soft;

        // The shield's scene, made on the first pause.
        public static PausedScene Under(Image shield, Rect screen, Color scrim)
        {
            var existing = shield.GetComponentInChildren<PausedScene>(true);
            if (existing != null) return existing;
            var go = new GameObject(Name, typeof(RectTransform), typeof(RawImage));
            go.transform.SetParent(shield.transform, false); go.transform.SetAsFirstSibling();
            SkinUi.Place(go.GetComponent<RectTransform>(), screen, shield.transform);
            var scene = go.AddComponent<PausedScene>();
            scene.image = go.GetComponent<RawImage>(); scene.image.raycastTarget = false; scene.image.enabled = false;
            scene.shield = shield; scene.scrim = scrim;
            return scene;
        }
        // Shows the dialog over the scene, once the scene is captured.
        public void Cover(CanvasGroup dialog)
        {
            if (Ready) { Reveal(dialog); return; }
            waiting = dialog; dialog.alpha = 0;
            shield.color = Color.clear;
            if (!capturing) StartCoroutine(Capture());
        }
        private void Reveal(CanvasGroup dialog)
        {
            image.texture = soft; image.enabled = true;
            shield.color = SkinUi.WithAlpha(scrim, ScrimAlpha);
            if (dialog != null) dialog.alpha = 1;
        }
        private IEnumerator Capture()
        {
            capturing = true;
            yield return new WaitForEndOfFrame();
            int width = Screen.width, height = Screen.height;
            var shot = new Texture2D(width, height, TextureFormat.RGB24, false);
            try
            {
                shot.ReadPixels(new Rect(0, 0, width, height), 0, 0); shot.Apply();
                soft = Soften(shot);
            }
            finally { Destroy(shot); capturing = false; }
            Reveal(waiting); waiting = null;
        }
        // Halving to a sixteenth and doubling back to a quarter: a soft blur
        // that costs a few small blits.
        private static RenderTexture Soften(Texture source)
        {
            Texture current = source;
            var steps = new List<RenderTexture>();
            try
            {
                foreach (int divisor in new[] { 2, 4, 8, 16, 8 })
                {
                    var step = RenderTexture.GetTemporary(Mathf.Max(1, source.width / divisor), Mathf.Max(1, source.height / divisor), 0);
                    step.filterMode = FilterMode.Bilinear;
                    Graphics.Blit(current, step); steps.Add(step); current = step;
                }
                var result = new RenderTexture(Mathf.Max(1, source.width / 4), Mathf.Max(1, source.height / 4), 0) { filterMode = FilterMode.Bilinear };
                Graphics.Blit(current, result);
                return result;
            }
            finally { foreach (var step in steps) RenderTexture.ReleaseTemporary(step); }
        }
        private void OnDestroy() { if (soft != null) { soft.Release(); Destroy(soft); } }
    }
}
