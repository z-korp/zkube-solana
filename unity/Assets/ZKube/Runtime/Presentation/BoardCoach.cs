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
    //
    // A line about a piece of the board (the next row, a button, a tablet, a
    // plate, the crown) is a callout: it stands beside that piece, its tail's
    // tip on the piece's edge, and the piece pulses for as long as it shows. A
    // line about nothing in particular is the guardian's own speech, under it,
    // its tail at the guardian's mouth. Only a callout says "here" or "this".
    public sealed class BoardCoach : MonoBehaviour
    {
        public const float HandSeconds = 1.1f, HandRest = .4f, HintDelay = 2.5f;
        // The hand is a block row and a half high; its fingertip is at this share
        // of its width from the left and of its height from the bottom (the art's notes).
        public const float HandRows = 1.5f, FingerX = .45f, FingerY = .948f;
        private struct Moment { public Lesson Lesson; public string Line, Picture; public Rect Target; }
        // A line as it stands on the board: what it is about (nothing, for the
        // guardian's own speech), its body and its tail.
        public struct Tip { public string Line; public Rect? About; public Rect Body; public RectTransform Tail; }
        private BoardController board;
        // The lessons draw inside the board's own interface, so one canvas orders
        // them with the HUD on every device: pulses behind its pieces, bubbles
        // and the hand over them.
        private RectTransform overlay, pulses;
        private bool active, guided;
        private RunSummary seen;
        private float hintAt = -1, handStart;
        private RectTransform hand;
        private Vector2 handFrom, handTo;
        private readonly List<Image> glows = new List<Image>();
        private readonly List<string> said = new List<string>();
        private readonly List<Tip> tips = new List<Tip>();
        private readonly List<Rect> bubbles = new List<Rect>(), pulsed = new List<Rect>(), hinted = new List<Rect>();
        private readonly Queue<Moment> moments = new Queue<Moment>();
        // What the guardian says on the board now, and the slide it points at.
        public IReadOnlyList<string> Said => said;
        public IReadOnlyList<Tip> Tips => tips;
        // The cells the hand points at, now or when it comes back.
        public IReadOnlyList<Rect> Hinted => hinted;
        public BoardHint.Slide? Pointing { get; private set; }
        public bool Guiding => guided;

        public void Initialize(BoardController owner) => board = owner;
        // The two layers, made in the interface the board shows now.
        private void Layers()
        {
            var host = board.View.Interface;
            if (overlay != null && overlay.parent == host) return;
            Clear();
            RectTransform Layer(string name)
            {
                var layer = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
                layer.SetParent(host, false); layer.anchorMin = Vector2.zero; layer.anchorMax = Vector2.one; layer.offsetMin = layer.offsetMax = Vector2.zero;
                return layer;
            }
            pulses = Layer("Guardian pulses"); pulses.SetAsFirstSibling();
            overlay = Layer("Guardian lessons");
        }
        private void Show(bool shown)
        {
            if (overlay != null && overlay.gameObject.activeSelf != shown) overlay.gameObject.SetActive(shown);
            if (pulses != null && pulses.gameObject.activeSelf != shown) pulses.gameObject.SetActive(shown);
        }
        // A run opened on the board: its first run of the first level is guided.
        public void Begin(bool firstRun)
        {
            Clear(); moments.Clear(); seen = null; hintAt = -1;
            active = board.Session != null && !board.Session.Daily;
            guided = active && firstRun && !Lessons.Device.Taught(Lesson.GuidedRun);
        }
        public void Stop() { active = guided = false; Clear(); moments.Clear(); Show(false); }

        private void Update()
        {
            if (!active || board == null || !board.gameObject.activeInHierarchy || !board.PresentationInitialized || board.State == null)
            { Show(false); return; }
            var state = board.State;
            bool ended = state.Phase == (byte)CorePhase.Finished || state.Phase == (byte)CorePhase.LevelComplete;
            Layers();
            Show(!(board.Paused || board.View.ModalOpen || board.RecoveryRequired || board.AskingReroll || ended));
            if (!board.Busy && !ReferenceEquals(state, seen)) { var before = seen; seen = state; Settled(before, state); }
            if (hintAt >= 0 && Time.unscaledTime >= hintAt && !board.Busy) { hintAt = -1; Point(); }
            Animate();
        }

        private void Settled(RunSummary before, RunSummary now)
        {
            if (before == null) { if (guided && now.Moves == 0) { Point(); Say(Lessons.Slide, null, null, true); } return; }
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
                // The crown has the moves on one side and the plates on the other, no room for a
                // callout: the guardian says the star's line itself while the crown pulses.
                if (moment.Lesson == Lesson.Star) { Glow(moment.Target, SkinTokens.Accent); Say(moment.Line, moment.Picture, null, false); }
                else Say(moment.Line, moment.Picture, moment.Target, false);
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
                    // The hand comes back for the next slide: no bubble stands on it.
                    if (BoardHint.Best(board.Session.Accepted) is BoardHint.Slide next) hinted.AddRange(Cells(next));
                    Say(cleared ? Lessons.Clears : Lessons.Falls, null, null, true);
                    Say(Lessons.Rises, null, layout.Tray, false);
                    hintAt = Time.unscaledTime + HintDelay;
                    break;
                case 2:
                    // The top the blocks must not reach lights behind whatever stands there.
                    Glow(new Rect(layout.Board.x, layout.Board.y + 9 * layout.Cell, layout.Board.width, layout.Cell), SkinTokens.Negative, false);
                    Say(Lessons.MovesLeft(board.Session.Rules.MaxMoves - now.Moves), null, Hud.Moves, true);
                    Say(Lessons.TapGoal, null, Hud.Plates[2], false);
                    break;
                default:
                    Say(Lessons.Reroll, null, layout.RerollButton, false);
                    Lessons.Device.Teach(Lesson.GuidedRun); guided = false;
                    break;
            }
        }

        private BoardLayout Layout => board.View.Layout;
        private HudLayout Hud => board.View.Hud;
        private SkinUi Ui => board.View.Kit;
        // The tablets, plates and buttons of the interface: their pulse is also a lit rim
        // behind them. The crown is a pill and its lit socket has its own light.
        private bool OnInterface(Rect piece) => piece != Layout.Tray && piece != Hud.Crown;
        private Rect[] Cells(BoardHint.Slide slide)
        {
            float cell = Layout.Cell;
            return new[] { new Rect(Layout.Board.x + slide.Start * cell, Layout.Board.y + slide.Row * cell, slide.Width * cell, cell),
                new Rect(Layout.Board.x + slide.Destination * cell, Layout.Board.y + slide.Row * cell, slide.Width * cell, cell) };
        }

        // The hand slides the best slide, and its block and place glow.
        private void Point()
        {
            Pointing = BoardHint.Best(board.Session.Accepted);
            if (!(Pointing is BoardHint.Slide slide)) return;
            float cell = Layout.Cell;
            var cells = Cells(slide); Rect from = cells[0], to = cells[1];
            hinted.AddRange(cells);
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

        // A pulse of light at a piece, a little wider than it. A piece of the
        // interface also takes the kit's lit rim, drawn behind it like the light.
        // keep leaves the piece clear of bubbles.
        private void Glow(Rect target, string token, bool keep = true, bool rim = false)
        {
            var rect = new Rect(target.x - target.width * .2f, target.y - target.height * .2f, target.width * 1.4f, target.height * 1.4f);
            var image = Ui.Rect<Image>("Lesson glow", rect, pulses);
            image.sprite = Ui.Art.SkinUi(SkinSlots.FxGlow); image.raycastTarget = false;
            image.color = SkinUi.WithAlpha(Ui.Art.Token(token), 1);
            glows.Add(image);
            if (rim)
            {
                float edge = 3 * Hud.K * Layout.Density;
                var lit = Ui.Piece("Lesson rim", SkinSlots.TabletArmed, new Rect(target.x - edge, target.y - edge, target.width + 2 * edge, target.height + 2 * edge), pulses);
                lit.raycastTarget = false; glows.Add(lit);
            }
            if (keep) pulsed.Add(target);
        }

        // What no bubble may cover: every pulsing piece, the cells the hand points
        // at, the guardian (its face alone under its own speech), the crown and
        // the plates, the next row and the controls.
        private IEnumerable<Rect> Needed(bool speech)
        {
            var layout = Layout;
            foreach (var piece in pulsed) yield return piece;
            foreach (var cell in hinted) yield return cell;
            yield return speech ? Ui.Art.FaceIn(Hud.Guardian) : Hud.Guardian;
            yield return Hud.Crown; foreach (var plate in Hud.Plates) yield return plate;
            yield return layout.Tray; yield return layout.PauseButton; yield return layout.GuardianButton; yield return layout.RerollButton;
        }
        // What a bubble leaves alone while it has the room: the moves, the
        // level's medal, the next row's label and the rows the stack fills.
        private IEnumerable<Rect> Spared()
        {
            var layout = Layout;
            yield return Hud.Moves; if (Hud.Medal.width > 0) yield return Hud.Medal; yield return Hud.NextLabel;
            int height = 0;
            for (int row = 9; row >= 0 && height == 0; row--)
                for (int column = 0; column < 8; column++) if (board.State.Grid[row * 8 + column] != 0) { height = row + 1; break; }
            if (height > 0) yield return new Rect(layout.Board.x, layout.Board.y, layout.Board.width, height * layout.Cell);
        }
        private bool Free(Rect body, Rect[] keep)
        {
            // A bubble keeps a small margin from the screen's safe edges.
            var frame = Layout.Frame; float edge = 4 * Layout.Density;
            return body.xMin >= frame.xMin + edge - .5f && body.xMax <= frame.xMax - edge + .5f && body.yMin >= frame.yMin + edge - .5f && body.yMax <= frame.yMax - edge + .5f &&
                !keep.Any(body.Overlaps) && !bubbles.Any(body.Overlaps);
        }

        // How far a callout may stand from its piece, and its tail when it stands against it, in u.
        public const float CalloutReachU = 96, CalloutTailU = 12;
        // Where a callout's tail touches its piece: the point of the piece's edge facing the body.
        public static Vector2 Touch(Rect piece, Rect body)
        {
            float x = Mathf.Clamp(Mathf.Clamp(piece.center.x, body.xMin, body.xMax), piece.xMin, piece.xMax);
            float y = Mathf.Clamp(Mathf.Clamp(piece.center.y, body.yMin, body.yMax), piece.yMin, piece.yMax);
            if (body.yMin >= piece.yMax) return new Vector2(x, piece.yMax);
            if (body.yMax <= piece.yMin) return new Vector2(x, piece.yMin);
            return new Vector2(body.xMin >= piece.xMax ? piece.xMax : piece.xMin, y);
        }
        // A callout's place: above, below, left or right of its piece, slid along
        // that edge, no further than reach from it, clear of keep. A tail longer
        // than the gap crosses nothing in barred on its way to the piece.
        private bool Beside(Rect piece, float width, float height, float reach, Rect[] keep, Rect[] barred, out Rect place)
        {
            float u = Hud.K * Layout.Density, tail = CalloutTailU * u, step = 6 * u; var frame = Layout.Frame;
            for (float away = 0; away <= reach; away += step)
                for (int side = 0; side < 4; side++)
                {
                    bool upright = side < 2;
                    // Along the edge: centred on the piece and held on the screen, then slid either way while the tail still meets the piece.
                    float edge = 4 * Layout.Density;
                    float centre = upright ? Mathf.Clamp(piece.center.x - width / 2, frame.xMin + edge, frame.xMax - edge - width)
                        : Mathf.Clamp(piece.center.y - height / 2, frame.yMin + edge, frame.yMax - edge - height);
                    float span = (upright ? width + piece.width : height + piece.height) / 2 - SkinUi.TailInsetU * u;
                    for (float slide = 0; slide <= span; slide += step)
                        foreach (float along in slide == 0 ? new[] { centre } : new[] { centre - slide, centre + slide })
                        {
                            var body = side == 0 ? new Rect(along, piece.yMax + tail + away, width, height)
                                : side == 1 ? new Rect(along, piece.yMin - tail - away - height, width, height)
                                : side == 2 ? new Rect(piece.xMin - tail - away - width, along, width, height)
                                : new Rect(piece.xMax + tail + away, along, width, height);
                            if (!Free(body, keep)) continue;
                            if (away > 0)
                            {
                                Vector2 tip = Touch(piece, body), from = SkinUi.TailBase(body, tip, u); bool crosses = false;
                                for (float t = 0; t < 1 && !crosses; t += .05f) crosses = barred.Any(rect => rect.Contains(Vector2.Lerp(from, tip, t)));
                                if (crosses) continue;
                            }
                            place = body; return true;
                        }
                }
            place = default; return false;
        }
        // The guardian's own speech: under it at the top of the board, lower when that is taken.
        private bool Under(float width, float height, Rect[] keep, out Rect place)
        {
            float d = Layout.Density, u = Hud.K * d, step = 6 * u;
            float x = Mathf.Clamp(Hud.Guardian.center.x - width / 2, Layout.Rim.x + 4 * d, Layout.Rim.xMax - 4 * d - width);
            for (float y = Layout.Rim.yMax - 6 * d - 14 * u - height; y >= Layout.Board.y; y -= step)
                if (Free(new Rect(x, y, width, height), keep)) { place = new Rect(x, y, width, height); return true; }
            place = default; return false;
        }

        // One line in the goal bubble's piece, in the pages' caption size: about
        // a piece it is a callout beside it, that piece pulsing; about nothing in
        // particular it is the guardian's speech. A lesson's card stands at its
        // left. A callout stands against its piece if it can, sparing what a
        // bubble leaves alone, then against it without sparing, then further off.
        private void Say(string line, string picture, Rect? about, bool skip)
        {
            float d = Layout.Density, k = Hud.K, u = k * d, pad = 12 * u;
            if (about.HasValue) Glow(about.Value, SkinTokens.Accent, true, OnInterface(about.Value));
            // The lesson's card, 64u high at its own shape.
            var card = picture == null ? null : Ui.Art.SkinUi(picture);
            float cardHeight = card == null ? 0 : 64 * u, art = card == null ? 0 : cardHeight * card.rect.width / card.rect.height;
            float size = ScreenKit.Caption(k), skipHeight = skip ? 36 * d : 0, beside = art > 0 ? art + 10 * u : 0;
            float widest = Mathf.Min(Layout.Rim.width - 16 * d, (about.HasValue ? 200 * u : 280 * u) + beside), least = (skip ? 96 * d : 60 * u) + 2 * pad + beside;
            float inner = 0, text = 0;
            Vector2 Size(float share)
            {
                float width = Mathf.Max(least, widest * share);
                inner = width - 2 * pad - beside;
                // A short line takes only its own width.
                float own = Ui.TextWidth(line, size, SkinUi.Type.Caption) + 2;
                if (own < inner) { width = Mathf.Max(least, width - (inner - own)); inner = width - 2 * pad - beside; }
                text = Ui.TextHeight(line, inner, size, SkinUi.Type.Caption, HudLayout.BubbleLeading);
                return new Vector2(width, Mathf.Max(text, cardHeight) + 2 * pad + skipHeight);
            }
            var needed = Needed(!about.HasValue).ToArray(); var spared = needed.Concat(Spared()).ToArray();
            var barred = needed.Where(rect => rect != Layout.Tray).ToArray();
            var shares = new[] { 1f, .82f, .66f };
            Rect body = default; bool placed = false;
            if (about.HasValue)
            {
                if (!needed.Contains(about.Value)) { needed = needed.Append(about.Value).ToArray(); spared = spared.Append(about.Value).ToArray(); }
                barred = barred.Where(rect => rect != about.Value).ToArray();
                foreach (var (reach, keep) in new[] { (0f, spared), (0f, needed), (CalloutReachU * u, spared), (CalloutReachU * u, needed) })
                {
                    foreach (float share in shares)
                    {
                        // A callout is never taller than it is wide.
                        var fit = Size(share); if (share < 1 && fit.y > fit.x) continue;
                        if (Beside(about.Value, fit.x, fit.y, reach, keep, barred, out body)) { placed = true; break; }
                    }
                    if (placed) break;
                }
            }
            else
                foreach (var keep in new[] { spared, needed })
                { var fit = Size(1); if (Under(fit.x, fit.y, keep, out body)) { placed = true; break; } }
            // Nowhere is free: the board is full to the top. The line stands at the top of the board all the same.
            if (!placed)
            {
                var fit = Size(1);
                body = new Rect(Mathf.Clamp((about ?? Hud.Guardian).center.x - fit.x / 2, Layout.Rim.x + 4 * d, Layout.Rim.xMax - 4 * d - fit.x),
                    Layout.Rim.yMax - 6 * d - 14 * u - fit.y, fit.x, fit.y);
            }
            bubbles.Add(body); overlay.SetAsLastSibling();
            var tail = about.HasValue ? Ui.Tail("Lesson bubble tail", body, Touch(about.Value, body), u, overlay)
                : Ui.SpeechTail("Lesson bubble tail", body, Hud.Guardian, u, overlay);
            tips.Add(new Tip { Line = line, About = about, Body = body, Tail = tail.rectTransform });
            var bubble = Ui.Piece("Lesson bubble", SkinSlots.TapBubble, body, overlay); bubble.raycastTarget = false;
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
            foreach (var layer in new[] { overlay, pulses })
                if (layer != null) foreach (Transform child in layer.Cast<Transform>().ToArray()) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            glows.Clear(); said.Clear(); tips.Clear(); bubbles.Clear(); pulsed.Clear(); hinted.Clear(); hand = null; Pointing = null;
        }
        private void OnDestroy()
        {
            if (overlay != null) Destroy(overlay.gameObject);
            if (pulses != null) Destroy(pulses.gameObject);
        }
    }
}
