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
        // The hand is a block row and a half high; its fingertip is at this share
        // of its width from the left and of its height from the bottom (the art's notes).
        public const float HandRows = 1.5f, FingerX = .45f, FingerY = .948f;
        private struct Moment { public Lesson Lesson; public string Line, Picture; public Rect Target; }
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
        private readonly List<Rect> bubbles = new List<Rect>(), pulsed = new List<Rect>();
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
            if (before == null) { if (guided && now.Moves == 0) { Point(); Say(Lessons.Slide, null, Head(), true); } return; }
            if (now.ActionCounter == before.ActionCounter) return;
            // A new action ends what the last one said.
            Clear();
            if (guided && now.Moves != before.Moves) Guide(now, now.Score > before.Score);
            foreach (var lesson in Moments(before, now, Lessons.Device))
                moments.Enqueue(lesson == Lesson.Star ? new Moment { Lesson = lesson, Line = Lessons.Star, Picture = SkinSlots.LessonStars, Target = Hud.Crown }
                    : lesson == Lesson.EmptyBoard ? new Moment { Lesson = lesson, Line = Lessons.EmptyBoard, Picture = SkinSlots.LessonReroll, Target = Layout.RerollButton }
                    : new Moment { Lesson = lesson, Line = Lessons.Charge(now.BonusType), Picture = Lessons.ChargeCard(now.BonusType), Target = Layout.GuardianButton });
            if (said.Count == 0 && moments.Count > 0)
            {
                var moment = moments.Dequeue(); Lessons.Device.Teach(moment.Lesson);
                Glow(moment.Target, SkinTokens.Accent);
                Say(moment.Line, moment.Picture, moment.Target, false);
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
                    Glow(layout.Tray, SkinTokens.Accent);
                    Say(cleared ? Lessons.Clears : Lessons.Falls, null, Head(), true);
                    Say(Lessons.Rises, null, layout.Tray, false);
                    hintAt = Time.unscaledTime + HintDelay;
                    break;
                case 2:
                    Glow(Hud.Moves, SkinTokens.Accent); Glow(Hud.Plates[0], SkinTokens.Accent);
                    Glow(new Rect(layout.Board.x, layout.Board.y + 9 * layout.Cell, layout.Board.width, layout.Cell), SkinTokens.Negative);
                    Say(Lessons.MovesLeft(board.Session.Rules.MaxMoves - now.Moves), null, Head(), true);
                    Say(Lessons.TapGoal, null, Hud.Plates[2], false);
                    break;
                default:
                    Glow(layout.RerollButton, SkinTokens.Accent);
                    Say(Lessons.Reroll, null, layout.RerollButton, false);
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
            var sprite = Ui.Art.SkinUi(SkinSlots.HandPointer);
            float height = HandRows * cell, width = height * sprite.rect.width / sprite.rect.height;
            var image = Ui.Rect<Image>("Guardian hand", new Rect(0, 0, width, height), overlay);
            image.sprite = sprite; image.preserveAspect = true; image.raycastTarget = false;
            hand = image.rectTransform; handFrom = from.center; handTo = to.center; handStart = Time.unscaledTime;
            Place(handFrom);
        }
        // The fingertip on point.
        private void Place(Vector2 point)
        {
            var size = SkinUi.ScreenRect(hand).size;
            SkinUi.Place(hand, new Rect(point.x - FingerX * size.x, point.y - FingerY * size.y, size.x, size.y), overlay);
        }
        private void Animate()
        {
            bool still = board.ReducedMotion;
            // Strong enough to read on the darkest painting, breathing between 80 and 100%.
            float breath = still ? 1 : .9f + .1f * Mathf.Sin(2 * Mathf.PI * Time.unscaledTime / 1.2f);
            foreach (var glow in glows) if (glow != null) glow.color = SkinUi.WithAlpha(glow.color, breath);
            if (hand == null || still) return;
            float t = Mathf.Repeat(Time.unscaledTime - handStart, HandSeconds + HandRest) / HandSeconds;
            Place(Vector2.Lerp(handFrom, handTo, Mathf.SmoothStep(0, 1, Mathf.Min(1, t))));
        }

        // A pulse of light behind a piece, a little wider than it; the piece stays clear of bubbles.
        private void Glow(Rect target, string token)
        {
            var rect = new Rect(target.x - target.width * .2f, target.y - target.height * .2f, target.width * 1.4f, target.height * 1.4f);
            var image = Ui.Rect<Image>("Lesson glow", rect, overlay);
            image.sprite = Ui.Art.SkinUi(SkinSlots.FxGlow); image.raycastTarget = false;
            image.color = SkinUi.WithAlpha(Ui.Art.Token(token), 1);
            glows.Add(image); pulsed.Add(target);
        }

        // What a bubble must leave visible: what it teaches, every piece pulsing,
        // the guardian, the stack with the row about to rise, and everything from
        // the next row down (the tray and the controls).
        private IEnumerable<Rect> KeepClear(Rect target)
        {
            var layout = Layout;
            yield return target; foreach (var piece in pulsed) yield return piece;
            yield return Hud.Guardian;
            int height = 0;
            for (int row = 9; row >= 0 && height == 0; row--)
                for (int column = 0; column < 8; column++) if (board.State.Grid[row * 8 + column] != 0) { height = row + 1; break; }
            yield return new Rect(layout.Board.x, layout.Board.y, layout.Board.width, Mathf.Min(10, height + 1) * layout.Cell);
            yield return new Rect(0, 0, Screen.width, Mathf.Max(layout.Tray.yMax, Hud.NextLabel.yMax));
        }
        // Where a bubble goes: beside its target if that leaves everything clear,
        // else in the board's free space over the stack, else over the top band.
        private Rect Room(Rect target, float width, float height, float tail)
        {
            float d = Layout.Density, step = 4 * d;
            var keep = KeepClear(target).ToArray(); var frame = Layout.Frame;
            bool Free(Rect body) => body.xMin >= frame.xMin - .5f && body.xMax <= frame.xMax + .5f && body.yMin >= frame.yMin - .5f && body.yMax <= frame.yMax + .5f &&
                !keep.Any(body.Overlaps) && !bubbles.Any(body.Overlaps);
            float x = Mathf.Clamp(target.center.x - width / 2, Layout.Rim.x + 4 * d, Layout.Rim.xMax - 4 * d - width);
            foreach (var body in new[] { new Rect(x, target.yMax + tail, width, height), new Rect(x, target.y - tail - height, width, height) })
                if (Free(body)) return body;
            for (float y = Layout.Rim.yMax - tail - 4 * d - height; y >= Layout.Board.y; y -= step)
                if (Free(new Rect(x, y, width, height))) return new Rect(x, y, width, height);
            foreach (float left in new[] { x, frame.x + 4 * d, frame.xMax - 4 * d - width })
                for (float y = frame.yMax - 4 * d - height; y >= Layout.Rim.y; y -= step)
                    if (Free(new Rect(left, y, width, height))) return new Rect(left, y, width, height);
            return new Rect(x, target.yMax + tail, width, height);
        }

        // The guardian's bubble (the goal bubble's piece) where Room finds it, its
        // tail towards target when it stands against it, the lesson's card at its
        // left when it has one; its line in the pages' caption size.
        private void Say(string line, string picture, Rect target, bool skip)
        {
            float d = Layout.Density, k = Hud.K, u = k * d;
            float width = Mathf.Min(Layout.Rim.width - 16 * d, 280 * u), pad = 12 * u;
            // The lesson's card, 64u high at its own shape.
            var card = picture == null ? null : Ui.Art.SkinUi(picture);
            float cardHeight = card == null ? 0 : 64 * u, art = card == null ? 0 : cardHeight * card.rect.width / card.rect.height;
            float inner = width - 2 * pad - (art > 0 ? art + 10 * u : 0);
            float size = ScreenKit.Caption(k), text = Ui.TextHeight(line, inner, size, SkinUi.Type.Caption, HudLayout.BubbleLeading);
            float skipHeight = skip ? 36 * d : 0;
            float height = Mathf.Max(text, cardHeight) + 2 * pad + skipHeight, tail = 14 * u;
            var body = Room(target, width, height, tail); bubbles.Add(body);
            var bubble = Ui.Piece("Lesson bubble", SkinSlots.TapBubble, body, overlay); bubble.raycastTarget = false;
            bool above = Mathf.Abs(body.y - tail - target.yMax) < 1, below = Mathf.Abs(body.yMax + tail - target.y) < 1;
            if (above || below)
            {
                var tip = Ui.Piece("Lesson bubble tail", SkinSlots.TapBubbleTail,
                    new Rect(Mathf.Clamp(target.center.x, body.x + 18 * u, body.xMax - 18 * u) - 9 * u, above ? body.y - tail : body.yMax, 18 * u, tail), overlay);
                tip.raycastTarget = false; tip.rectTransform.localEulerAngles = new Vector3(0, 0, above ? -90 : 90);
            }
            if (card != null)
            {
                var image = Ui.Rect<Image>("Lesson card", new Rect(body.x + pad, body.yMax - pad - cardHeight, art, cardHeight), overlay);
                image.sprite = card; image.preserveAspect = true; image.raycastTarget = false;
            }
            var label = Ui.Label("Lesson line", line, new Rect(body.xMax - pad - inner, body.yMax - pad - text, inner, text), size,
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
            glows.Clear(); said.Clear(); bubbles.Clear(); pulsed.Clear(); hand = null; Pointing = null;
        }
        private void OnDestroy() { if (canvas != null) Destroy(canvas.gameObject); }
    }
}
