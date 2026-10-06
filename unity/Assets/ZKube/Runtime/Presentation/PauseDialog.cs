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
    // and the action band (owner, 2026-10-05): Resume across the column, then
    // Home, which leaves the board with the run as it stands, and End run side
    // by side under it. Nothing in a top corner takes a tap. End run asks first
    // on the same composition:
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

        public const string Home = "Dialog Home";
        private const float TightPadU = 5;
        public static PauseDialog Pause(BoardView view, BoardArt art, RunSummary state, BoardSession session, Action resume, Row[] rows, Action home, Action end) =>
            Open(view, art, "Pause dialog", (dialog, kit) => {
                // The pause hands its three actions over by role: Resume, then Home,
                // and End run last, which asks first. The foot row is theirs: Resume
                // across the column over the other two where the page has room for two
                // rows, one row where it has not. A phone with no height to spare first
                // gives up the spacer over the cards, then tightens both cards evenly.
                ScreenKit.Slots Slots(bool spaced, float padU)
                {
                    var body = new List<Piece>();
                    if (spaced) body.Add(Piece.Grow);
                    body.Add(GoalCard(kit, state, session, padU)); body.Add(SettingsCard(kit, rows, padU));
                    return new ScreenKit.Slots { Title = kit.Title(Words.PauseTitle, Subtitle(session)), Body = body,
                        Notices = Closes(session) is string closes ? ClosesLine(kit, closes) : (Piece?)null,
                        Primary = new ScreenKit.Control { Name = "Dialog Resume", Label = Words.ActionResume, Click = resume, Icon = SkinSlots.IconPlay },
                        Secondary = new ScreenKit.Control { Name = Home, Label = Words.TabHome, Click = home, Icon = SkinSlots.IconHome },
                        Destructive = new ScreenKit.Control { Name = "Dialog " + BoardController.EndRun, Label = BoardController.EndRun, Click = end, Icon = SkinSlots.IconFlag } };
                }
                var slots = Slots(true, ScreenKit.CardPadU);
                if (!kit.Fits(slots)) slots = Slots(false, ScreenKit.CardPadU);
                if (!kit.Fits(slots)) slots = Slots(false, TightPadU);
                kit.Page(slots);
            });

        // The question, and its cost with what stays, centred on the card.
        public static PauseDialog Confirm(BoardView view, BoardArt art, string cost, string detail, Action keep, Action end) =>
            Open(view, art, "End run dialog", (dialog, kit) => {
                var inside = kit.Inside();
                float costHeight = inside.Block(cost, inside.Width, inside.CaptionDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                float detailHeight = inside.Block(detail, inside.Width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                // The confirm's two verbs: the safe choice first, End run beside it.
                kit.Page(new ScreenKit.Slots { Body = new[] { Piece.Grow, kit.Title(Words.PauseEndTitle, null),
                    kit.Card(null, new Piece(costHeight + detailHeight, rect => {
                        inside.Text("Dialog cost", cost, new Rect(rect.x, rect.yMax - costHeight, rect.width, costHeight), inside.CaptionDp, SkinTokens.Text,
                            SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                        if (detail != null)
                            inside.Text("Dialog cost detail", detail, new Rect(rect.x, rect.y, rect.width, detailHeight), inside.SmallDp, SkinTokens.TextMuted,
                                SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                    })),
                    Piece.Grow },
                    Primary = new ScreenKit.Control { Name = "Dialog Keep playing", Label = Words.ActionKeepPlaying, Click = keep, Icon = SkinSlots.IconPlay },
                    Secondary = new ScreenKit.Control { Name = "Dialog " + BoardController.EndRun, Label = BoardController.EndRun, Click = end, Icon = SkinSlots.IconFlag } });
            });

        // "Level 14 · Tiki", or "Daily · Tiki".
        private static string Subtitle(BoardSession session)
        {
            string realm = PageCatalog.Load().Realm(session.RealmId).realmName;
            return session.Daily ? Words.ModeDaily + " · " + realm : Words.LevelTitle(HudLayout.LevelNumber(session.RealmId, HudLayout.CampaignLevel(session))) + " · " + realm;
        }
        // A Daily run can be left and resumed until its day closes: within the
        // last hour one short line over the band says when, beside the clock.
        public const long ClosesSoonSeconds = 3600;
        public const string ClosesName = "Dialog closes";
        private static string Closes(BoardSession session)
        {
            var facts = session.DailyFacts;
            long left = facts?.Now == null || facts.ClosesAt <= 0 ? 0 : facts.ClosesAt - facts.Now();
            return left > 0 && left <= ClosesSoonSeconds ? Words.PauseClosesIn((left + 59) / 60) : null;
        }
        private static Piece ClosesLine(ScreenKit kit, string words)
        {
            float u = kit.U, icon = 20 * u, size = kit.SubtitleDp, wide = kit.Ui.TextWidth(words, size, SkinUi.Type.Caption) + 2 * kit.Ui.Density;
            return new Piece(icon, rect => {
                float x = rect.center.x - (icon + 6 * u + wide) / 2;
                kit.Ui.Piece(ClosesName + " icon", SkinSlots.IconClock, new Rect(x, rect.y, icon, icon), kit.Parent);
                kit.Text(ClosesName, words, new Rect(x + icon + 6 * u, rect.y, wide, rect.height), size, SkinTokens.Text, SkinUi.Type.Caption, 1, TextAlignmentOptions.Left);
            });
        }

        // The goals as they stand. A Campaign lists the score and its two goals,
        // each count over its bar, or a ring until a one-move goal is met; a
        // Daily lists its score, multiplier and objective.
        private static Piece GoalCard(ScreenKit kit, RunSummary state, BoardSession session, float padU)
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
                return kit.Card(null, inside.GoalRows(goals, ScreenKit.GoalMode.Progress, iconU), padU: padU);
            }
            string N(ulong number) => Words.Number(number);
            var rows = new List<Piece> {
                inside.Row("Score goal", inside.Pictogram("Score goal", SkinSlots.GoalScore, null, iconU), Words.GoalScore, null, inside.Value("Score goal value", N(state.DailyScore)), false),
                inside.Row("Multiplier", inside.Multiplier("Multiplier", iconU), Words.PauseMultiplier, null, inside.Value("Multiplier value", HudLayout.PressureValue(state), SkinTokens.Accent), true) };
            if (rules.ObjectiveKind != 0)
            {
                var goal = PageCatalog.Load().Goal(rules.ObjectiveKind, rules.ObjectiveValue);
                rows.Add(inside.Row("Objective", inside.Pictogram("Objective", goal.Pictogram(rules.BonusType), goal.chip, iconU), goal.text, null,
                    inside.Value("Objective value", N(state.ObjectiveTotal)), true));
            }
            return kit.Card(null, rows, padU: padU);
        }

        // The settings, a row each: its switch, or its value and ›.
        private static Piece SettingsCard(ScreenKit kit, Row[] rows, float padU)
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
                    button.onClick.AddListener(() => row.Invoke()); ScreenKit.As(button, ScreenKit.Role.Setting);
                    line.Draw(rect);
                });
            }), padU: padU);
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
