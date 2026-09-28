using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Renders one accepted run: the board as world sprites from the active skin,
    // and the HUD from the skin component kit. Gameplay state only arrives through
    // Summary, SetBoard, SetPreview and Trace; the view never infers acceptance.
    public sealed class BoardView : MonoBehaviour
    {
        private readonly Dictionary<int, SpriteRenderer> blocks = new Dictionary<int, SpriteRenderer>();
        private readonly List<SpriteRenderer> preview = new List<SpriteRenderer>();
        private BoardArt art;
        private BoardController owner;
        private HudLayout hud;
        private SkinUi ui;
        public float TextScale => hud.Scale;
        public bool NeedsTextReflow { get; private set; }
        private Canvas canvas;
        private Transform boardRoot;
        private Camera boardCamera;
        private Image guardian, progressFill, guardianGlyph, rerollGlyph, statusPlate;
        private TMP_Text score, objective, moves, pressure, status, heading, scoreLabel, objectiveLabel, secondaryLabel;
        private TMP_Text guardianLabel, rerollLabel, guardianRuleHeading, guardianRule;
        private readonly Image[] stars = new Image[3];
        private readonly Button[] starButtons = new Button[3];
        private Button guardianButton, rerollButton;
        private GameObject modal;
        private Image modalShield;
        private SpriteRenderer ghost;
        public BoardLayout Layout { get; private set; }
        public bool HasRuntimeGraph => art != null && canvas != null && boardCamera != null && guardian != null &&
            score != null && objective != null && status != null && Pointer != null &&
            Layout.Cell > 0 && Layout.Density > 0 && Layout.Board.width > 0 && Layout.Board.height > 0;
        public byte[] DisplayGrid { get; private set; } = new byte[80];
        public bool GuardianEnabled => guardianButton != null && guardianButton.interactable;
        public bool RerollEnabled => rerollButton != null && rerollButton.interactable;
        public BoardPointer Pointer { get; private set; }
        public string StatusText => status == null ? "" : status.text;

        public void Create(BoardController controller, BoardArt source, HudLayout plan, SkinUi kit)
        {
            owner = controller; art = source; hud = plan; ui = kit; Layout = plan.Layout;
            boardCamera = new GameObject("Board Camera", typeof(Camera)).GetComponent<Camera>();
            boardCamera.transform.SetParent(transform, false);
            boardCamera.orthographic = true;
            boardCamera.orthographicSize = Screen.height / 2f;
            boardCamera.transform.position = new Vector3(Screen.width / 2f, Screen.height / 2f, -10);
            boardCamera.backgroundColor = Color.black;
            boardCamera.clearFlags = CameraClearFlags.SolidColor;
            boardRoot = new GameObject("Native board sprites").transform; boardRoot.SetParent(transform, false);

            var background = NewSprite("Realm background", art.SkinRealm(SkinSlots.Background), -20);
            Size(background, new Rect(0, 0, Screen.width, Screen.height), true);
            float d = Layout.Density, cell = Layout.Cell;
            Sliced("Board frame", art.SkinUi(SkinSlots.BoardFrame), Grow(Layout.Board, Layout.FrameInset, Layout.FrameInset), -12, Layout.FrameScale);
            Sliced("Grid well", art.SkinUi(SkinSlots.GridWell), Grow(Layout.Board, 3 * d, 3 * d), -10);
            var cellSprite = art.SkinUi(SkinSlots.GridCell);
            for (int row = 0; row < 10; row++) for (int col = 0; col < 8; col++)
            {
                var sprite = NewSprite("Cell " + row + ":" + col, cellSprite, -8);
                var p = Layout.CellCenter(row, col);
                Size(sprite, new Rect(p.x - cell / 2 + 1, p.y - cell / 2 + 1, cell - 2, cell - 2));
            }
            Sliced("Next row tray", art.SkinUi(SkinSlots.PreviewTray), Grow(Layout.Preview, Layout.FrameInset, BoardLayout.TrayInset * d), -10, Layout.TrayScale);

            canvas = new GameObject("Board interface", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster)).GetComponent<Canvas>();
            canvas.transform.SetParent(transform, false); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            BuildHud();
        }

        private void BuildHud()
        {
            var root = canvas.transform;
            float d = Layout.Density;
            var hit = ui.Rect<Image>("Board gesture surface", Layout.Board, root);
            hit.color = Color.clear; hit.raycastTarget = true;
            Pointer = hit.gameObject.AddComponent<BoardPointer>(); Pointer.Owner = owner;

            ui.Piece("Title ribbon", SkinSlots.TitleRibbon, hud.Title, root);
            heading = ui.Label("Run title", HudLayout.TitleText(art, owner.Session), hud.Title, hud.TitlePt, SkinTokens.Text, root, true);

            guardian = ui.Medallion("Calm realm guardian", hud.Medallion, art.Sprite("boss__idle"), root);
            ui.Piece("Score plate", SkinSlots.Plate, hud.ScorePlate, root, HudLayout.PlateBorderScale);
            scoreLabel = ui.Label("Score label", HudLayout.ScoreCaptionText(owner.Session), hud.ScoreCaption, hud.CaptionPt, SkinTokens.TextMuted, root);
            score = ui.Label("Score", "0", hud.ScoreValue, hud.ValuePt, SkinTokens.Score, root, true);
            if (hud.Progress.height > 0)
            {
                var track = ui.Rect<Image>("Score progress", hud.Progress, root); track.color = art.Token(SkinTokens.Scrim); track.raycastTarget = false;
                progressFill = ui.Rect<Image>("Score progress fill", hud.Progress, track.transform);
                progressFill.color = art.Token(SkinTokens.Accent); progressFill.raycastTarget = false;
            }
            ui.Piece("Moves pill", SkinSlots.Plate, hud.Moves, root, HudLayout.PlateBorderScale);
            moves = ui.Label("Moves remaining", "", hud.Moves, hud.PillPt, SkinTokens.Text, root, true);
            if (hud.Pressure.height > 0)
            {
                ui.Piece("Pressure pill", SkinSlots.Plate, hud.Pressure, root, HudLayout.PlateBorderScale);
                pressure = ui.Label("Pressure", "", hud.Pressure, hud.PillPt, SkinTokens.Objective, root, true);
            }

            ui.Piece("Primary plate", SkinSlots.Plate, hud.PrimaryPlate, root, HudLayout.PlateBorderScale);
            objectiveLabel = ui.Label("Theme label", "", hud.PrimaryCaption, hud.CaptionPt, SkinTokens.Text, root, false, TextAlignmentOptions.Left);
            objective = ui.Label("Theme", "0", hud.PrimaryValue, hud.CardValuePt, SkinTokens.Objective, root, true, TextAlignmentOptions.Right);
            if (hud.Campaign)
            {
                ui.Piece("Secondary plate", SkinSlots.Plate, hud.SecondaryPlate, root, HudLayout.PlateBorderScale);
                secondaryLabel = ui.Label("Secondary label", "", hud.SecondaryCaption, hud.CaptionPt, SkinTokens.Text, root, false, TextAlignmentOptions.Left);
            }
            for (int i = 0; i < 3; i++)
            {
                int source = i;
                var rect = hud.Star(i);
                var hitArea = ui.Rect<Image>("Star " + i, rect, root);
                hitArea.color = Color.clear; hitArea.raycastTarget = true;
                starButtons[i] = hitArea.gameObject.AddComponent<Button>(); starButtons[i].transition = Selectable.Transition.None;
                starButtons[i].onClick.AddListener(() => owner.ShowStar(source));
                float inset = rect.width * HudLayout.StarGlyphInset;
                stars[i] = ui.Star("Star " + i + " glyph", new Rect(rect.x + inset, rect.y + inset, rect.width - 2 * inset, rect.height - 2 * inset), false, hitArea.transform);
            }


            guardianRuleHeading = ui.Label("Guardian earning label", "", hud.RuleHeading, hud.RuleHeadingPt, SkinTokens.Accent, root, true,
                TextAlignmentOptions.BottomLeft);
            guardianRule = ui.Label("Guardian earning rule", "", hud.Rule, hud.RulePt, SkinTokens.Text, root, false, TextAlignmentOptions.TopLeft);
            guardianButton = ui.IconButton("Guardian action", Layout.GuardianButton, SkinSlots.IconTotem, owner.SelectGuardian, root, true,
                out guardianGlyph, out guardianLabel);
            rerollButton = ui.IconButton("Reroll action", Layout.RerollButton, SkinSlots.IconReroll, owner.Reroll, root, true,
                out rerollGlyph, out rerollLabel);
            ui.IconButton("Pause", Layout.PauseButton, SkinSlots.IconPause, owner.Pause, root, false, out _, out _);

            statusPlate = ui.Piece("Action status plate", SkinSlots.Plate, hud.Status, root, HudLayout.PlateBorderScale);
            status = ui.Label("Action status", "", hud.Status, hud.StatusPt, SkinTokens.Text, root);
            statusPlate.enabled = false;
            // This always-rendered transparent surface already has a canvas
            // depth when a dialog opens. It catches the opening frame while new
            // dialog graphics are waiting for their first rendered layout.
            modalShield = ui.Rect<Image>("Modal input shield", new Rect(0, 0, Screen.width, Screen.height), root);
            modalShield.color = Color.clear; modalShield.raycastTarget = false;
        }

        public void Summary(RunSummary state, BoardSession session, bool available)
        {
            heading.text = HudLayout.TitleText(art, session);
            score.text = HudLayout.ScoreText(state, session);
            scoreLabel.text = HudLayout.ScoreCaptionText(session);
            if (progressFill != null)
            {
                var full = progressFill.transform.parent.GetComponent<RectTransform>().rect;
                progressFill.rectTransform.sizeDelta = new Vector2(full.width * HudLayout.ScoreProgress(state, session), full.height);
            }
            moves.text = HudLayout.MovesText(state, session);
            objectiveLabel.text = HudLayout.PrimaryCaptionText(session);
            objective.text = HudLayout.PrimaryText(state, session);
            if (secondaryLabel != null) secondaryLabel.text = HudLayout.SecondaryCaptionText(session);
            if (pressure != null) pressure.text = HudLayout.PressureText(state);
            for (int i = 0; i < 3; i++)
            {
                starButtons[i].gameObject.SetActive(!session.Daily);
                stars[i].sprite = ui.StarSprite((state.LatchedStarSources & (1 << i)) != 0, stars[i].rectTransform.rect.height);
            }
            guardianLabel.text = state.BonusCharges.ToString();
            guardianGlyph.sprite = art.SkinUi(state.BonusType == 1 ? SkinSlots.IconHammer : state.BonusType == 3 ? SkinSlots.IconWave : SkinSlots.IconTotem);
            var rule = art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
            bool showEarningRule = state.BonusCharges == 0 && rule != null;
            guardianRuleHeading.gameObject.SetActive(showEarningRule); guardianRule.gameObject.SetActive(showEarningRule);
            guardianRuleHeading.text = HudLayout.GuardianCaption(state.BonusType);
            guardianRule.text = rule?.description ?? "";
            rerollLabel.text = state.RerollCharges.ToString();
            SetAvailable(guardianButton, guardianGlyph, available && state.BonusCharges > 0);
            SetAvailable(rerollButton, rerollGlyph, available && state.RerollCharges > 0);
            NeedsTextReflow = new[] { heading, moves, pressure, score, scoreLabel, objective, objectiveLabel, secondaryLabel, guardianRuleHeading, guardianRule }
                .Any(label => label != null && label.gameObject.activeInHierarchy && label.GetPreferredValues(label.text, label.rectTransform.rect.width, float.PositiveInfinity).y > label.rectTransform.rect.height + .5f);
        }
        private static void SetAvailable(Button button, Image glyph, bool available)
        {
            button.interactable = available;
            var tint = available ? Color.white : new Color(.55f, .55f, .55f, .8f);
            button.image.color = tint; glyph.color = tint;
        }
        public void Status(string text)
        {
            status.text = text;
            if (statusPlate != null) statusPlate.enabled = !string.IsNullOrEmpty(text);
        }
        public void ShowGains(uint scoreGain, ulong themeGain, byte combo, bool reducedMotion)
        {
            if (scoreGain == 0 && themeGain == 0) return;
            float d = Layout.Density;
            float y = Layout.Board.yMax - Layout.Cell;
            float width = Layout.Board.width - 8 * d, lane = (width - 4 * d) / 2;
            var scoreChip = scoreGain > 0 ? CueText("Accepted score chip", "+" + scoreGain, SkinTokens.Score, 26) : null;
            var themeChip = themeGain > 0 ? CueText("Accepted theme chip", "+" + themeGain + " THEME", SkinTokens.Objective, 16) : null;
            // Long accepted amounts get measured full-width rows, preserving
            // the requested font size instead of spilling into another cue.
            bool stacked = new[] { scoreChip, themeChip }.Any(t => t != null &&
                t.GetPreferredValues(t.text, float.PositiveInfinity, float.PositiveInfinity).x + 4 * d > lane);
            if (scoreChip != null)
            {
                PlaceCue(scoreChip, Layout.Board.x + 4 * d, y, stacked ? width : lane);
                if (stacked) y = scoreChip.rectTransform.anchoredPosition.y - 4 * d;
                StartChip(scoreChip, score, reducedMotion || stacked);
            }
            if (themeChip != null)
            {
                PlaceCue(themeChip, stacked ? Layout.Board.x + 4 * d : Layout.Board.center.x + 2 * d, y, stacked ? width : lane);
                StartChip(themeChip, objective, reducedMotion || stacked);
            }
            if (combo > 1)
            {
                var label = CueText("Accepted combo", "COMBO ×" + combo, SkinTokens.Accent, 12);
                float bottom = new[] { scoreChip, themeChip }.Where(t => t != null)
                    .Min(t => t.rectTransform.anchoredPosition.y);
                PlaceCue(label, Layout.Board.x + 4 * d, bottom - 4 * d, width);
                StartCoroutine(HoldPerfectClear(label));
            }
        }
        private void EarnedChip(string name, string value, Rect rect, TMP_Text destination, string token, float size, bool reducedMotion)
        {
            var label = CueText(name, value, token, size);
            PlaceCue(label, Layout.Board.x + 4 * Layout.Density, rect.yMax, Layout.Board.width - 8 * Layout.Density);
            StartChip(label, destination, reducedMotion);
        }
        private TMP_Text CueText(string name, string value, string token, float size)
        {
            var label = ui.Label(name, value, Rect.zero, size, token, canvas.transform, true);
            label.transform.SetSiblingIndex(modalShield.transform.GetSiblingIndex());
            return label;
        }
        private void PlaceCue(TMP_Text label, float x, float top, float width)
        {
            float height = Mathf.Ceil(label.GetPreferredValues(label.text, width, float.PositiveInfinity).y) + 4 * Layout.Density;
            var rect = new Rect(x, Mathf.Clamp(top - height, Layout.Board.yMin + 4 * Layout.Density,
                Layout.Board.yMax - height - 4 * Layout.Density), width, height);
            SkinUi.Place(label.rectTransform, rect, canvas.transform);
        }
        private void StartChip(TMP_Text label, TMP_Text destination, bool reducedMotion)
        {
            var size = label.rectTransform.sizeDelta;
            var target = (Vector2)destination.rectTransform.TransformPoint(destination.rectTransform.rect.center) - size / 2;
            // Chips rise straight toward the HUD and keep their own lane.
            target.x = label.rectTransform.anchoredPosition.x;
            // The entire glyph allowance stays inside the board. Travel aims
            // toward the readout but ends before entering its labels or keys.
            float inset = 4 * Layout.Density;
            target.x = Mathf.Clamp(target.x, Layout.Board.xMin + inset, Layout.Board.xMax - size.x - inset);
            target.y = Mathf.Clamp(target.y, Layout.Board.yMin + inset, Layout.Board.yMax - size.y - inset);
            StartCoroutine(TravelChip(label, target, reducedMotion));
        }
        private static IEnumerator TravelChip(TMP_Text label, Vector2 target, bool reducedMotion)
        {
            var origin = label.rectTransform.anchoredPosition;
            // Reduced motion keeps the amount at its separate in-board origin.
            // Authoritative totals and inventory counts remain unobstructed.
            for (float elapsed = 0; elapsed < .9f; elapsed += Time.unscaledDeltaTime)
            {
                if (!reducedMotion)
                    label.rectTransform.anchoredPosition = Vector2.Lerp(origin, target,
                        Mathf.SmoothStep(0, 1, Mathf.InverseLerp(.2f, .9f, elapsed)));
                label.alpha = Mathf.Clamp01((.9f - elapsed) / (reducedMotion ? .2f : .45f));
                yield return null;
            }
            Destroy(label.gameObject);
        }
        private void PerfectClear(bool rerollGranted, bool reducedMotion)
        {
            float d = Layout.Density;
            float top = Layout.Board.center.y - Layout.Cell / 2 + 40 * d;
            // Gains travel upward; their measured current lower edge and the
            // stationary combo reserve room for the later clear observation.
            // This also coordinates reduced-motion cues that stay at origin.
            foreach (var cue in canvas.GetComponentsInChildren<TMP_Text>())
                if (cue.name == "Accepted score chip" || cue.name == "Accepted theme chip" || cue.name == "Accepted combo")
                    top = Mathf.Min(top, cue.rectTransform.anchoredPosition.y - 4 * d);
            var title = CueText("Accepted perfect clear", "PERFECT CLEAR", SkinTokens.Accent, 25);
            PlaceCue(title, Layout.Board.x + 4 * d, top, Layout.Board.width - 8 * d);
            StartCoroutine(HoldPerfectClear(title));
            var rect = new Rect(Layout.Board.x, title.rectTransform.anchoredPosition.y - 32 * d, Layout.Board.width, 28 * d);
            if (rerollGranted)
                EarnedChip("Accepted reroll chip", "+1 REROLL", rect, rerollLabel, SkinTokens.Accent, 16, reducedMotion);
            else
            {
                var full = CueText("Accepted reroll cap", "REROLLS FULL", SkinTokens.Text, 14);
                PlaceCue(full, Layout.Board.x + 4 * d, rect.yMax, Layout.Board.width - 8 * d);
                StartCoroutine(HoldPerfectClear(full));
            }
        }
        private static IEnumerator HoldPerfectClear(TMP_Text label)
        {
            for (float elapsed = 0; elapsed < 1.1f; elapsed += Time.unscaledDeltaTime)
            {
                label.alpha = Mathf.Clamp01((1.1f - elapsed) / .2f);
                yield return null;
            }
            Destroy(label.gameObject);
        }
        public static string ObjectiveName(byte kind, byte value) => PageCatalog.Load().ObjectiveName(kind, value);

        public void SetBoard(byte[] grid)
        {
            foreach (var block in blocks.Values) Destroy(block.gameObject);
            blocks.Clear(); DisplayGrid = (byte[])grid.Clone();
            for (int row = 0; row < 10; row++) for (int col = 0; col < 8;)
            {
                byte width = grid[row * 8 + col];
                if (width == 0) { col++; continue; }
                var sprite = NewSprite("Block " + row + ":" + col, BlockSprite(width), 2);
                PositionBlock(sprite, row, col, width); blocks.Add(row * 8 + col, sprite); col += width;
            }
        }
        public void SetPreview(byte presence, byte[] row)
        {
            foreach (var block in preview) Destroy(block.gameObject); preview.Clear();
            if (presence == 0) return;
            for (int col = 0; col < 8;)
            {
                byte width = row[col]; if (width == 0) { col++; continue; }
                var sprite = NewSprite("Next block " + col, BlockSprite(width), 2);
                Size(sprite, new Rect(Layout.Preview.x + col * Layout.Cell + 1, Layout.Preview.y + 1, width * Layout.Cell - 2, Layout.Cell - 2));
                sprite.color = new Color(1, 1, 1, .85f); preview.Add(sprite); col += width;
            }
        }
        private Sprite BlockSprite(byte width) => art.SkinRealm(SkinSlots.Block(width));

        public IEnumerator Trace(PresentationEvent[] events, bool reducedMotion, Action<string> sound)
        {
            for (int index = 0; index < events.Length; index++)
            {
                var item = events[index];
                if (item.Kind == PresentationKind.BlockMoved)
                {
                    var targets = new Dictionary<SpriteRenderer, Vector3>();
                    var starts = new Dictionary<SpriteRenderer, Vector3>();
                    byte reason = item.Payload[0];
                    do
                    {
                        var e = events[index]; var p = e.Payload;
                        int from = p[1] * 8 + p[2], to = p[3] * 8 + p[4];
                        if (!blocks.TryGetValue(from, out var sprite)) throw new InvalidOperationException("Native movement has no visible source");
                        if (!starts.ContainsKey(sprite)) starts.Add(sprite, sprite.transform.position);
                        targets[sprite] = Layout.CellCenter(p[3], p[4], p[5]);
                        blocks.Remove(from); blocks[to] = sprite;
                        DisplayGrid = PresentationTrace.ProjectBoard(DisplayGrid, new[] { e });
                        index++;
                    } while (index < events.Length && events[index].Kind == PresentationKind.BlockMoved && events[index].Payload[0] == reason);
                    index--;
                    sound(reason == 0 ? "move" : "swipe");
                    float duration = reducedMotion ? 0 : reason == 0 ? .1f : .22f;
                    for (float elapsed = 0; elapsed < duration; elapsed += Time.unscaledDeltaTime)
                    {
                        float t = Mathf.SmoothStep(0, 1, elapsed / duration);
                        foreach (var pair in targets) pair.Key.transform.position = Vector3.Lerp(starts[pair.Key], pair.Value, t);
                        yield return null;
                    }
                    foreach (var pair in targets) pair.Key.transform.position = pair.Value;
                    continue;
                }
                if (item.Kind == PresentationKind.RowsCleared || item.Kind == PresentationKind.BonusApplied)
                {
                    byte[] after = PresentationTrace.ProjectBoard(DisplayGrid, new[] { item });
                    var removed = blocks.Where(pair => after[pair.Key] == 0).Select(pair => pair.Value).ToArray();
                    sound(item.Kind == PresentationKind.RowsCleared ? "break" : "bonus-activate");
                    var flash = art.Token(SkinTokens.Accent);
                    foreach (var sprite in removed) sprite.color = flash;
                    yield return new WaitForSecondsRealtime(reducedMotion ? .05f : .1f);
                    SetBoard(after);
                }
                else if (item.Kind == PresentationKind.PreviewChanged)
                {
                    SetPreview(item.Payload[0], item.Payload.Skip(1).ToArray());
                }
                else if (item.Kind == PresentationKind.RowInserted)
                {
                    var positions = blocks.Values.ToDictionary(s => s, s => s.transform.position);
                    float duration = reducedMotion ? 0 : .18f;
                    for (float elapsed = 0; elapsed < duration; elapsed += Time.unscaledDeltaTime)
                    {
                        foreach (var pair in positions) pair.Key.transform.position = pair.Value + Vector3.up * Layout.Cell * Mathf.SmoothStep(0, 1, elapsed / duration);
                        yield return null;
                    }
                    SetBoard(PresentationTrace.ProjectBoard(DisplayGrid, new[] { item }));
                }
                else if (item.Kind == PresentationKind.BoardReplaced)
                    SetBoard(PresentationTrace.ProjectBoard(DisplayGrid, new[] { item }));
                else if (item.Kind == PresentationKind.PerfectClear)
                    PerfectClear(item.Payload[0] == 1, reducedMotion);
                else if (item.Kind != PresentationKind.Terminal)
                    throw new InvalidOperationException("Unsupported presentation event " + item.Kind);
            }
        }

        // The ghost follows the pointer inside the empty run [minStart, maxStart].
        public void Ghost(int row, int start, int width, float screenX, int minStart, int maxStart)
        {
            if (ghost == null) ghost = NewSprite("Unaccepted drag preview", BlockSprite((byte)width), 6);
            PositionBlock(ghost, row, start, width);
            var position = ghost.transform.position;
            position.x = Mathf.Clamp(screenX, Layout.CellCenter(row, minStart, width).x, Layout.CellCenter(row, maxStart, width).x);
            ghost.transform.position = position; ghost.color = new Color(1, 1, 1, .55f);
        }
        public void ClearGhost() { if (ghost != null) Destroy(ghost.gameObject); ghost = null; }

        public void OpenModal(string title, string body, params (string label, Action action)[] actions)
        {
            CloseModal();
            modalShield.color = art.Token(SkinTokens.Scrim); modalShield.raycastTarget = true;
            modal = new GameObject("Modal content", typeof(RectTransform));
            modal.transform.SetParent(modalShield.transform, false);
            SkinUi.Place(modal.GetComponent<RectTransform>(), new Rect(0, 0, Screen.width, Screen.height), modalShield.transform);
            float d = Layout.Density, width = Layout.Frame.width - 32 * d, inner = width - 48 * d;
            float titleHeight = ui.TextHeight(title, inner, 22, true) + 4 * d;
            float bodyHeight = ui.TextHeight(body, inner, 14, false) + 4 * d;
            var buttonHeights = actions.Select(action => Mathf.Max(52 * d, ui.TextHeight(action.label, inner - 20 * d, 15, true) + 24 * d)).ToArray();
            float contentHeight = 28 * d + titleHeight + 8 * d + bodyHeight + 16 * d + buttonHeights.Sum() + actions.Length * 8 * d + 20 * d;
            float height = Mathf.Min(Layout.Frame.height - 24 * d, contentHeight);
            var rect = new Rect(Layout.Frame.center.x - width / 2, Layout.Frame.center.y - height / 2, width, height);
            var panel = ui.Piece("Stone dialog", SkinSlots.Dialog, rect, modal.transform);
            panel.raycastTarget = true;
            Transform content = modal.transform;
            var contentRect = new Rect(rect.x, rect.yMax - contentHeight, width, contentHeight);
            if (contentHeight > height)
            {
                // Short safe areas scroll dialog content instead of hiding the
                // last action or reducing its requested font/hit size.
                var viewport = ui.Rect<Image>("Dialog viewport", rect, panel.transform);
                viewport.color = Color.clear; viewport.gameObject.AddComponent<RectMask2D>();
                var bodyRoot = new GameObject("Dialog scroll content", typeof(RectTransform));
                bodyRoot.transform.SetParent(viewport.transform, false);
                SkinUi.Place(bodyRoot.GetComponent<RectTransform>(), contentRect, viewport.transform);
                var scroll = viewport.gameObject.AddComponent<ScrollRect>(); scroll.viewport = viewport.rectTransform;
                scroll.content = bodyRoot.GetComponent<RectTransform>(); scroll.horizontal = false;
                scroll.movementType = ScrollRect.MovementType.Clamped; scroll.verticalNormalizedPosition = 1;
                content = bodyRoot.transform;
            }
            float cursor = contentRect.yMax - 28 * d;
            ui.Label("Dialog title", title, new Rect(rect.x + 24 * d, cursor - titleHeight, inner, titleHeight), 22, SkinTokens.Accent, content, true);
            cursor -= titleHeight + 8 * d;
            ui.Label("Dialog details", body, new Rect(rect.x + 24 * d, cursor - bodyHeight, inner, bodyHeight), 14, SkinTokens.Text, content);
            cursor -= bodyHeight + 16 * d;
            for (int i = 0; i < actions.Length; i++)
            {
                cursor -= buttonHeights[i];
                ui.TextButton("Dialog " + actions[i].label, new Rect(rect.x + 24 * d, cursor, inner, buttonHeights[i]), actions[i].label,
                    actions[i].action, i == 0, content, out _);
                cursor -= 8 * d;
            }
        }
        public void CloseModal()
        {
            if (modal != null) { modal.SetActive(false); Destroy(modal); }
            modal = null;
            if (modalShield != null) { modalShield.color = Color.clear; modalShield.raycastTarget = false; }
        }
        public void Terminal(bool completed) { guardian.sprite = art.Sprite(completed ? "boss__celebrate" : "boss__defeated"); }

        private SpriteRenderer NewSprite(string name, Sprite sprite, int order)
        {
            var go = new GameObject(name, typeof(SpriteRenderer)); go.transform.SetParent(boardRoot, false);
            var renderer = go.GetComponent<SpriteRenderer>(); renderer.sprite = sprite; renderer.sortingOrder = order;
            return renderer;
        }
        // Stretched board pieces keep their authored borders at the kit scale.
        private void Sliced(string name, Sprite sprite, Rect rect, int order, float chrome = 1)
        {
            var renderer = NewSprite(name, sprite, order);
            float scale = sprite.pixelsPerUnit * ui.Ui * chrome;
            renderer.drawMode = SpriteDrawMode.Sliced;
            renderer.size = rect.size / scale;
            renderer.transform.localScale = new Vector3(scale, scale, 1);
            renderer.transform.position = rect.center;
        }
        private static Rect Grow(Rect rect, float x, float y) => new Rect(rect.x - x, rect.y - y, rect.width + 2 * x, rect.height + 2 * y);
        private void PositionBlock(SpriteRenderer renderer, int row, int col, int width)
        {
            var p = Layout.CellCenter(row, col, width);
            Size(renderer, new Rect(p.x - width * Layout.Cell / 2 + 1, p.y - Layout.Cell / 2 + 1, width * Layout.Cell - 2, Layout.Cell - 2));
        }
        private static void Size(SpriteRenderer renderer, Rect rect, bool cover = false)
        {
            var bounds = renderer.sprite.bounds.size;
            Vector2 scale = new Vector2(rect.width / bounds.x, rect.height / bounds.y);
            if (cover) scale = Vector2.one * Mathf.Max(scale.x, scale.y);
            renderer.transform.localScale = new Vector3(scale.x, scale.y, 1);
            renderer.transform.position = rect.center;
        }
        private void OnDestroy() => ui?.Dispose();
    }
}
