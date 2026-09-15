using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    public sealed class BoardView : MonoBehaviour
    {
        private readonly Dictionary<int, SpriteRenderer> blocks = new Dictionary<int, SpriteRenderer>();
        private readonly List<SpriteRenderer> preview = new List<SpriteRenderer>();
        private readonly List<GameObject> geometry = new List<GameObject>();
        private BoardArt art;
        private BoardController owner;
        private BoardTypography typography;
        public float TextScale => typography.Scale;
        public bool NeedsTextReflow { get; private set; }
        private Canvas canvas;
        private Transform boardRoot;
        private Camera boardCamera;
        private Sprite white;
        private Texture2D whiteTexture;
        private Texture2D shadeTexture;
        private Sprite shadeSprite;
        private Material stoneMaterial;
        private Image guardian;
        private BoardActionIcon guardianIcon, rerollIcon;
        private TMP_Text score, objective, moves, status, heading, scoreLabel, objectiveLabel;
        private TMP_Text guardianLabel, rerollLabel;
        private TMP_Text guardianRuleHeading, guardianRule;
        private readonly TMP_Text[] stars = new TMP_Text[3];
        private Button guardianButton, rerollButton;
        private GameObject modal;
        private Image modalShield;
        private SpriteRenderer ghost;
        public BoardLayout Layout { get; private set; }
        [NonSerialized] private int layoutFrame = -1;
        [NonSerialized] private int renderedFrame = -1;
        [NonSerialized] private Vector2Int viewport;
        [NonSerialized] private Rect safeArea;
        public bool HasRuntimeGraph => art != null && canvas != null && boardCamera != null && guardian != null &&
            score != null && objective != null && status != null && Pointer != null &&
            Layout.Cell > 0 && Layout.Density > 0 && Layout.Board.width > 0 && Layout.Board.height > 0;
        public bool RenderedLayoutMatchesScreen => HasRuntimeGraph && viewport.x == Screen.width && viewport.y == Screen.height &&
            safeArea == Screen.safeArea && canvas.isActiveAndEnabled && boardCamera.isActiveAndEnabled &&
            renderedFrame > layoutFrame && renderedFrame >= Time.frameCount - 1;
        private void OnRenderObject()
        {
            if (Camera.current == boardCamera && HasRuntimeGraph) renderedFrame = Time.frameCount;
        }
        public byte[] DisplayGrid { get; private set; } = new byte[80];
        public bool GuardianEnabled => guardianButton != null && guardianButton.interactable;
        public bool RerollEnabled => rerollButton != null && rerollButton.interactable;
        public BoardPointer Pointer { get; private set; }
        public string StatusText => status == null ? "" : status.text;
        public bool IsSettled(byte[] grid)
        {
            if (!DisplayGrid.SequenceEqual(grid)) return false;
            int count = 0;
            for (int row = 0; row < 10; row++) for (int column = 0; column < 8;)
            {
                int width = grid[row * 8 + column];
                if (width == 0) { column++; continue; }
                if (!blocks.TryGetValue(row * 8 + column, out var sprite) ||
                    Vector2.Distance(sprite.transform.position, Layout.CellCenter(row, column, width)) > .01f) return false;
                count++; column += width;
            }
            return count == blocks.Count;
        }
        private readonly Color gold = new Color32(250, 204, 21, 255);
        private readonly Color themeInk = new Color32(56, 189, 248, 255);
        private readonly Color pale = new Color(.95f, .94f, .85f);
        private readonly Color dim = new Color(.42f, .48f, .45f);

        public void Create(BoardController controller, BoardArt source, BoardLayout layout, BoardTypography type)
        {
            owner = controller; art = source; Layout = layout; typography = type;
            layoutFrame = Time.frameCount; renderedFrame = -1;
            viewport = new Vector2Int(Screen.width, Screen.height); safeArea = Screen.safeArea;
            whiteTexture = new Texture2D(16, 16, TextureFormat.RGBA32, false);
            for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++)
            {
                var nearest = new Vector2(Mathf.Clamp(x + .5f, 4, 12), Mathf.Clamp(y + .5f, 4, 12));
                float alpha = Mathf.Clamp01(4.5f - Vector2.Distance(new Vector2(x + .5f, y + .5f), nearest));
                whiteTexture.SetPixel(x, y, new Color(1, 1, 1, alpha));
            }
            whiteTexture.Apply();
            white = Sprite.Create(whiteTexture, new Rect(0, 0, 16, 16), Vector2.one / 2, 100, 0, SpriteMeshType.FullRect, new Vector4(6, 6, 6, 6));
            boardCamera = new GameObject("Board Camera", typeof(Camera)).GetComponent<Camera>();
            boardCamera.transform.SetParent(transform, false);
            boardCamera.orthographic = true;
            boardCamera.orthographicSize = Screen.height / 2f;
            boardCamera.transform.position = new Vector3(Screen.width / 2f, Screen.height / 2f, -10);
            boardCamera.backgroundColor = art.Color("background", new Color(.03f, .1f, .08f));
            boardCamera.clearFlags = CameraClearFlags.SolidColor;
            boardRoot = new GameObject("Native board sprites").transform; boardRoot.SetParent(transform, false);
            var shader = Resources.Load<Shader>("ZKube/StoneSurface");
            if (shader == null) throw new InvalidOperationException("Bundled stone surface shader is missing");
            stoneMaterial = new Material(shader);
            stoneMaterial.SetColor("_Tint", art.Color("accent", new Color(.3f, .68f, .31f)));
            stoneMaterial.SetFloat("_BlackVeil", .62f);
            var bg = NewSprite("Continuous realm stone", art.Sprite("grid-bg"), -10);
            bg.sharedMaterial = stoneMaterial;
            Size(bg, new Rect(0, 0, Screen.width, Screen.height), true);
            // A soft shade lies on the same stone; there is no second board
            // rectangle and no scenic strip between board and rails.
            shadeTexture = new Texture2D(64, 64, TextureFormat.RGBA32, false);
            for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++)
            {
                var offset = new Vector2((x + .5f) / 32 - 1, ((y + .5f) / 64 - .55f) * 2);
                float a = .62f * (1 - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(.55f, 1.2f, offset.magnitude)));
                shadeTexture.SetPixel(x, y, new Color(0, 0, 0, a));
            }
            shadeTexture.Apply();
            shadeSprite = Sprite.Create(shadeTexture, new Rect(0, 0, 64, 64), Vector2.one / 2, 100);
            var shade = NewSprite("Soft board shade", shadeSprite, -8);
            Size(shade, new Rect(layout.Frame.x, layout.Preview.y - 10 * layout.Density, layout.Frame.width,
                layout.Board.yMax - layout.Preview.y + 20 * layout.Density));
            for (int row = 0; row < 10; row++) for (int col = 0; col < 8; col++)
            {
                var cell = NewSprite("Cell " + row + ":" + col, white, -4);
                cell.color = art.Color((row + col) % 2 == 0 ? "gridBg" : "gridCellAlt", new Color(.04f, .14f, .11f));
                var p = layout.CellCenter(row, col);
                Size(cell, new Rect(p.x - layout.Cell / 2 + 1, p.y - layout.Cell / 2 + 1, layout.Cell - 2, layout.Cell - 2));
            }
            canvas = new GameObject("Board interface", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster)).GetComponent<Canvas>();
            canvas.transform.SetParent(transform, false); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.pixelPerfect = true;
            BuildHud();
        }

        private void BuildHud()
        {
            float d = Layout.Density, w = Layout.Frame.width, top = Layout.Frame.yMax, x = Layout.Frame.x;
            float compact = Layout.Compact ? .72f : 1;
            var hit = Panel("Board gesture surface", Layout.Board, Color.clear);
            hit.raycastTarget = true; Pointer = hit.gameObject.AddComponent<BoardPointer>(); Pointer.Owner = owner;
            var rail = art.Color("accent", Color.white); rail.a = .18f;
            var plate = art.Color("hudBar", Color.black); plate.a = .9f;
            Panel("Top rail lip", new Rect(x, top - Layout.Header, w, d), rail);
            heading = Text("Run title", art.Title(owner.Session).ToUpperInvariant(), typography.Title, 12 * d, gold);
            Panel("Score plate", typography.ScorePlate, plate);
            Panel("Theme plate", typography.ThemePlate, plate);
            guardian = Panel("Calm realm guardian", typography.Guardian, Color.white);
            guardian.sprite = art.Sprite("boss__idle"); guardian.type = Image.Type.Simple; guardian.preserveAspect = true;
            scoreLabel = Text("Score label", "SCORE", typography.ScoreLabel, 10 * d, gold);
            score = Text("Score", "0", typography.ScoreValue, 32 * d * compact, gold, true);
            objectiveLabel = Text("Theme label", "THEME", typography.ThemeLabel, 10 * d, themeInk);
            objective = Text("Theme", "0", typography.ThemeValue, 32 * d * compact, themeInk, true);
            float stripY = top - Layout.Header;
            moves = Text("Moves remaining", "", typography.Moves, 11 * d, pale);
            for (int i = 0; i < 3; i++)
            {
                int source = i;
                var rect = typography.Star(i);
                var button = MakeButton("Star " + i, rect, "☆", () => owner.ShowStar(source), Color.clear, out stars[i]);
                stars[i].fontSize = 23 * d * TextScale;
                button.transition = Selectable.Transition.None;
            }
            status = Text("Action status", "", typography.Status, 9 * d, gold);
            Text("Next row caption", "▲  NEXT ROW", new Rect(Layout.Preview.x, Layout.Preview.yMax, Layout.Preview.width, 14 * d), 8 * d, dim);
            Panel("Next row hairline", new Rect(Layout.Preview.x, Layout.Preview.yMax + 14 * d, Layout.Preview.width, d), new Color(.7f, .66f, .44f, .22f));
            var tray = art.Color("actionBarBg", Color.black); tray.a = .16f;
            Panel("Action tray shade", new Rect(x, Layout.Frame.y, w, Layout.Footer), tray);
            Panel("Action tray lip", new Rect(x, Layout.Frame.y + Layout.Footer - d, w, d), rail);
            guardianButton = MakeButton("Guardian action", Layout.GuardianButton, "0", owner.SelectGuardian, gold, out guardianLabel);
            var key = Layout.GuardianButton;
            guardianIcon = ActionIcon("Guardian icon", key, guardianButton.transform, BoardActionIcon.Symbol.Totem);
            Place(guardianLabel.rectTransform, new Rect(key.xMax - 34 * d, key.y + 2 * d, 32 * d, 24 * d), guardianButton.transform);
            guardianLabel.fontSize = 13 * d * TextScale;
            guardianRuleHeading = Text("Guardian earning label", "EARN TOTEM", typography.RuleHeading, 10 * d, gold);
            guardianRule = Text("Guardian earning rule", "", typography.Rule, 12 * d, pale);
            guardianRule.enableAutoSizing = false;
            rerollButton = MakeButton("Reroll action", Layout.RerollButton, "1", owner.Reroll, gold, out rerollLabel);
            rerollIcon = ActionIcon("Reroll icon", Layout.RerollButton, rerollButton.transform, BoardActionIcon.Symbol.Reroll);
            var rerollKey = Layout.RerollButton;
            Place(rerollLabel.rectTransform, new Rect(rerollKey.xMax - 34 * d, rerollKey.y + 2 * d, 32 * d, 24 * d), rerollButton.transform);
            rerollLabel.fontSize = 13 * d * TextScale;
            var pause = MakeButton("Pause", Layout.PauseButton, "", owner.Pause, new Color(.06f, .14f, .1f), out var pauseLabel);
            ActionIcon("Pause icon", Layout.PauseButton, pause.transform, BoardActionIcon.Symbol.Pause).color = pale;
            // This always-rendered transparent surface already has a canvas
            // depth when a dialog opens. It catches the opening frame while new
            // dialog graphics are waiting for their first rendered layout.
            modalShield = Panel("Modal input shield", new Rect(0, 0, Screen.width, Screen.height), Color.clear);
            modalShield.raycastTarget = false;
        }

        public void Summary(RunSummary state, BoardSession session, bool available)
        {
            heading.text = art.Title(session).ToUpperInvariant();
            score.text = BoardTypography.ScoreText(state, session);
            scoreLabel.text = BoardTypography.ScoreCaption(session);
            objectiveLabel.text = BoardTypography.ThemeCaption(session);
            objective.text = BoardTypography.ThemeText(state, session);
            moves.text = Math.Max(0, session.Rules.MaxMoves - state.Moves) + " MOVES";
            for (int i = 0; i < 3; i++)
            {
                stars[i].transform.parent.gameObject.SetActive(!session.Daily);
                stars[i].text = (state.LatchedStarSources & (1 << i)) != 0 ? "★" : "☆";
                stars[i].color = (state.LatchedStarSources & (1 << i)) != 0 ? gold : dim;
            }
            guardianLabel.text = state.BonusCharges.ToString();
            guardianIcon.Shape = state.BonusType == 1 ? BoardActionIcon.Symbol.Hammer : state.BonusType == 3 ? BoardActionIcon.Symbol.Wave : BoardActionIcon.Symbol.Totem;
            guardianIcon.color = state.BonusCharges > 0 && available ? new Color(.2f, .16f, .04f) : dim;
            var rule = art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
            bool showEarningRule = state.BonusCharges == 0 && rule != null;
            guardianRuleHeading.gameObject.SetActive(showEarningRule); guardianRule.gameObject.SetActive(showEarningRule);
            guardianRuleHeading.text = BoardTypography.GuardianCaption(state.BonusType);
            guardianRule.text = rule?.description ?? "";
            rerollLabel.text = state.RerollCharges.ToString();
            rerollIcon.color = state.RerollCharges > 0 && available ? new Color(.2f, .16f, .04f) : dim;
            SetAvailable(guardianButton, guardianLabel, available && state.BonusCharges > 0);
            SetAvailable(rerollButton, rerollLabel, available && state.RerollCharges > 0);
            NeedsTextReflow = new[] { heading, moves, score, scoreLabel, objective, objectiveLabel, guardianRuleHeading, guardianRule }
                .Any(label => label.gameObject.activeInHierarchy && label.GetPreferredValues(label.text, label.rectTransform.rect.width, float.PositiveInfinity).y > label.rectTransform.rect.height + .5f);
        }
        private void SetAvailable(Button button, TMP_Text label, bool available)
        {
            button.interactable = available;
            button.image.color = available ? gold : new Color(.1f, .16f, .12f);
            label.color = available ? new Color(.14f, .13f, .04f) : dim;
        }
        public void Status(string text) { status.text = text; }
        public void ShowGains(uint scoreGain, ulong themeGain, byte combo, bool reducedMotion)
        {
            if (scoreGain == 0 && themeGain == 0) return;
            float d = Layout.Density;
            float y = Layout.Board.yMax - Layout.Cell;
            float width = Layout.Board.width - 8 * d, lane = (width - 4 * d) / 2;
            var scoreChip = scoreGain > 0 ? CueText("Accepted score chip", "+" + scoreGain, gold, 26 * d) : null;
            var themeChip = themeGain > 0 ? CueText("Accepted theme chip", "+" + themeGain + " THEME", themeInk, 16 * d) : null;
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
                var label = CueText("Accepted combo", "COMBO ×" + combo, gold, 12 * d);
                float bottom = new[] { scoreChip, themeChip }.Where(t => t != null)
                    .Min(t => t.rectTransform.anchoredPosition.y);
                PlaceCue(label, Layout.Board.x + 4 * d, bottom - 4 * d, width);
                StartCoroutine(HoldPerfectClear(label));
            }
        }
        private void EarnedChip(string name, string value, Rect rect, TMP_Text destination, Color color, float size, bool reducedMotion)
        {
            var label = CueText(name, value, color, size);
            PlaceCue(label, Layout.Board.x + 4 * Layout.Density, rect.yMax, Layout.Board.width - 8 * Layout.Density);
            StartChip(label, destination, reducedMotion);
        }
        private TMP_Text CueText(string name, string value, Color color, float size)
        {
            var label = Text(name, value, Rect.zero, size, color, true);
            label.transform.SetSiblingIndex(modalShield.transform.GetSiblingIndex());
            return label;
        }
        private void PlaceCue(TMP_Text label, float x, float top, float width)
        {
            float height = Mathf.Ceil(label.GetPreferredValues(label.text, width, float.PositiveInfinity).y) + 4 * Layout.Density;
            var rect = new Rect(x, Mathf.Clamp(top - height, Layout.Board.yMin + 4 * Layout.Density,
                Layout.Board.yMax - height - 4 * Layout.Density), width, height);
            Place(label.rectTransform, rect, null);
        }
        private void StartChip(TMP_Text label, TMP_Text destination, bool reducedMotion)
        {
            var size = label.rectTransform.sizeDelta;
            var target = (Vector2)destination.rectTransform.TransformPoint(destination.rectTransform.rect.center) - size / 2;
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
            var title = CueText("Accepted perfect clear", "PERFECT CLEAR", gold, 25 * d);
            PlaceCue(title, Layout.Board.x + 4 * d, top, Layout.Board.width - 8 * d);
            StartCoroutine(HoldPerfectClear(title));
            var rect = new Rect(Layout.Board.x, title.rectTransform.anchoredPosition.y - 32 * d, Layout.Board.width, 28 * d);
            if (rerollGranted)
                EarnedChip("Accepted reroll chip", "+1 REROLL", rect, rerollLabel, gold, 16 * d, reducedMotion);
            else
            {
                var full = CueText("Accepted reroll cap", "REROLLS FULL", pale, 14 * d);
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
        public static string ObjectiveName(byte kind, byte value)
        {
            switch (kind)
            {
                case 0: return "CLASSIC";
                case 1: return "COMBO ≥ " + value;
                case 2: return value == 0 ? "BREAK BLOCKS" : "BREAK SIZE " + value;
                case 3: return "CLEAR LINES";
                case 4: return "EXACT " + value + " LINES";
                case 5: return "SCORE ≥ " + value;
                case 6: return "GUARDIAN TRIGGERS";
                case 7: return "BONUS LINES";
                case 8: return "BONUS BLOCKS";
                case 9: return "COMBO ≥ " + value;
                case 10: return "CLEAR " + value + " LINES AT ONCE";
                case 11: return "CLEAR " + value + " LINES IN CONSECUTIVE MOVES";
                case 12: return "BREAK SIZE " + value + " IN ONE ACTION";
                case 13: return "BREAK EVERY WIDTH AT ONCE";
                case 14: return "MAKE A " + value + "-POINT MOVE";
                case 15: return "CLEAR " + value + " LINES WITH ONE BONUS";
                case 16: return "EMPTY THE BOARD";
                case 17: return "CLUTCH ≥ " + value;
                case 18: return "CLEAN ≤ " + value;
                default: return "OBJECTIVE " + kind;
            }
        }

        public void SetBoard(byte[] grid)
        {
            foreach (var block in blocks.Values) Destroy(block.gameObject);
            blocks.Clear(); DisplayGrid = (byte[])grid.Clone();
            for (int row = 0; row < 10; row++) for (int col = 0; col < 8;)
            {
                byte width = grid[row * 8 + col];
                if (width == 0) { col++; continue; }
                var sprite = NewSprite("Block " + row + ":" + col, art.Sprite("block-" + width), 2);
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
                var sprite = NewSprite("Next block " + col, art.Sprite("block-" + width), 2);
                Size(sprite, new Rect(Layout.Preview.x + col * Layout.Cell + 1, Layout.Preview.y + 1, width * Layout.Cell - 2, Layout.Cell - 2));
                sprite.color = new Color(1, 1, 1, .7f); preview.Add(sprite); col += width;
            }
        }

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
                    foreach (var sprite in removed) sprite.color = gold;
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

        public void Ghost(int row, int start, int width, float screenX)
        {
            if (ghost == null) ghost = NewSprite("Unaccepted drag preview", art.Sprite("block-" + width), 6);
            PositionBlock(ghost, row, start, width);
            var position = ghost.transform.position;
            position.x = Mathf.Clamp(screenX, Layout.Board.x + width * Layout.Cell / 2, Layout.Board.xMax - width * Layout.Cell / 2);
            ghost.transform.position = position; ghost.color = new Color(1, 1, 1, .55f);
        }
        public void ClearGhost() { if (ghost != null) Destroy(ghost.gameObject); ghost = null; }

        public void OpenModal(string title, string body, params (string label, Action action)[] actions)
        {
            CloseModal();
            modalShield.color = new Color(0, .02f, .01f, .86f); modalShield.raycastTarget = true;
            modal = new GameObject("Modal content", typeof(RectTransform));
            modal.transform.SetParent(modalShield.transform, false);
            Place(modal.GetComponent<RectTransform>(), new Rect(0, 0, Screen.width, Screen.height), modalShield.transform);
            float d = Layout.Density, width = Layout.Frame.width - 32 * d;
            var titleText = Text("Dialog title", title, new Rect(0, 0, width - 24 * d, 1), 26 * d, gold, true, modal.transform);
            var bodyText = Text("Dialog details", body, new Rect(0, 0, width - 24 * d, 1), 14 * d, pale, false, modal.transform);
            float titleHeight = titleText.GetPreferredValues(title, width - 24 * d, float.PositiveInfinity).y + 4 * d;
            float bodyHeight = bodyText.GetPreferredValues(body, width - 24 * d, float.PositiveInfinity).y + 4 * d;
            float bodySize = bodyText.fontSize; bodyText.fontSize = 13 * d * TextScale;
            var buttonHeights = actions.Select(action => Mathf.Max(48 * d,
                bodyText.GetPreferredValues(action.label, width - 32 * d, float.PositiveInfinity).y + 20 * d)).ToArray();
            bodyText.fontSize = bodySize;
            float contentHeight = titleHeight + bodyHeight + 36 * d + buttonHeights.Sum() + actions.Length * 6 * d;
            float height = Mathf.Min(Layout.Frame.height - 24 * d, contentHeight);
            var rect = new Rect(Layout.Frame.center.x - width / 2, Layout.Frame.center.y - height / 2, width, height);
            var panel = Panel("Stone dialog", rect, new Color(.045f, .12f, .085f), modal.transform);
            panel.raycastTarget = true;
            Transform content = modal.transform;
            var contentRect = new Rect(rect.x, rect.yMax - contentHeight, width, contentHeight);
            if (contentHeight > height)
            {
                // Short safe areas scroll dialog content instead of hiding the
                // last action or reducing its requested font/hit size.
                var viewport = new GameObject("Dialog viewport", typeof(RectTransform), typeof(Image), typeof(RectMask2D), typeof(ScrollRect));
                viewport.GetComponent<Image>().color = Color.clear;
                viewport.transform.SetParent(panel.transform, false); Place(viewport.GetComponent<RectTransform>(), rect, panel.transform);
                var bodyRoot = new GameObject("Dialog scroll content", typeof(RectTransform));
                bodyRoot.transform.SetParent(viewport.transform, false); Place(bodyRoot.GetComponent<RectTransform>(), contentRect, viewport.transform);
                var scroll = viewport.GetComponent<ScrollRect>(); scroll.viewport = viewport.GetComponent<RectTransform>();
                scroll.content = bodyRoot.GetComponent<RectTransform>(); scroll.horizontal = false;
                scroll.movementType = ScrollRect.MovementType.Clamped; scroll.verticalNormalizedPosition = 1;
                content = bodyRoot.transform;
            }
            titleText.transform.SetParent(content, false); bodyText.transform.SetParent(content, false);
            Place(titleText.rectTransform, new Rect(rect.x + 12 * d, contentRect.yMax - titleHeight - 8 * d, width - 24 * d, titleHeight), content);
            Place(bodyText.rectTransform, new Rect(rect.x + 12 * d, contentRect.yMax - titleHeight - bodyHeight - 12 * d, width - 24 * d, bodyHeight), content);
            // Keep the panel below its labels even in the non-scroll layout.
            panel.transform.SetAsFirstSibling();
            float buttonY = contentRect.y + 12 * d + buttonHeights.Sum() + Mathf.Max(0, actions.Length - 1) * 6 * d;
            for (int i = 0; i < actions.Length; i++)
            {
                buttonY -= buttonHeights[i];
                MakeButton("Dialog " + actions[i].label, new Rect(rect.x + 16 * d, buttonY, width - 32 * d, buttonHeights[i]),
                    actions[i].label, actions[i].action, new Color(.14f, .25f, .16f), out var label, content);
                buttonY -= 6 * d;
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
        private BoardActionIcon ActionIcon(string name, Rect button, Transform parent, BoardActionIcon.Symbol shape)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(BoardActionIcon));
            go.transform.SetParent(parent, false);
            float size = button.width * .52f;
            Place(go.GetComponent<RectTransform>(), new Rect(button.center.x - size / 2,
                button.center.y - size / 2 + (shape == BoardActionIcon.Symbol.Pause ? 0 : 6 * Layout.Density), size, size), parent);
            var icon = go.GetComponent<BoardActionIcon>(); icon.Shape = shape;
            icon.color = new Color(.2f, .16f, .04f); icon.raycastTarget = false; return icon;
        }
        private Image Panel(string name, Rect rect, Color color, Transform parent = null)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent == null ? canvas.transform : parent, false);
            Place(go.GetComponent<RectTransform>(), rect, parent);
            var image = go.GetComponent<Image>(); image.sprite = white; image.type = Image.Type.Sliced;
            image.color = color; image.raycastTarget = false; return image;
        }
        private TMP_Text Text(string name, string value, Rect rect, float size, Color color, bool display = false, Transform parent = null)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(TextMeshProUGUI)); go.transform.SetParent(parent == null ? canvas.transform : parent, false);
            Place(go.GetComponent<RectTransform>(), rect, parent);
            var text = go.GetComponent<TextMeshProUGUI>(); text.font = display ? art.Display : art.Body;
            text.text = value; text.fontSize = size * TextScale; text.color = color; text.alignment = TextAlignmentOptions.Center;
            text.raycastTarget = false; text.enableWordWrapping = true; text.enableAutoSizing = false; text.overflowMode = TextOverflowModes.Overflow;
            return text;
        }
        private Button MakeButton(string name, Rect rect, string label, Action action, Color color, out TMP_Text text, Transform parent = null)
        {
            var image = Panel(name, rect, color, parent); image.raycastTarget = true;
            var button = image.gameObject.AddComponent<Button>(); button.targetGraphic = image;
            button.onClick.AddListener(() => action());
            text = Text(name + " label", label, rect, 13 * Layout.Density, pale, false, image.transform);
            return button;
        }
        private static void Place(RectTransform target, Rect screen, Transform parent)
        {
            Vector2 origin = Vector2.zero;
            if (parent != null && parent is RectTransform rect)
            {
                var corners = new Vector3[4]; rect.GetWorldCorners(corners); origin = corners[0];
            }
            target.anchorMin = target.anchorMax = Vector2.zero; target.pivot = Vector2.zero;
            target.anchoredPosition = screen.position - origin; target.sizeDelta = screen.size;
        }
        private void OnDestroy()
        {
            if (white != null) Destroy(white);
            if (whiteTexture != null) Destroy(whiteTexture);
            if (shadeSprite != null) Destroy(shadeSprite);
            if (shadeTexture != null) Destroy(shadeTexture);
            if (stoneMaterial != null) Destroy(stoneMaterial);
        }
    }
}
