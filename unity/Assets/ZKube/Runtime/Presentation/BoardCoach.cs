using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The guardian teaching on the board. The first run of the first level is
    // guided: a hand slides the best slide (BoardHint), a glow rings it, and a
    // bubble says one lesson after each of the first three moves; then the guide
    // lets go. In any Campaign run each board moment is taught the first time it
    // happens: a bonus's first charge, the first star, the first empty board.
    // Nothing waits for the player or takes a touch but Skip tips, which ends
    // every board lesson; a Daily run is never taught.
    public sealed class BoardCoach : MonoBehaviour
    {
        public const float HandSeconds = 1.1f, HandRest = .4f, HintDelay = 2.5f;
        private struct Moment { public Lesson Lesson; public string Line, Picture; public Rect Target; public bool Above; }
        private BoardController board;
        private Canvas canvas;
        private RectTransform overlay;
        private bool active, guided;
        private RunSummary seen;
        private float hintAt = -1, handStart;
        private RectTransform hand;
        private Vector2 handFrom, handTo;
        private readonly List<Image> glows = new List<Image>();
        private readonly List<string> said = new List<string>();
        private readonly Queue<Moment> moments = new Queue<Moment>();
        // What the guardian says on the board now, and the slide it points at.
        public IReadOnlyList<string> Said => said;
        public BoardHint.Slide? Pointing { get; private set; }
        public bool Guiding => guided;

        public void Initialize(BoardController owner)
        {
            board = owner;
            canvas = new GameObject("Guardian lessons", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster)).GetComponent<Canvas>();
            canvas.transform.SetParent(transform, false); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = 10;
            overlay = (RectTransform)canvas.transform;
            canvas.gameObject.SetActive(false);
        }
        // A run opened on the board: its first run of the first level is guided.
        public void Begin(bool firstRun)
        {
            Clear(); moments.Clear(); seen = null; hintAt = -1;
            active = board.Session != null && !board.Session.Daily;
            guided = active && firstRun && !Lessons.Device.Taught(Lesson.GuidedRun);
        }
        public void Stop() { active = guided = false; Clear(); moments.Clear(); canvas.gameObject.SetActive(false); }

        private void Update()
        {
            if (!active || board == null || !board.gameObject.activeInHierarchy || !board.PresentationInitialized || board.State == null)
            { if (canvas != null) canvas.gameObject.SetActive(false); return; }
            var state = board.State;
            bool ended = state.Phase == (byte)CorePhase.Finished || state.Phase == (byte)CorePhase.LevelComplete;
            canvas.gameObject.SetActive(!(board.Paused || board.View.ModalOpen || board.RecoveryRequired || board.AskingReroll || ended));
            if (!board.Busy && !ReferenceEquals(state, seen)) { var before = seen; seen = state; Settled(before, state); }
            if (hintAt >= 0 && Time.unscaledTime >= hintAt && !board.Busy) { hintAt = -1; Point(); }
            Animate();
        }

        private void Settled(RunSummary before, RunSummary now)
        {
            if (before == null) { if (guided && now.Moves == 0) { Point(); Say(Lessons.Slide, null, Head(), false, true); } return; }
            if (now.ActionCounter == before.ActionCounter) return;
            // A new action ends what the last one said.
            Clear();
            if (guided && now.Moves != before.Moves) Guide(now, now.Score > before.Score);
            foreach (var lesson in Moments(before, now, Lessons.Device))
                moments.Enqueue(lesson == Lesson.Star ? new Moment { Lesson = lesson, Line = Lessons.Star, Picture = SkinSlots.LessonStars, Target = Hud.Crown }
                    : lesson == Lesson.EmptyBoard ? new Moment { Lesson = lesson, Line = Lessons.EmptyBoard, Picture = SkinSlots.LessonReroll, Target = Layout.RerollButton, Above = true }
                    : new Moment { Lesson = lesson, Line = Lessons.Charge(now.BonusType), Picture = Lessons.ChargeCard(now.BonusType), Target = Layout.GuardianButton, Above = true });
            if (said.Count == 0 && moments.Count > 0)
            {
                var moment = moments.Dequeue(); Lessons.Device.Teach(moment.Lesson);
                Glow(moment.Target, SkinTokens.Accent);
                Say(moment.Line, moment.Picture, moment.Above ? moment.Target : Head(), moment.Above, false);
            }
        }

        // The board moments one action brings, not yet taught, in the order they
        // are taught: its bonus's first charge, the first star, the first empty
        // board (the only way a reroll is earned).
        public static IEnumerable<Lesson> Moments(RunSummary before, RunSummary now, Lessons taught)
        {
            if (before.ChargesEarned == 0 && now.ChargesEarned > 0 && !taught.Taught(Lessons.ChargeLesson(now.BonusType))) yield return Lessons.ChargeLesson(now.BonusType);
            if (before.LatchedStarSources == 0 && now.LatchedStarSources != 0 && !taught.Taught(Lesson.Star)) yield return Lesson.Star;
            if (now.RerollCharges > before.RerollCharges && !taught.Taught(Lesson.EmptyBoard)) yield return Lesson.EmptyBoard;
        }

        // The guided run's lessons, one per move, then it lets go.
        private void Guide(RunSummary now, bool cleared)
        {
            var layout = Layout;
            switch (now.Moves)
            {
                case 1:
                    Say(cleared ? Lessons.Clears : Lessons.Falls, null, Head(), false, true);
                    Glow(layout.Tray, SkinTokens.Accent);
                    Say(Lessons.Rises, null, layout.Tray, true, false);
                    hintAt = Time.unscaledTime + HintDelay;
                    break;
                case 2:
                    Glow(Hud.Moves, SkinTokens.Accent); Glow(Hud.Plates[0], SkinTokens.Accent);
                    Glow(new Rect(layout.Board.x, layout.Board.y + 9 * layout.Cell, layout.Board.width, layout.Cell), SkinTokens.Negative);
                    Say(Lessons.MovesLeft(board.Session.Rules.MaxMoves - now.Moves), null, Head(), false, true);
                    Say(Lessons.TapGoal, null, Hud.Plates[2], false, false);
                    break;
                default:
                    Glow(layout.RerollButton, SkinTokens.Accent);
                    Say(Lessons.Reroll, null, layout.RerollButton, true, false);
                    Lessons.Device.Teach(Lesson.GuidedRun); guided = false;
                    break;
            }
        }

        private BoardLayout Layout => board.View.Layout;
        private HudLayout Hud => board.View.Hud;
        private SkinUi Ui => board.View.Kit;
        // Under the guardian, at the top of the frame.
        private Rect Head() => new Rect(Hud.Guardian.center.x - 1, Layout.Rim.yMax - 6 * Layout.Density, 2, 1);

        // The hand slides the best slide, and its block and place glow.
        private void Point()
        {
            Pointing = BoardHint.Best(board.Session.Accepted);
            if (!(Pointing is BoardHint.Slide slide)) return;
            float cell = Layout.Cell, d = Layout.Density;
            var from = new Rect(Layout.Board.x + slide.Start * cell, Layout.Board.y + slide.Row * cell, slide.Width * cell, cell);
            var to = new Rect(Layout.Board.x + slide.Destination * cell, Layout.Board.y + slide.Row * cell, slide.Width * cell, cell);
            Glow(from, SkinTokens.Accent); Glow(to, SkinTokens.Accent);
            float height = 66 * d * Hud.K, width = height * 2 / 3;
            var image = Ui.Rect<Image>("Guardian hand", new Rect(0, 0, width, height), overlay);
            image.sprite = Ui.Art.SkinUi(SkinSlots.HandPointer); image.preserveAspect = true; image.raycastTarget = false;
            hand = image.rectTransform; handFrom = from.center; handTo = to.center; handStart = Time.unscaledTime;
            Place(handFrom);
        }
        // The fingertip, at the hand's top centre, on point.
        private void Place(Vector2 point)
        {
            var size = SkinUi.ScreenRect(hand).size;
            SkinUi.Place(hand, new Rect(point.x - size.x / 2, point.y - size.y, size.x, size.y), overlay);
        }
        private void Animate()
        {
            bool still = board.ReducedMotion;
            float breath = still ? .7f : .55f + .3f * Mathf.Sin(2 * Mathf.PI * Time.unscaledTime / 1.2f);
            foreach (var glow in glows) if (glow != null) glow.color = SkinUi.WithAlpha(glow.color, breath);
            if (hand == null || still) return;
            float t = Mathf.Repeat(Time.unscaledTime - handStart, HandSeconds + HandRest) / HandSeconds;
            Place(Vector2.Lerp(handFrom, handTo, Mathf.SmoothStep(0, 1, Mathf.Min(1, t))));
        }

        private void Glow(Rect target, string token)
        {
            var rect = new Rect(target.x - target.width * .2f, target.y - target.height * .2f, target.width * 1.4f, target.height * 1.4f);
            var image = Ui.Rect<Image>("Lesson glow", rect, overlay);
            image.sprite = Ui.Art.SkinUi(SkinSlots.FxGlow); image.raycastTarget = false;
            image.color = SkinUi.WithAlpha(Ui.Art.Token(token), .7f);
            glows.Add(image);
        }

        // The guardian's bubble (the goal bubble's piece), above or under target
        // with its tail towards it, the lesson's card at its left when it has one.
        private void Say(string line, string picture, Rect target, bool above, bool skip)
        {
            float d = Layout.Density, k = Hud.K, u = k * d;
            float width = Mathf.Min(Layout.Rim.width - 16 * d, 280 * u), pad = 12 * u;
            float art = picture == null ? 0 : 72 * u, inner = width - 2 * pad - (art > 0 ? art + 10 * u : 0);
            float text = Ui.TextHeight(line, inner, Hud.BubblePt, SkinUi.Type.Caption, HudLayout.BubbleLeading);
            float skipHeight = skip ? 36 * d : 0;
            float height = Mathf.Max(text, art / 1.5f) + 2 * pad + skipHeight, tail = 14 * u;
            float x = Mathf.Clamp(target.center.x - width / 2, Layout.Rim.x + 4 * d, Layout.Rim.xMax - 4 * d - width);
            float y = above ? target.yMax + tail : target.y - tail - height;
            var body = new Rect(x, y, width, height);
            var bubble = Ui.Piece("Lesson bubble", SkinSlots.TapBubble, body, overlay); bubble.raycastTarget = false;
            var tip = Ui.Piece("Lesson bubble tail", SkinSlots.TapBubbleTail,
                new Rect(Mathf.Clamp(target.center.x, body.x + 18 * u, body.xMax - 18 * u) - 9 * u, above ? body.y - tail : body.yMax, 18 * u, tail), overlay);
            tip.raycastTarget = false; tip.rectTransform.localEulerAngles = new Vector3(0, 0, above ? -90 : 90);
            if (art > 0)
            {
                var card = Ui.Rect<Image>("Lesson card", new Rect(body.x + pad, body.yMax - pad - art / 1.5f, art, art / 1.5f), overlay);
                card.sprite = Ui.Art.SkinUi(picture); card.preserveAspect = true; card.raycastTarget = false;
            }
            var label = Ui.Label("Lesson line", line, new Rect(body.xMax - pad - inner, body.yMax - pad - text, inner, text), Hud.BubblePt,
                SkinTokens.TextOnPrimary, overlay, SkinUi.Type.Caption, TextAlignmentOptions.TopLeft);
            label.lineSpacing = SkinUi.LineSpacing(label.font, HudLayout.BubbleLeading); label.raycastTarget = false;
            if (skip)
                Ui.TextButton("Skip tips", new Rect(body.xMax - pad - 96 * d, body.y + 6 * d, 96 * d, 30 * d), Lessons.Skip, SkipTips, false, overlay, out _, sizeDp: 12);
            said.Add(line);
        }
        private void SkipTips()
        {
            Lessons.Device.TeachTheBoard(); guided = false; hintAt = -1; moments.Clear(); Clear();
        }
        private void Clear()
        {
            if (overlay != null) foreach (Transform child in overlay.Cast<Transform>().ToArray()) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            glows.Clear(); said.Clear(); hand = null; Pointing = null;
        }
        private void OnDestroy() { if (canvas != null) Destroy(canvas.gameObject); }
    }
}
