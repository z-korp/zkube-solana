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
        private SpriteRenderer guardian, paws, pawsShadow;
        private Image statusPlate, ruleShade, headingShade;
        private TMP_Text score, targetText, objective, moves, secondary, status, heading, scoreLabel, objectiveLabel, secondaryLabel;
        private TMP_Text guardianRuleHeading, guardianRule;
        private readonly Image[] stars = new Image[3], starHalos = new Image[3], starRings = new Image[3];
        private readonly Button[] starButtons = new Button[3];
        private SkinTablet guardianTablet, rerollTablet;
        private GameObject modal;
        private Image modalShield;
        private SpriteRenderer ghost;
        private Texture2D topLightTexture;
        private Sprite topLight;
        // Block sprites are reused: a board change returns them here instead of destroying them.
        private readonly Stack<SpriteRenderer> spareBlocks = new Stack<SpriteRenderer>();
        public int BlockSpritesCreated { get; private set; }
        public BoardFx Effects { get; private set; }
        private uint scoreShown, scoreTarget;
        private bool countingScore, guardianFinal;
        private string guardianFace = "idle";
        private float guardianCheerUntil, nextBlink, blinkUntil;
        private readonly HashSet<RectTransform> popping = new HashSet<RectTransform>();
        private const float GuardianCheer = .9f, BlinkSeconds = .12f;
        // A wait for the network shows only after this delay, so immediate local
        // play never shows it.
        public const float AwaitDelay = .45f;
        private float awaitingSince = -1;
        private SpriteRenderer shimmer;
        public bool AwaitingShown => shimmer != null && shimmer.gameObject.activeSelf;
        public BoardLayout Layout { get; private set; }
        public bool HasRuntimeGraph => art != null && canvas != null && boardCamera != null && guardian != null &&
            score != null && objective != null && status != null && Pointer != null &&
            Layout.Cell > 0 && Layout.Density > 0 && Layout.Board.width > 0 && Layout.Board.height > 0;
        public byte[] DisplayGrid { get; private set; } = new byte[80];
        public bool GuardianEnabled => guardianTablet != null && guardianTablet.Button.interactable;
        public bool RerollEnabled => rerollTablet != null && rerollTablet.Button.interactable;
        public string GuardianFace => guardianFace;
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
            Effects = gameObject.AddComponent<BoardFx>(); Effects.Initialize(art, boardRoot, 10);

            // Back to front: the painting, the guardian behind the rim, the board's
            // backlight, the glass well, the frame in the realm's key light, the
            // dimple cells, the rim's lit top surface and the tray. Blocks, then the
            // guardian's paws and their contact shadow, rest on top.
            var background = NewSprite("Realm background", art.SkinRealm(SkinSlots.HudBackground), -20);
            Size(background, new Rect(0, 0, Screen.width, Screen.height), true);
            float d = Layout.Density, cell = Layout.Cell;
            var key = art.Token(SkinTokens.LightKey);
            guardian = NewSprite("Calm realm guardian", art.Sprite("boss__idle"), -16);
            Size(guardian, hud.Guardian);
            var backlight = NewSprite("Board backlight", art.SkinUi(SkinSlots.FxGlow), -15);
            Size(backlight, new Rect(Layout.Rim.x - 12 * d, Layout.Rim.y - 24 * d, Layout.Rim.width + 24 * d, Layout.Rim.height + 48 * d));
            backlight.color = new Color(key.r, key.g, key.b, .5f);
            Sliced("Grid well", art.SkinUi(SkinSlots.GridWell), Layout.Rim, -14);
            Sliced("Board frame", art.SkinUi(SkinSlots.BoardFrame), Layout.Rim, -13).color = key;
            // Each cell is a soft dimple of light in the glass: the art is its shape
            // at full strength, drawn here at the 3% lift the spec gives, so device
            // texture compression keeps its edge.
            var cellSprite = art.SkinUi(SkinSlots.GridCell);
            for (int row = 0; row < 10; row++) for (int col = 0; col < 8; col++)
            {
                var dimple = NewSprite("Cell " + row + ":" + col, cellSprite, -12);
                Size(dimple, new Rect(Layout.Board.x + col * cell, Layout.Board.y + row * cell, cell, cell));
                dimple.color = new Color(1, 1, 1, CellLift);
            }
            var top = NewSprite("Board top light", TopLight(key), -11);
            Size(top, new Rect(Layout.Rim.x + 12 * d, Layout.Rim.yMax - BoardLayout.RimDp * d, Layout.Rim.width - 24 * d, BoardLayout.RimDp * d));
            Sliced("Next row tray", art.SkinUi(SkinSlots.PreviewTray), Layout.Tray, -10);
            var pawsSprite = art.Sprite("boss__paws");
            pawsShadow = NewSprite("Guardian contact shadow", pawsSprite, 7);
            Size(pawsShadow, new Rect(hud.Guardian.x + .7f * d, hud.Guardian.y - 1.3f * d, hud.Guardian.width, hud.Guardian.height));
            pawsShadow.color = new Color(0, 0, 0, .45f);
            paws = NewSprite("Guardian paws", pawsSprite, 8);
            Size(paws, hud.Guardian);

            canvas = new GameObject("Board interface", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster)).GetComponent<Canvas>();
            canvas.transform.SetParent(transform, false); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            BuildHud();
            nextBlink = Time.unscaledTime + 2.5f;
        }
        // The rim's 4 dp top surface: the key light fading to deep moonstone.
        private Sprite TopLight(Color key)
        {
            topLightTexture = new Texture2D(1, 12, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var deep = new Color(45 / 255f, 81 / 255f, 97 / 255f);
            for (int y = 0; y < 12; y++) topLightTexture.SetPixel(0, y, Color.Lerp(deep, key, y / 11f));
            topLightTexture.Apply();
            return topLight = Sprite.Create(topLightTexture, new Rect(0, 0, 1, 12), Vector2.one / 2, 100);
        }

        private TMP_Text Text(string name, string value, Rect rect, float size, string token, Transform root, SkinUi.Type type,
            TextAlignmentOptions alignment = TextAlignmentOptions.TopLeft)
        {
            var label = ui.Label(name, value, rect, size, token, root, type, alignment);
            if (type == SkinUi.Type.Caption || type == SkinUi.Type.Label)
                label.lineSpacing = SkinUi.LineSpacing(label.font, HudLayout.CaptionLeading);
            // A number reads as one line whatever its length.
            if (type == SkinUi.Type.Number) label.enableWordWrapping = false;
            return label;
        }

        private void BuildHud()
        {
            var root = canvas.transform;
            float d = Layout.Density;
            var hit = ui.Rect<Image>("Board gesture surface", Layout.Board, root);
            hit.color = Color.clear; hit.raycastTarget = true;
            Pointer = hit.gameObject.AddComponent<BoardPointer>(); Pointer.Owner = owner;

            var shade = ui.Rect<Image>("Title shade", hud.TitleShade, root);
            shade.sprite = art.SkinUi(SkinSlots.FxGlow); shade.color = new Color(2 / 255f, 7 / 255f, 14 / 255f, .62f); shade.raycastTarget = false;
            heading = Text("Run title", HudLayout.TitleText(art, owner.Session), hud.Title, hud.TitlePt, SkinTokens.Text, root, SkinUi.Type.Title,
                TextAlignmentOptions.Top);
            ui.Piece("Title ribbon", SkinSlots.TitleRibbon, hud.Ribbon, root);

            ui.Piece("Score plate", SkinSlots.Plate, hud.ScorePlate, root);
            ui.Piece("Moves plate", SkinSlots.Plate, hud.MovesPlate, root);
            ui.Piece("Primary plate", SkinSlots.Plate, hud.PrimaryPlate, root);
            ui.Piece("Secondary plate", SkinSlots.Plate, hud.SecondaryPlate, root);
            scoreLabel = Text("Score label", "SCORE", hud.ScoreCaption, hud.LabelPt, SkinTokens.TextMuted, root, SkinUi.Type.Label);
            score = Text("Score", "0", hud.ScoreValue, hud.NumberPt, SkinTokens.Score, root, SkinUi.Type.Number);
            if (hud.Campaign)
                targetText = Text("Score target", "", hud.ScoreTarget, hud.TargetPt, SkinTokens.TextMuted, root, SkinUi.Type.Caption);
            Text("Moves label", "MOVES", hud.MovesCaption, hud.LabelPt, SkinTokens.TextMuted, root, SkinUi.Type.Label);
            moves = Text("Moves remaining", "", hud.MovesValue, hud.NumberPt, SkinTokens.Score, root, SkinUi.Type.Number);
            objectiveLabel = Text("Theme label", "", hud.PrimaryCaption, hud.CaptionPt, SkinTokens.Text, root, SkinUi.Type.Caption);
            objective = Text("Theme", "0", hud.PrimaryValue, hud.GoalPt, SkinTokens.Objective, root, SkinUi.Type.Number);
            secondaryLabel = Text(hud.Campaign ? "Secondary label" : "Pressure label", "", hud.SecondaryCaption, hud.CaptionPt,
                hud.Campaign ? SkinTokens.Text : SkinTokens.TextMuted, root, SkinUi.Type.Caption);
            secondary = Text(hud.Campaign ? "Secondary" : "Pressure", "", hud.SecondaryValue, hud.Campaign ? hud.GoalPt : hud.PointsPt,
                hud.Campaign ? SkinTokens.Objective : SkinTokens.Accent, root, SkinUi.Type.Number);
            var gold = art.Token(SkinTokens.Accent);
            for (int i = 0; i < 3 && hud.Campaign; i++)
            {
                int source = i;
                var hitArea = ui.Rect<Image>("Star " + i, hud.Plate(i), root);
                hitArea.color = Color.clear; hitArea.raycastTarget = true;
                starButtons[i] = hitArea.gameObject.AddComponent<Button>(); starButtons[i].transition = Selectable.Transition.None;
                starButtons[i].onClick.AddListener(() => owner.ShowStar(source));
                var rect = hud.Star(i);
                starHalos[i] = ui.Glow("Star " + i + " light", new Rect(rect.x - rect.width * .25f, rect.y - rect.height * .25f, rect.width * 1.5f, rect.height * 1.5f),
                    SkinUi.WithAlpha(gold, .28f), hitArea.transform);
                starHalos[i].enabled = false;
                stars[i] = ui.Star("Star " + i + " glyph", rect, false, hitArea.transform);
                starRings[i] = ui.Piece("Star " + i + " ring", SkinSlots.FxRingSoft, rect, hitArea.transform);
                starRings[i].color = gold; starRings[i].enabled = false;
            }

            var next = Text("Next row label", "NEXT ROW", hud.NextLabel, hud.LabelPt * 11 / 12, SkinTokens.TextMuted, root, SkinUi.Type.Label,
                TextAlignmentOptions.Top);
            FitUnderpaint(ui.Underpaint("Next row shade", Rect.zero, root), next, true);
            next.transform.SetAsLastSibling();
            headingShade = ui.Underpaint("Guardian earning shade", Rect.zero, root);
            ruleShade = ui.Underpaint("Guardian rule shade", Rect.zero, root);
            guardianRuleHeading = Text("Guardian earning label", "", hud.RuleHeading, hud.RuleHeadingPt, SkinTokens.Accent, root, SkinUi.Type.Label);
            guardianRule = ui.Label("Guardian earning rule", "", hud.Rule, hud.RulePt, SkinTokens.Text, root, SkinUi.Type.Caption, TextAlignmentOptions.TopLeft);
            guardianTablet = ui.Tablet("Guardian action", Layout.GuardianButton, SkinSlots.IconTotem, owner.SelectGuardian, root, true);
            rerollTablet = ui.Tablet("Reroll action", Layout.RerollButton, SkinSlots.IconReroll, owner.Reroll, root, true);
            ui.Tablet("Pause", Layout.PauseButton, SkinSlots.IconPause, owner.Pause, root, false);

            statusPlate = ui.Piece("Action status plate", SkinSlots.Plate, hud.Status, root);
            status = ui.Label("Action status", "", hud.Status, hud.StatusPt, SkinTokens.Text, root);
            statusPlate.enabled = false;
            // This always-rendered transparent surface already has a canvas
            // depth when a dialog opens. It catches the opening frame while new
            // dialog graphics are waiting for their first rendered layout.
            modalShield = ui.Rect<Image>("Modal input shield", new Rect(0, 0, Screen.width, Screen.height), root);
            modalShield.color = Color.clear; modalShield.raycastTarget = false;
        }
        // Sizes a text's underpaint to the words it actually holds.
        private void FitUnderpaint(Image patch, TMP_Text text, bool centred)
        {
            var rect = SkinUi.ScreenRect(text.rectTransform);
            var size = text.GetPreferredValues(text.text, rect.width, float.PositiveInfinity);
            float width = Mathf.Min(rect.width, size.x), height = Mathf.Min(rect.height, size.y);
            float x = centred ? rect.center.x - width / 2 : rect.x;
            SkinUi.Place(patch.rectTransform, new Rect(x, rect.yMax - height, width, height), patch.transform.parent);
            float pad = 12 * Layout.Density;
            patch.rectTransform.anchoredPosition -= new Vector2(pad, pad * .75f);
            patch.rectTransform.sizeDelta += new Vector2(2 * pad, 1.5f * pad);
            patch.enabled = !string.IsNullOrEmpty(text.text) && text.gameObject.activeSelf;
        }

        public void Summary(RunSummary state, BoardSession session, bool available)
        {
            heading.text = HudLayout.TitleText(art, session);
            if (targetText != null) targetText.text = HudLayout.ScoreTargetText(session);
            ShowScore(session.Daily ? state.DailyScore : state.Score);
            moves.text = HudLayout.MovesText(state, session);
            moves.color = art.Token(HudLayout.MovesLow(state, session) ? SkinTokens.Negative : SkinTokens.Score);
            objectiveLabel.text = HudLayout.PrimaryCaptionText(session);
            objective.text = HudLayout.PrimaryText(state, session);
            secondaryLabel.text = HudLayout.SecondaryCaptionText(session);
            secondary.text = HudLayout.SecondaryText(state, session);
            if (!session.Daily)
            {
                objective.color = art.Token((state.LatchedStarSources & 2) != 0 ? SkinTokens.Positive : SkinTokens.Objective);
                secondary.color = art.Token((state.LatchedStarSources & 4) != 0 ? SkinTokens.Positive : SkinTokens.Objective);
            }
            for (int i = 0; i < 3 && starButtons[i] != null; i++)
            {
                bool earned = (state.LatchedStarSources & (1 << i)) != 0;
                stars[i].sprite = ui.StarSprite(earned, stars[i].rectTransform.rect.height);
                starHalos[i].enabled = earned;
            }
            guardianTablet.Icon.sprite = art.SkinUi(state.BonusType == 1 ? SkinSlots.IconHammer : state.BonusType == 3 ? SkinSlots.IconWave : SkinSlots.IconTotem);
            var rule = art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
            guardianRuleHeading.gameObject.SetActive(rule != null); guardianRule.gameObject.SetActive(rule != null);
            guardianRuleHeading.text = HudLayout.GuardianCaption(state.BonusType);
            guardianRule.text = rule?.description ?? "";
            FitUnderpaint(headingShade, guardianRuleHeading, false); FitUnderpaint(ruleShade, guardianRule, false);
            guardianTablet.Show(state.BonusCharges, available);
            rerollTablet.Show(state.RerollCharges, available);
            NeedsTextReflow = new[] { heading, moves, score, scoreLabel, objective, objectiveLabel, secondary, secondaryLabel, guardianRuleHeading, guardianRule }
                .Any(label => label != null && label.gameObject.activeInHierarchy && label.GetPreferredValues(label.text, label.rectTransform.rect.width, float.PositiveInfinity).y > label.rectTransform.rect.height + .5f);
        }
        public void Status(string text)
        {
            status.text = text;
            if (statusPlate != null) statusPlate.enabled = !string.IsNullOrEmpty(text);
        }
        public void ShowGains(uint scoreGain, ulong themeGain, byte combo, bool reducedMotion)
        {
            if (scoreGain == 0 && themeGain == 0) return;
            if (scoreGain > 0 && !reducedMotion) StartCoroutine(CountScore(scoreShown + scoreGain));
            float d = Layout.Density;
            float y = Layout.Board.yMax - Layout.Cell;
            float width = Layout.Board.width - 8 * d, lane = (width - 4 * d) / 2;
            var scoreChip = scoreGain > 0 ? CueText("Accepted score chip", "+" + scoreGain, SkinTokens.Score, 26) : null;
            // The objective's gain names the day's goal in the goal card's own words.
            var themeChip = themeGain > 0 ? CueText("Accepted theme chip", "+" + themeGain + " " + HudLayout.PrimaryCaptionText(owner.Session), SkinTokens.Objective, 16) : null;
            // A chip whose words fit its lane wraps inside it; one with a word too
            // long for the lane (a huge amount) gets a measured full-width row,
            // preserving the requested font size instead of spilling into another cue.
            bool stacked = new[] { scoreChip, themeChip }.Any(t => t != null && t.text.Split(' ').Any(word =>
                t.GetPreferredValues(word, float.PositiveInfinity, float.PositiveInfinity).x + 4 * d > lane));
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
            // Side margins keep glyphs whose ink overhangs their advance inside the cue.
            label.margin = new Vector4(2 * Layout.Density, 0, 2 * Layout.Density, 0);
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
                EarnedChip("Accepted reroll chip", "+1 REROLL", rect, rerollTablet.Count, SkinTokens.Accent, 16, reducedMotion);
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
        public static string ObjectiveName(byte kind, byte value, byte count = 0) => PageCatalog.Load().ObjectiveName(kind, value, count);

        public void SetBoard(byte[] grid)
        {
            foreach (var block in blocks.Values) ReturnBlock(block);
            blocks.Clear(); DisplayGrid = (byte[])grid.Clone();
            for (int row = 0; row < 10; row++) for (int col = 0; col < 8;)
            {
                byte width = grid[row * 8 + col];
                if (width == 0) { col++; continue; }
                var sprite = TakeBlock("Block " + row + ":" + col, width);
                PositionBlock(sprite, row, col, width); blocks.Add(row * 8 + col, sprite); col += width;
            }
        }
        public void SetPreview(byte presence, byte[] row)
        {
            foreach (var block in preview) ReturnBlock(block); preview.Clear();
            if (presence == 0) return;
            for (int col = 0; col < 8;)
            {
                byte width = row[col]; if (width == 0) { col++; continue; }
                var sprite = TakeBlock("Next block " + col, width);
                Size(sprite, Layout.BlockRect(Layout.Preview.x + col * Layout.Cell, Layout.Preview.y, width));
                sprite.color = new Color(1, 1, 1, PreviewAlpha); preview.Add(sprite); col += width;
            }
        }
        // How much lighter an empty cell's centre is than the glass around it.
        public const float CellLift = .03f;
        // The next row waits in the tray at 60% until it rises.
        public const float PreviewAlpha = .6f;
        private Sprite BlockSprite(byte width) => art.SkinRealm(SkinSlots.Block(width));
        private SpriteRenderer TakeBlock(string name, byte width)
        {
            SpriteRenderer sprite;
            if (spareBlocks.Count > 0) { sprite = spareBlocks.Pop(); sprite.gameObject.SetActive(true); }
            else { sprite = NewSprite(name, null, 2); BlockSpritesCreated++; }
            sprite.name = name; sprite.sprite = BlockSprite(width); sprite.color = Color.white;
            return sprite;
        }
        private void ReturnBlock(SpriteRenderer sprite)
        {
            sprite.gameObject.SetActive(false); spareBlocks.Push(sprite);
        }

        // Plays one accepted transition. Every step ends with the sprites exactly
        // where the native board puts them; the motion in between is presentation.
        public IEnumerator Trace(PresentationEvent[] events, bool reducedMotion, Action<string> sound)
        {
            int clears = 0;
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
                    if (reason == 0) yield return Slide(targets, starts, reducedMotion ? 0 : .1f);
                    else yield return Fall(targets, starts, reducedMotion);
                    continue;
                }
                if (item.Kind == PresentationKind.RowsCleared || item.Kind == PresentationKind.BonusApplied)
                {
                    byte[] after = PresentationTrace.ProjectBoard(DisplayGrid, new[] { item });
                    var removed = blocks.Where(pair => after[pair.Key] == 0).ToArray();
                    if (item.Kind == PresentationKind.RowsCleared)
                    {
                        sound("break"); clears++;
                        yield return Clear(removed, clears, (uint)NativeWire.Read(item.Payload, 0, 2), reducedMotion);
                    }
                    else
                    {
                        sound("bonus-activate");
                        yield return Dissolve(removed, reducedMotion);
                    }
                    SetBoard(after);
                }
                else if (item.Kind == PresentationKind.PreviewChanged)
                {
                    SetPreview(item.Payload[0], item.Payload.Skip(1).ToArray());
                }
                else if (item.Kind == PresentationKind.RowInserted)
                {
                    yield return Insert(item.Payload, reducedMotion);
                    SetBoard(PresentationTrace.ProjectBoard(DisplayGrid, new[] { item }));
                }
                else if (item.Kind == PresentationKind.BoardReplaced)
                    SetBoard(PresentationTrace.ProjectBoard(DisplayGrid, new[] { item }));
                else if (item.Kind == PresentationKind.PerfectClear)
                {
                    PerfectClear(item.Payload[0] == 1, reducedMotion);
                    // The perfect clear bursts over the whole board.
                    if (!reducedMotion) Effects.Burst(Layout.Board.center, Layout.Cell, art.Token(SkinTokens.Accent), 8 * PerfectClearScale / 2);
                }
                else if (item.Kind != PresentationKind.Terminal)
                    throw new InvalidOperationException("Unsupported presentation event " + item.Kind);
            }
        }
        private static IEnumerator Slide(Dictionary<SpriteRenderer, Vector3> targets, Dictionary<SpriteRenderer, Vector3> starts, float duration)
        {
            for (float elapsed = 0; elapsed < duration; elapsed += Time.unscaledDeltaTime)
            {
                float t = Mathf.SmoothStep(0, 1, elapsed / duration);
                foreach (var pair in targets) pair.Key.transform.position = Vector3.Lerp(starts[pair.Key], pair.Value, t);
                yield return null;
            }
            foreach (var pair in targets) pair.Key.transform.position = pair.Value;
        }
        // Blocks fall under one shared acceleration, so a longer drop lands later,
        // then squash on landing and spring back. Reduced motion drops them in a blink.
        private IEnumerator Fall(Dictionary<SpriteRenderer, Vector3> targets, Dictionary<SpriteRenderer, Vector3> starts, bool reducedMotion)
        {
            float rows = targets.Max(pair => starts[pair.Key].y - pair.Value.y) / Layout.Cell;
            float fall = reducedMotion ? .06f : Mathf.Clamp(.11f * Mathf.Sqrt(rows), .08f, .28f), settle = reducedMotion ? 0 : .14f;
            var scales = targets.Keys.ToDictionary(sprite => sprite, sprite => sprite.transform.localScale);
            for (float elapsed = 0; elapsed < fall + settle; elapsed += Time.unscaledDeltaTime)
            {
                foreach (var pair in targets)
                {
                    var sprite = pair.Key; var start = starts[sprite]; var target = pair.Value; var scale = scales[sprite];
                    float own = (start.y - target.y) / Layout.Cell, land = fall * Mathf.Sqrt(Mathf.Max(own, 0) / Mathf.Max(rows, 1e-3f));
                    if (elapsed < land)
                    {
                        float t = elapsed / land;
                        sprite.transform.position = Vector3.Lerp(start, target, reducedMotion ? t : t * t);
                        continue;
                    }
                    float b = (elapsed - land) / settle, squash = reducedMotion || b >= 1 ? 0 : .14f * Mathf.Sin(2 * Mathf.PI * b) * (1 - b);
                    sprite.transform.localScale = new Vector3(scale.x * (1 + .6f * squash), scale.y * (1 - squash), 1);
                    // The squash keeps the block's bottom edge on its landing cell.
                    sprite.transform.position = target + Vector3.down * (.94f * Layout.Cell * squash / 2);
                }
                yield return null;
            }
            foreach (var pair in targets) { pair.Key.transform.position = pair.Value; pair.Key.transform.localScale = scales[pair.Key]; }
        }
        // A completed line sweeps with the key light, then each of its blocks
        // shatters: a 60 ms white flash on its own shape, then chunks in its width
        // colour. Each later clear in one action throws more, further, with a
        // burst over it, below the perfect clear's. Reduced motion only fades the
        // blocks, over 120 ms.
        public const float PerfectClearScale = 2.6f;
        public static float ComboStrength(int clears) => Mathf.Min(1 + .3f * (clears - 1), PerfectClearScale - .6f);
        private IEnumerator Clear(KeyValuePair<int, SpriteRenderer>[] removed, int clears, uint rows, bool reducedMotion)
        {
            if (removed.Length == 0) yield break;
            if (reducedMotion)
            {
                for (float t = 0; t < .12f; t += Time.unscaledDeltaTime)
                {
                    foreach (var pair in removed) pair.Value.color = new Color(1, 1, 1, 1 - t / .12f);
                    yield return null;
                }
                yield break;
            }
            for (int row = 0; row < 10; row++)
                if ((rows & (1U << row)) != 0)
                    Effects.LineSweep(new Vector2(Layout.Board.center.x, Layout.Board.y + (row + .5f) * Layout.Cell), Layout.Cell, 8, Color.white);
            float strength = ComboStrength(clears);
            int allowed = Effects.ChunksPerBlock(removed.Length);
            foreach (var pair in removed)
            {
                byte width = DisplayGrid[pair.Key];
                Effects.Break(pair.Value, width, Layout.Cell, art.Token(SkinTokens.BlockTint(width)),
                    Mathf.Min(allowed, BoardFx.ChunksFor(width, strength)), strength, pair.Key);
            }
            if (clears >= 2)
            {
                var center = removed.Aggregate(Vector3.zero, (sum, pair) => sum + pair.Value.transform.position) / removed.Length;
                Effects.Burst(center, Layout.Cell, art.Token(SkinTokens.LightGlow), 3.4f * strength);
            }
            // The flash covers the block; it is gone when the flash ends.
            for (float t = 0; t < BoardFx.FlashSeconds; t += Time.unscaledDeltaTime) yield return null;
            foreach (var pair in removed) pair.Value.color = Color.clear;
        }
        // A power's removal scores nothing, so it looks nothing like a line
        // clear: no flash, no shards and no burst. Each block lets go of its
        // light as a soft puff and dissolves, shrinking slowly, over 340 ms.
        // Reduced motion only fades the blocks, over 160 ms.
        public const float DissolveSeconds = .34f;
        private IEnumerator Dissolve(KeyValuePair<int, SpriteRenderer>[] removed, bool reducedMotion)
        {
            if (removed.Length == 0) yield break;
            var glow = art.Token(SkinTokens.LightGlow);
            if (!reducedMotion)
                foreach (var pair in removed)
                    Effects.Release(pair.Value.transform.position, DisplayGrid[pair.Key], Layout.Cell, glow, pair.Key);
            var scales = removed.ToDictionary(pair => pair.Value, pair => pair.Value.transform.localScale);
            float duration = reducedMotion ? .16f : DissolveSeconds;
            for (float t = 0; t < duration; t += Time.unscaledDeltaTime)
            {
                float k = t / duration, ease = k * k;
                foreach (var pair in removed)
                {
                    if (!reducedMotion) pair.Value.transform.localScale = scales[pair.Value] * (1 - .16f * ease);
                    var tint = Color.Lerp(Color.white, glow, reducedMotion ? 0 : .5f * k); tint.a = 1 - ease;
                    pair.Value.color = tint;
                }
                yield return null;
            }
            foreach (var pair in removed) pair.Value.transform.localScale = scales[pair.Value];
        }
        // The next row lifts out of the tray while the board rises one row, both
        // overshooting slightly and settling. Reduced motion moves them at once.
        private IEnumerator Insert(byte[] row, bool reducedMotion)
        {
            foreach (var block in preview) ReturnBlock(block); preview.Clear();
            var rising = blocks.Values.ToDictionary(sprite => sprite, sprite => sprite.transform.position);
            var incoming = new List<(SpriteRenderer sprite, Vector3 from, Vector3 to)>();
            for (int col = 0; col < 8;)
            {
                byte width = row[col]; if (width == 0) { col++; continue; }
                var sprite = TakeBlock("Incoming block " + col, width);
                PositionBlock(sprite, 0, col, width);
                var to = sprite.transform.position;
                var from = new Vector3(to.x, Layout.Preview.center.y, to.z);
                incoming.Add((sprite, from, to)); sprite.transform.position = from;
                col += width;
            }
            float duration = reducedMotion ? 0 : .26f;
            for (float elapsed = 0; elapsed < duration; elapsed += Time.unscaledDeltaTime)
            {
                float k = BackOut(elapsed / duration);
                foreach (var pair in rising) pair.Key.transform.position = pair.Value + Vector3.up * Layout.Cell * k;
                foreach (var (sprite, from, to) in incoming) sprite.transform.position = Vector3.LerpUnclamped(from, to, k);
                yield return null;
            }
            foreach (var (sprite, _, _) in incoming) ReturnBlock(sprite);
        }
        // Ease out with a small overshoot: about 6% past the end before settling.
        private static float BackOut(float t)
        {
            const float c = 1.2f;
            t -= 1;
            return 1 + (c + 1) * t * t * t + c * t * t;
        }

        // The ghost follows the pointer inside the empty run [minStart, maxStart].
        public void Ghost(int row, int start, int width, float screenX, int minStart, int maxStart)
        {
            if (ghost == null) ghost = NewSprite("Unaccepted drag preview", null, 6);
            ghost.sprite = BlockSprite((byte)width); ghost.gameObject.SetActive(true);
            PositionBlock(ghost, row, start, width);
            var position = ghost.transform.position;
            position.x = Mathf.Clamp(screenX, Layout.CellCenter(row, minStart, width).x, Layout.CellCenter(row, maxStart, width).x);
            ghost.transform.position = position; ghost.color = new Color(1, 1, 1, .55f);
        }
        public void ClearGhost() { if (ghost != null) ghost.gameObject.SetActive(false); }

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
            var buttonHeights = actions.Select(action => Mathf.Max(52 * d, ui.TextHeight(action.label, inner - 20 * d, SkinUi.ButtonDp, SkinUi.Type.Number) + 24 * d)).ToArray();
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
        public void Terminal(bool completed)
        {
            guardianFinal = true; Face(completed ? "celebrate" : "defeated");
            if (owner.ReducedMotion) return;
            var glow = art.Token(SkinTokens.LightGlow);
            if (completed) GuardianPulse(SkinSlots.FxHalo, glow, .9f, .28f);
            else
            {
                float grey = glow.grayscale;
                GuardianPulse(SkinSlots.FxDimRipple, Color.Lerp(glow, new Color(grey, grey, grey), .6f), .7f, .22f);
            }
        }

        // The score readout: accepted points count up once their chip reaches it.
        private void ShowScore(uint value)
        {
            scoreTarget = value;
            if (!countingScore) { scoreShown = value; score.text = value.ToString(); PlaceTarget(); }
        }
        // The target follows the score's digits, 8 dp after them.
        private void PlaceTarget()
        {
            if (targetText == null) return;
            var value = SkinUi.ScreenRect(score.rectTransform);
            float x = value.x + score.GetPreferredValues(score.text).x + 8 * Layout.Density;
            var rect = SkinUi.ScreenRect(targetText.rectTransform);
            SkinUi.Place(targetText.rectTransform, new Rect(x, rect.y, Mathf.Max(1, hud.ScorePlate.xMax - 4 * Layout.Density - x), rect.height),
                targetText.transform.parent);
        }
        private IEnumerator CountScore(uint target)
        {
            countingScore = true; scoreTarget = target;
            yield return new WaitForSecondsRealtime(.35f);
            uint from = scoreShown;
            for (float t = 0; t < .45f && scoreTarget >= from; t += Time.unscaledDeltaTime)
            {
                scoreShown = from + (uint)Mathf.RoundToInt((scoreTarget - from) * (1 - Mathf.Pow(1 - t / .45f, 3)));
                score.text = scoreShown.ToString(); PlaceTarget();
                yield return null;
            }
            countingScore = false; ShowScore(scoreTarget);
            Pop(score.rectTransform, 1.18f, .2f);
        }

        // After an accepted action: each newly earned star ignites, a trail of
        // light flying to it from the counter that earned it, and the guardian
        // celebrates a combo, a perfect clear or a star. Reduced motion switches
        // the star on and keeps the guardian's face, without movement.
        public void Celebrate(byte previousStars, byte earnedStars, byte combo, bool perfectClear)
        {
            bool earned = false;
            for (int i = 0; i < 3; i++)
            {
                if (starButtons[i] == null || (earnedStars & (1 << i)) == 0 || (previousStars & (1 << i)) != 0) continue;
                earned = true;
                if (!owner.ReducedMotion) StartCoroutine(Ignite(i));
            }
            if (!earned && combo < 2 && !perfectClear || guardianFinal) return;
            Face("celebrate");
            guardianCheerUntil = Time.unscaledTime + GuardianCheer;
            if (!owner.ReducedMotion) GuardianPulse(SkinSlots.FxHalo, art.Token(SkinTokens.LightGlow), .9f, .28f);
        }
        // The trail takes 300 ms; the star then scales 0.6, 1.15, 1 over 400 ms
        // with a ring and six sparks.
        private IEnumerator Ignite(int index)
        {
            var star = stars[index].rectTransform;
            var source = (index == 0 ? score : index == 1 ? objective : secondary).rectTransform;
            var to = SkinUi.ScreenRect(star).center;
            var from = SkinUi.ScreenRect(source).center;
            float d = Layout.Density, size = 18 * d;
            var gold = art.Token(SkinTokens.Accent);
            var trail = ui.Rect<Image>("Star " + index + " trail", new Rect(from.x - size / 2, from.y - size / 2, size, size), canvas.transform);
            trail.sprite = art.SkinUi(SkinSlots.FxTrail); trail.raycastTarget = false; trail.color = SkinUi.WithAlpha(gold, .65f);
            var origin = star.anchoredPosition;
            star.localScale = Vector3.one * .6f; star.anchoredPosition = origin + star.rect.size * .2f;
            for (float t = 0; t < .3f; t += Time.unscaledDeltaTime)
            {
                float k = Mathf.SmoothStep(0, 1, t / .3f);
                var at = Vector2.Lerp(from, to, k) + Vector2.up * Mathf.Sin(Mathf.PI * k) * 12 * d;
                SkinUi.Place(trail.rectTransform, new Rect(at.x - size / 2, at.y - size / 2, size, size), canvas.transform);
                yield return null;
            }
            Destroy(trail.gameObject);
            // The flare blooms behind the star as it ignites.
            float flare = 48 * d;
            var bloom = ui.Rect<Image>("Star " + index + " flare", new Rect(to.x - flare / 2, to.y - flare / 2, flare, flare), star.parent);
            bloom.sprite = art.SkinUi(SkinSlots.FxStarFlare); bloom.raycastTarget = false; bloom.transform.SetSiblingIndex(star.GetSiblingIndex());
            var sparks = new Image[6];
            string[] kinds = { SkinSlots.FxSpark1, SkinSlots.FxSpark2, SkinSlots.FxSpark3 };
            for (int i = 0; i < 6; i++)
            {
                sparks[i] = ui.Rect<Image>("Star " + index + " spark", new Rect(to.x - 4 * d, to.y - 4 * d, 8 * d, 8 * d), canvas.transform);
                sparks[i].sprite = art.SkinUi(kinds[i % 3]); sparks[i].raycastTarget = false; sparks[i].color = gold;
            }
            StartCoroutine(Ring(starRings[index]));
            for (float t = 0; t < .4f && star != null; t += Time.unscaledDeltaTime)
            {
                float k = t / .4f, scale = k < .5f ? Mathf.Lerp(.6f, 1.15f, k / .5f) : Mathf.Lerp(1.15f, 1, (k - .5f) / .5f);
                star.localScale = new Vector3(scale, scale, 1);
                star.anchoredPosition = origin - star.rect.size * (scale - 1) / 2;
                for (int i = 0; i < 6; i++)
                {
                    float angle = (i + .5f) * Mathf.PI / 3, reach = 26 * d * Mathf.Sqrt(k);
                    var at = to + new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * reach;
                    SkinUi.Place(sparks[i].rectTransform, new Rect(at.x - 4 * d, at.y - 4 * d, 8 * d, 8 * d), canvas.transform);
                    var c = gold; c.a = 1 - k; sparks[i].color = c;
                }
                bloom.color = SkinUi.WithAlpha(gold, .8f * Mathf.Sin(Mathf.PI * k));
                yield return null;
            }
            foreach (var spark in sparks) Destroy(spark.gameObject);
            Destroy(bloom.gameObject);
            if (star != null) { star.localScale = Vector3.one; star.anchoredPosition = origin; }
        }
        private static IEnumerator Ring(Image ring)
        {
            ring.enabled = true;
            var origin = ring.rectTransform.anchoredPosition;
            for (float t = 0; t < .4f; t += Time.unscaledDeltaTime)
            {
                float k = t / .4f, size = Mathf.Lerp(.6f, 1.8f, k);
                ring.rectTransform.localScale = new Vector3(size, size, 1);
                ring.rectTransform.anchoredPosition = origin - ring.rectTransform.rect.size * (size - 1) / 2;
                var color = ring.color; color.a = 1 - k; ring.color = color;
                yield return null;
            }
            ring.rectTransform.localScale = Vector3.one; ring.rectTransform.anchoredPosition = origin; ring.enabled = false;
        }
        // Scales a HUD piece up and back about its centre, once at a time.
        private void Pop(RectTransform target, float peak, float duration)
        {
            if (owner.ReducedMotion || !popping.Add(target)) return;
            StartCoroutine(PopOnce(target, peak, duration));
        }
        private IEnumerator PopOnce(RectTransform target, float peak, float duration)
        {
            var origin = target.anchoredPosition;
            for (float t = 0; t < duration && target != null; t += Time.unscaledDeltaTime)
            {
                float size = 1 + (peak - 1) * Mathf.Sin(Mathf.PI * t / duration);
                target.localScale = new Vector3(size, size, 1);
                target.anchoredPosition = origin - target.rect.size * (size - 1) / 2;
                yield return null;
            }
            if (target != null) { target.localScale = Vector3.one; target.anchoredPosition = origin; }
            popping.Remove(target);
        }

        public void Awaiting(bool waiting)
        {
            if (waiting) { if (awaitingSince < 0) awaitingSince = Time.unscaledTime; return; }
            awaitingSince = -1;
            if (shimmer != null) shimmer.gameObject.SetActive(false);
        }
        // Light sweeps across the next-row tray while a slow result is on its way;
        // reduced motion holds a still, dim glow instead. No words.
        private void ShowAwaiting(float now)
        {
            if (awaitingSince < 0 || now - awaitingSince < AwaitDelay) return;
            if (shimmer == null) { shimmer = NewSprite("Waiting shimmer", art.SkinUi(SkinSlots.FxGlow), 3); shimmer.color = Color.clear; }
            shimmer.gameObject.SetActive(true);
            float phase = ((now - awaitingSince - AwaitDelay) / 1.4f) % 1, height = Layout.Cell * 1.4f;
            var tint = art.Token(SkinTokens.Accent);
            if (owner.ReducedMotion) { phase = .5f; tint.a = .2f; }
            else tint.a = .4f * Mathf.Sin(Mathf.PI * phase);
            float bounds = shimmer.sprite.bounds.size.x;
            shimmer.transform.position = new Vector3(Layout.Preview.x + Layout.Preview.width * phase, Layout.Preview.center.y, 0);
            shimmer.transform.localScale = new Vector3(height * 1.8f / bounds, height / bounds, 1);
            shimmer.color = tint;
        }

        // One pulse of light behind the guardian's head, 192 dp across as drawn.
        private void GuardianPulse(string slot, Color tint, float seconds, float alpha)
        {
            var head = new Vector2(hud.Guardian.center.x, hud.Guardian.y + hud.Guardian.height * .62f);
            Effects.Behind(slot, head, Layout.Cell, tint, 192 * Layout.Density / Layout.Cell * hud.Guardian.width / (168 * Layout.Density), seconds, alpha);
        }
        // The guardian rests on the rim: frames only change its face, so its
        // body and paws never move. It blinks every few seconds, cheers for a
        // moment, then returns to its calm face unless the run has ended.
        private void Face(string frame)
        {
            if (guardianFace == frame) return;
            guardianFace = frame; guardian.sprite = art.Sprite("boss__" + frame);
        }
        private void Update()
        {
            ShowAwaiting(Time.unscaledTime);
            if (guardian == null) return;
            float now = Time.unscaledTime;
            if (guardianFinal) return;
            if (guardianCheerUntil > 0 && now < guardianCheerUntil) return;
            if (guardianCheerUntil > 0) { guardianCheerUntil = 0; Face("idle"); nextBlink = now + 3.2f; }
            if (owner.ReducedMotion) { if (guardianFace == "blink") Face("idle"); return; }
            if (blinkUntil > 0 && now >= blinkUntil) { blinkUntil = 0; Face("idle"); nextBlink = now + 3.2f + 1.9f * Mathf.Repeat(now * .618f, 1); }
            else if (blinkUntil == 0 && now >= nextBlink) { Face("blink"); blinkUntil = now + BlinkSeconds; }
        }

        private SpriteRenderer NewSprite(string name, Sprite sprite, int order)
        {
            var go = new GameObject(name, typeof(SpriteRenderer)); go.transform.SetParent(boardRoot, false);
            var renderer = go.GetComponent<SpriteRenderer>(); renderer.sprite = sprite; renderer.sortingOrder = order;
            return renderer;
        }
        // Stretched board pieces keep their authored borders at the kit scale.
        private SpriteRenderer Sliced(string name, Sprite sprite, Rect rect, int order, float chrome = 1)
        {
            var renderer = NewSprite(name, sprite, order);
            float scale = sprite.pixelsPerUnit * ui.Ui * chrome;
            renderer.drawMode = SpriteDrawMode.Sliced;
            renderer.size = rect.size / scale;
            renderer.transform.localScale = new Vector3(scale, scale, 1);
            renderer.transform.position = rect.center;
            return renderer;
        }
        private void PositionBlock(SpriteRenderer renderer, int row, int col, int width)
        {
            Size(renderer, Layout.BlockRect(Layout.Board.x + col * Layout.Cell, Layout.Board.y + row * Layout.Cell, width));
        }
        private static void Size(SpriteRenderer renderer, Rect rect, bool cover = false)
        {
            var bounds = renderer.sprite.bounds.size;
            Vector2 scale = new Vector2(rect.width / bounds.x, rect.height / bounds.y);
            if (cover) scale = Vector2.one * Mathf.Max(scale.x, scale.y);
            renderer.transform.localScale = new Vector3(scale.x, scale.y, 1);
            renderer.transform.position = rect.center;
        }
        private void OnDestroy()
        {
            ui?.Dispose();
            if (topLight != null) Destroy(topLight);
            if (topLightTexture != null) Destroy(topLightTexture);
        }
    }
}
