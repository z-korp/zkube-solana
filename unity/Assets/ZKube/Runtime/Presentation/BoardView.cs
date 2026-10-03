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
        public HudLayout Hud => hud;
        // The skin kit the HUD is drawn from, for pieces drawn over the board (the guardian's lessons).
        public SkinUi Kit => ui;
        public bool NeedsTextReflow { get; private set; }
        private Canvas canvas;
        private Transform boardRoot;
        private Camera boardCamera;
        private SpriteRenderer guardian, guardianPatch, paws, pawsShadow;
        private Image statusPlate, movesFace, movesGlow;
        private TMP_Text score, objective, moves, status, earnCaption;
        private readonly Image[] stars = new Image[3], starHalos = new Image[3], starRings = new Image[3];
        private readonly GoalPlate[] plates = new GoalPlate[3];
        private SkinTablet guardianTablet, rerollTablet;
        private Image armedFace;
        private TMP_Text prompt;
        private GameObject promptCancel;
        private readonly List<GameObject> earnParts = new List<GameObject>();
        private readonly SpriteRenderer[] targetRows = new SpriteRenderer[10];
        private readonly Dictionary<SkinTablet, Image> capRings = new Dictionary<SkinTablet, Image>();
        public bool BonusChosen { get; private set; }
        public string PromptText => prompt == null ? "" : prompt.text;
        private GameObject bubble;
        private TMP_Text pressure, best, timeLeft;
        private Image pressureFill, bestCrown;
        private readonly bool[] flying = new bool[3];
        private GameObject modal;
        private Image modalShield;
        private SpriteRenderer ghost, pressureFrame, pressureTint, guardianAura;
        public bool Boss { get; private set; }
        public const float AuraAlpha = .55f, IntroSeconds = 2.2f;
        // Block sprites are reused: a board change returns them here instead of destroying them.
        private readonly Stack<SpriteRenderer> spareBlocks = new Stack<SpriteRenderer>();
        public int BlockSpritesCreated { get; private set; }
        public BoardFx Effects { get; private set; }
        public BoardLight Lighting { get; private set; }
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
            score != null && moves != null && status != null && Pointer != null &&
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
            // dimple cells and the tray. Blocks, then the guardian's paws and their
            // contact shadow, rest on top; the paws lean on the frame's own edge.
            var background = NewSprite("Realm background", art.SkinRealm(SkinSlots.Background), -20);
            Size(background, new Rect(0, 0, Screen.width, Screen.height), true);
            background.sharedMaterial = BoardLight.Lit;
            float d = Layout.Density, cell = Layout.Cell;
            var key = art.Token(SkinTokens.LightKey);
            // The guardian's own level (DECISIONS 2026-10-02: a boss level feels
            // like one): the frame and its backlight turn gold and the guardian
            // stands in a breathing aura for the whole run.
            Boss = HudLayout.BossLevel(owner.Session);
            if (Boss)
            {
                guardianAura = NewSprite("Guardian aura", art.SkinUi(SkinSlots.FxGlow), -18);
                float aura = 1.9f * hud.Guardian.width;
                Size(guardianAura, new Rect(hud.Guardian.center.x - aura / 2, hud.Guardian.y + hud.Guardian.height * .62f - aura / 2, aura, aura));
                guardianAura.color = SkinUi.WithAlpha(art.Token(SkinTokens.Accent), AuraAlpha);
            }
            // The guardian is its idle frame; a mood or a blink lays only its face over it.
            guardian = NewSprite("Calm realm guardian", art.Sprite(BoardArt.GuardianIdle), -17);
            Size(guardian, hud.Guardian);
            guardian.sharedMaterial = BoardLight.Lit;
            guardianPatch = NewSprite(SkinUi.GuardianFaceName, null, -16);
            guardianPatch.sharedMaterial = BoardLight.Lit; guardianPatch.enabled = false;
            var backlight = NewSprite("Board backlight", art.SkinUi(SkinSlots.FxGlow), -15);
            Size(backlight, new Rect(Layout.Rim.x - 12 * d, Layout.Rim.y - 24 * d, Layout.Rim.width + 24 * d, Layout.Rim.height + 48 * d));
            var rim = Boss ? art.Token(SkinTokens.Accent) : key;
            backlight.color = new Color(rim.r, rim.g, rim.b);
            Sliced("Grid well", art.SkinUi(SkinSlots.GridWell), Layout.Rim, -14);
            Sliced("Board frame", art.SkinUi(SkinSlots.BoardFrame), Layout.Rim, -13).color = rim;
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
            Sliced("Next row tray", art.SkinUi(SkinSlots.PreviewTray), Layout.Tray, -10);
            // Under pressure the frame and the glass pulse in the warning colour, over the cells and under the blocks.
            pressureTint = NewSprite("Pressure tint", art.SkinUi(SkinSlots.FxGlow), -11);
            Size(pressureTint, new Rect(Layout.Board.x - .2f * Layout.Board.width, Layout.Board.y - .2f * Layout.Board.height, 1.4f * Layout.Board.width, 1.4f * Layout.Board.height));
            pressureFrame = Sliced("Pressure frame", art.SkinUi(SkinSlots.BoardFrame), Layout.Rim, 1, 2);
            pressureTint.enabled = pressureFrame.enabled = false;
            var pawsSprite = art.Sprite("boss__paws");
            pawsShadow = NewSprite("Guardian contact shadow", pawsSprite, 7);
            Size(pawsShadow, new Rect(hud.Guardian.x + .7f * d, hud.Guardian.y - 1.3f * d, hud.Guardian.width, hud.Guardian.height));
            pawsShadow.color = new Color(0, 0, 0, .45f);
            paws = NewSprite("Guardian paws", pawsSprite, 8);
            Size(paws, hud.Guardian);
            paws.sharedMaterial = BoardLight.Lit;
            Lighting = gameObject.AddComponent<BoardLight>();
            Lighting.Initialize(art, boardCamera, background.bounds, Layout, boardRoot, backlight);

            canvas = new GameObject("Board interface", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster)).GetComponent<Canvas>();
            canvas.transform.SetParent(transform, false); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            BuildHud();
            nextBlink = Time.unscaledTime + 2.5f;
        }
        private TMP_Text Text(string name, string value, Rect rect, float size, string token, Transform root, SkinUi.Type type,
            TextAlignmentOptions alignment = TextAlignmentOptions.TopLeft)
        {
            var label = ui.Label(name, value, rect, size, token, root, type, alignment);
            if (type == SkinUi.Type.Caption || type == SkinUi.Type.Label)
                label.lineSpacing = SkinUi.LineSpacing(label.font, HudLayout.CaptionLeading);
            // A number reads as one line whatever its length.
            if (type == SkinUi.Type.Number || type == SkinUi.Type.Display) label.enableWordWrapping = false;
            return label;
        }

        // A goal plate: its pictogram and chip, and its counter as the catalog
        // names it: a count over a fill bar, a ring, or a bar for moves in a row.
        private sealed class GoalPlate
        {
            public Rect Rect;
            public string Counter, Caption;
            public Image Pictogram, Track, Fill, Tick, Ring;
            public byte Required;
            public TMP_Text Count;
        }
        private string Muted => ColorUtility.ToHtmlStringRGB(art.Token(SkinTokens.TextMuted));
        // Every plate and tablet the HUD laid out through PlateLayout, with what it drew there.
        public sealed class PlatePart
        {
            public string Name;
            public PlateLayout Layout;
            public RectTransform Icon;
            public TMP_Text Value;
        }
        public readonly List<PlatePart> PlateParts = new List<PlatePart>();
        private PlateLayout Lay(string name, PlateLayout layout, Graphic icon, TMP_Text value)
        {
            PlateParts.Add(new PlatePart { Name = name, Layout = layout, Icon = icon == null ? null : icon.rectTransform, Value = value });
            return layout;
        }

        private void BuildHud()
        {
            var root = canvas.transform;
            float d = Layout.Density;
            var hit = ui.Rect<Image>("Board gesture surface", Layout.Board, root);
            hit.color = Color.clear; hit.raycastTarget = true;
            Pointer = hit.gameObject.AddComponent<BoardPointer>(); Pointer.Owner = owner;
            var session = owner.Session;
            var catalog = PageCatalog.Load();

            if (hud.Campaign)
            {
                byte level = HudLayout.CampaignLevel(session);
                if (hud.Medal.width > 0 && level > 0)
                {
                    var medal = ui.Rect<Image>("Level medal", hud.Medal, root);
                    medal.sprite = art.SkinRealm(Boss ? SkinSlots.MapNodeGuardian : SkinSlots.MapNodeOpen); medal.preserveAspect = true; medal.raycastTarget = false;
                    Text("Level", HudLayout.LevelNumber(session.RealmId, level), hud.Medal, hud.LevelPt, SkinTokens.Text, root,
                        SkinUi.Type.Display, TextAlignmentOptions.Center);
                }
                ui.Pill("Star crown", hud.Crown, root);
                var gold = art.Token(SkinTokens.Accent);
                for (int i = 0; i < 3; i++)
                {
                    var rect = hud.Sockets[i];
                    starHalos[i] = ui.Glow("Star " + i + " light", new Rect(rect.x - rect.width * .25f, rect.y - rect.height * .25f, rect.width * 1.5f, rect.height * 1.5f),
                        SkinUi.WithAlpha(gold, .28f), root);
                    starHalos[i].enabled = false;
                    stars[i] = ui.Piece("Star " + i + " glyph", SkinSlots.StarSocket, rect, root);
                    starRings[i] = ui.Piece("Star " + i + " ring", SkinSlots.FxRingSoft, rect, root);
                    starRings[i].color = gold; starRings[i].enabled = false;
                }
                var rules = session.Rules;
                var primary = catalog.Goal(rules.PrimaryKind, rules.PrimaryValue, rules.PrimaryCount);
                var secondary = catalog.Goal(rules.SecondaryKind, rules.SecondaryValue, rules.SecondaryCount);
                plates[0] = Plate(0, SkinSlots.GoalScore, "", "fill", "Score", root);
                plates[1] = Plate(1, primary.Pictogram(rules.BonusType), primary.chip, primary.counter, primary.text, root, rules.PrimaryCount);
                plates[2] = Plate(2, secondary.Pictogram(rules.BonusType), secondary.chip, secondary.counter, secondary.text, root, rules.SecondaryCount);
                score = plates[0].Count; objective = plates[1].Count;
            }
            else
            {
                // The Daily's score sits where the Campaign's stars do.
                ui.Piece("Score plate", SkinSlots.GoalPlate, hud.Crown, root);
                var scoreLayout = PlateLayout.Row(hud.Crown, hud.K * d, HudLayout.ScoreIconDp);
                var scoreIcon = ui.Pictogram("Score", SkinSlots.GoalScore, null, scoreLayout.Icon, root);
                score = Text("Score", "0", scoreLayout.Number, hud.ScorePt, SkinTokens.Score, root, SkinUi.Type.Display, TextAlignmentOptions.Center);
                Lay("Score plate", scoreLayout, scoreIcon, score);
                var facts = session.DailyFacts;
                if (facts != null)
                {
                    // The best: a crown and the best score, on a badge centred over the plate's number.
                    var badge = hud.Best; float icon = badge.height - 4 * d;
                    ui.Pill("Best badge", badge, root);
                    bestCrown = ui.Piece("Best crown", SkinSlots.IconCrown, new Rect(badge.x + 5 * d, badge.y + 2 * d, icon, icon), root);
                    best = Text("Best", "", new Rect(badge.x + 7 * d + icon, badge.y, badge.width - 10 * d - icon, badge.height),
                        hud.ChipPt + 2, SkinTokens.Accent, root, SkinUi.Type.Display, TextAlignmentOptions.Center);
                }
                // The right column: the multiplier, the objective (a Classic day has none) and the time left.
                var rules = session.Rules; int slot = 0;
                var ring = hud.Plates[slot++];
                ui.Piece("Pressure plate", SkinSlots.GoalPlate, ring, root);
                var ringLayout = PlateLayout.ValueOnly(ring, hud.K * d, 5);
                var capsule = new Rect(ringLayout.Value.center.x - 44 * hud.K * d, ringLayout.Value.y, 88 * hud.K * d, ringLayout.Value.height);
                ui.Piece("Pressure ring", SkinSlots.MultiplierRing, capsule, root);
                pressureFill = ui.Piece("Pressure fill", SkinSlots.MultiplierRingFill, capsule, root);
                pressureFill.type = Image.Type.Filled; pressureFill.fillMethod = Image.FillMethod.Radial360;
                pressureFill.fillOrigin = (int)Image.Origin360.Top; pressureFill.fillClockwise = true;
                pressure = Text("Pressure", "", capsule, hud.CountPt, SkinTokens.Accent, root, SkinUi.Type.Display, TextAlignmentOptions.Center);
                Lay("Pressure plate", ringLayout, null, pressure);
                if (rules.ObjectiveKind != 0)
                {
                    var goal = catalog.Goal(rules.ObjectiveKind, rules.ObjectiveValue);
                    plates[1] = Plate(1, goal.Pictogram(rules.BonusType), goal.chip, "count", goal.text, root, at: slot++);
                    objective = plates[1].Count;
                }
                if (facts != null)
                {
                    var clock = hud.Plates[slot];
                    ui.Piece("Time plate", SkinSlots.GoalPlate, clock, root);
                    var clockLayout = PlateLayout.Row(clock, hud.K * d, 28);
                    var clockIcon = ui.Piece("Time icon", SkinSlots.IconClock, clockLayout.Icon, root);
                    timeLeft = Text("Time left", "", clockLayout.Number, hud.CountPt, SkinTokens.Score, root, SkinUi.Type.Display, TextAlignmentOptions.Center);
                    Lay("Time plate", clockLayout, clockIcon, timeLeft);
                }
            }

            // The moves tablet: the biggest numeral on screen, warming at 5 and ember at 3.
            movesGlow = ui.Rect<Image>("Moves glow", new Rect(hud.Moves.x - 20 * hud.K * d, hud.Moves.y - 20 * hud.K * d,
                hud.Moves.width + 40 * hud.K * d, hud.Moves.height + 40 * hud.K * d), root);
            movesGlow.sprite = art.SkinUi(SkinSlots.MovesWarmGlow); movesGlow.raycastTarget = false; movesGlow.enabled = false;
            movesFace = ui.Piece("Moves tablet", SkinSlots.MovesCalm, hud.Moves, root);
            var movesLayout = PlateLayout.Column(hud.Moves, hud.K * d, 28, 8);
            var movesIcon = ui.Piece("Moves icon", SkinSlots.IconHourglass, movesLayout.Icon, root);
            moves = Text("Moves remaining", "", movesLayout.Number, hud.MovesPt, SkinTokens.Score, root, SkinUi.Type.Display, TextAlignmentOptions.Center);
            Lay("Moves tablet", movesLayout, movesIcon, moves);

            var next = nextLabel = Text("Next row label", "NEXT ROW", hud.NextLabel, hud.LabelPt, SkinTokens.TextMuted, root, SkinUi.Type.Label,
                TextAlignmentOptions.Top);
            nextShade = ui.Underpaint("Next row shade", Rect.zero, root);
            FitUnderpaint(nextShade, next, true);
            next.transform.SetAsLastSibling();

            // The thumb row: pause, the Earn panel, the power and the reroll.
            var pause = ui.Rect<Image>("Pause", Layout.PauseButton, root);
            pause.color = Color.clear; pause.raycastTarget = true;
            var pauseButton = pause.gameObject.AddComponent<Button>(); pauseButton.transition = Selectable.Transition.None;
            pauseButton.onClick.AddListener(owner.Pause);
            ui.Piece("Pause plate", SkinSlots.GoalPlate, Layout.PauseFace, pause.transform);
            var face = Layout.PauseFace; float inner = face.width * 10 / BoardLayout.PauseDp;
            ui.Piece("Pause icon", SkinSlots.IconPause, new Rect(face.x + inner, face.y + inner, face.width - 2 * inner, face.height - 2 * inner), pause.transform);
            Earn(root);
            guardianTablet = HudTablet("Guardian action", Layout.GuardianButton, owner.SelectGuardian, root);
            rerollTablet = HudTablet("Reroll action", Layout.RerollButton, owner.Reroll, root);
            armedFace = guardianTablet.GetComponent<Image>();

            statusPlate = ui.Piece("Action status plate", SkinSlots.Plate, hud.Status, root);
            status = ui.Label("Action status", "", hud.Status, hud.StatusPt, SkinTokens.Text, root);
            statusPlate.enabled = false;
            // This always-rendered transparent surface already has a canvas
            // depth when a dialog opens. It catches the opening frame while new
            // dialog graphics are waiting for their first rendered layout.
            modalShield = ui.Rect<Image>("Modal input shield", new Rect(0, 0, Screen.width, Screen.height), root);
            modalShield.color = Color.clear; modalShield.raycastTarget = false;
        }
        // One goal plate, laid out by PlateLayout: the pictogram with its chip,
        // then the counter in the value area.
        private GoalPlate Plate(int index, string pictogram, string chip, string counter, string caption, Transform root, byte required = 0, int? at = null)
        {
            var rect = hud.Plates[at ?? index]; float d = Layout.Density, k = hud.K, u = k * d;
            var plate = new GoalPlate { Rect = rect, Counter = counter, Caption = caption };
            var touch = ui.Rect<Image>("Goal plate " + index, rect, root);
            touch.color = Color.clear; touch.raycastTarget = true;
            var button = touch.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None;
            button.onClick.AddListener(() => OpenBubble(index));
            touch.gameObject.AddComponent<LongPress>().Bind(() => OpenBubble(index));
            var parent = touch.transform;
            ui.Piece("Goal plate " + index + " face", SkinSlots.GoalPlate, rect, parent);
            var layout = PlateLayout.Row(rect, u, PlateLayout.IconDp, counter == "fill" ? hud.BarDp * d : 0);
            plate.Pictogram = ui.Pictogram("Goal plate " + index, pictogram, chip, layout.Icon, parent);
            // A met goal's tick sits on the pictogram's upper right corner.
            var tick = new Rect(layout.Icon.xMax - 11 * u, layout.Icon.yMax - 10 * u, 15 * u, 15 * u);
            string name = index == 0 ? "Score" : index == 1 ? "Theme" : "Secondary";
            if (counter == "fill" || counter == "count")
            {
                plate.Count = Text(name, "", layout.Number, hud.CountPt, SkinTokens.Score, parent, SkinUi.Type.Display, TextAlignmentOptions.Center);
                plate.Count.richText = true;
                if (counter == "fill")
                {
                    plate.Track = ui.Piece(name + " track", SkinSlots.CounterTrack, layout.Bar, parent);
                    plate.Fill = ui.Piece(name + " fill", SkinSlots.CounterFill, layout.Bar, parent);
                    plate.Tick = ui.Piece(name + " tick", SkinSlots.Tick, tick, parent);
                }
            }
            else if (counter == "ring")
            {
                // A one-move goal's ring, and its tick once met, centred in the value area.
                var centre = layout.Value.center;
                plate.Ring = ui.Piece(name + " ring", SkinSlots.CounterRing, new Rect(centre.x - 11 * u, centre.y - 11 * u, 22 * u, 22 * u), parent);
                plate.Tick = ui.Piece(name + " tick", SkinSlots.Tick, new Rect(centre.x - 14 * u, centre.y - 14 * u, 28 * u, 28 * u), parent);
            }
            else if (counter == "bar")
            {
                // Moves in a row: a bar across the value area that fills a move at
                // a time and empties when the row breaks.
                plate.Required = Math.Max((byte)1, required);
                float tall = (hud.BarDp + 2) * d;
                var bar = new Rect(layout.Value.x, layout.Value.center.y - tall / 2, layout.Value.width, tall);
                plate.Track = ui.Piece(name + " track", SkinSlots.CounterTrack, bar, parent);
                plate.Fill = ui.Piece(name + " fill", SkinSlots.CounterFill, bar, parent);
                plate.Tick = ui.Piece(name + " tick", SkinSlots.Tick, tick, parent);
            }
            Lay("Goal plate " + index, layout, plate.Pictogram, plate.Count);
            return plate;
        }
        // Shows a plate's progress; met says whether its star is earned.
        private void ShowPlate(GoalPlate plate, ulong progress, uint target, bool met)
        {
            if (plate == null) return;
            if (plate.Counter == "count") plate.Count.text = progress.ToString();
            if (plate.Counter == "fill")
            {
                // A met goal reads its target, whatever the count behind it.
                if (met) progress = target;
                plate.Count.text = progress + "<color=#" + Muted + ">/" + target + "</color>";
                ShowBar(plate, target == 0 ? 1 : Mathf.Clamp01((float)progress / target), met);
            }
            if (plate.Counter == "ring") { plate.Ring.enabled = !met; plate.Tick.enabled = met; }
            if (plate.Counter == "bar") ShowBar(plate, met ? 1 : Mathf.Clamp01((float)progress / plate.Required), met);
        }
        private void ShowBar(GoalPlate plate, float share, bool met)
        {
            var bar = SkinUi.ScreenRect(plate.Track.rectTransform);
            plate.Fill.enabled = share > 0;
            plate.Fill.sprite = art.SkinUi(met ? SkinSlots.CounterFillDone : SkinSlots.CounterFill);
            SkinUi.Place(plate.Fill.rectTransform, new Rect(bar.x, bar.y, Mathf.Max(bar.height, bar.width * share), bar.height), plate.Fill.transform.parent);
            plate.Tick.enabled = met;
        }
        // The Earn panel: the trigger pictogram, an arrow, the realm's bonus and
        // the rule's short caption.
        private void Earn(Transform root)
        {
            var rules = owner.Session.Rules;
            var rule = art.Guardian(rules.BonusType, rules.Trigger, rules.TriggerThreshold);
            var panel = Layout.EarnPanel; float d = Layout.Density, k = Layout.RowScale;
            Rect At(float x, float y, float w, float h) => new Rect(panel.x + x * k * d, panel.yMax - (y + h) * k * d, w * k * d, h * k * d);
            ui.Piece("Earn panel", SkinSlots.EarnPanel, panel, root);
            if (rule != null)
            {
                earnParts.Add(ui.Pictogram("Earn trigger", rule.pictogram, rule.chip, At(6, 7, 34, 34), root).gameObject);
                earnParts.Add(Text("Earn arrow", "→", At(40, 13, 16, 22), 14, SkinTokens.TextMuted, root, SkinUi.Type.Number, TextAlignmentOptions.Center).gameObject);
                earnParts.Add(ui.Piece("Earn bonus", HudLayout.BonusIcon(rules.BonusType, true), At(56, 10, 28, 28), root).gameObject);
                var caption = new Rect(panel.x + 90 * k * d, panel.y + 6 * k * d, panel.width - 94 * k * d, panel.height - 12 * k * d);
                earnCaption = ui.Label("Earn caption", rule.description, caption, hud.EarnPt, SkinTokens.Text, root, SkinUi.Type.Caption, TextAlignmentOptions.Left);
                earnParts.Add(earnCaption.gameObject);
            }
            // While a power is armed the panel beside its tablet holds the prompt
            // and a cancel instead: the words sit by the thumb, where the power
            // was chosen.
            float cancel = Mathf.Min(panel.height, BoardLayout.MinimumTouchDp * d);
            prompt = ui.Label("Bonus prompt", "", new Rect(panel.x + 10 * k * d, panel.y + 4 * k * d, panel.width - 12 * k * d - cancel, panel.height - 8 * k * d),
                HudLayout.PromptPt, SkinTokens.Text, root, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            prompt.lineSpacing = SkinUi.LineSpacing(prompt.font, HudLayout.CaptionLeading);
            var close = ui.Rect<Image>("Bonus cancel", new Rect(panel.xMax - cancel, panel.center.y - cancel / 2, cancel, cancel), root);
            close.color = Color.clear; close.raycastTarget = true;
            var button = close.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None;
            button.onClick.AddListener(owner.SelectGuardian);
            float glyph = 18 * k * d;
            ui.Piece("Bonus cancel icon", SkinSlots.IconClose, new Rect(close.rectTransform.rect.width / 2 - glyph / 2 + panel.xMax - cancel, panel.center.y - glyph / 2, glyph, glyph), close.transform);
            promptCancel = close.gameObject;
            prompt.gameObject.SetActive(false); promptCancel.SetActive(false);
        }
        // A power or reroll tablet: the opaque plate, its icon charged or empty,
        // and a 22 dp charge badge over its upper right corner.
        private SkinTablet HudTablet(string name, Rect rect, Action action, Transform root)
        {
            float d = Layout.Density, size = rect.width;
            var face = ui.Piece(name, SkinSlots.GoalPlate, rect, root);
            face.raycastTarget = true;
            var button = face.gameObject.AddComponent<Button>(); button.targetGraphic = face;
            button.transition = Selectable.Transition.None;
            face.gameObject.AddComponent<PressSquash>().Bind(art.SkinUi(SkinSlots.FxPress), d);
            button.onClick.AddListener(() => action());
            var halo = ui.Glow(name + " light", new Rect(rect.x + 4 * d, rect.y + 4 * d, size - 8 * d, size - 8 * d),
                SkinUi.WithAlpha(art.Token(SkinTokens.LightKey), .5f), face.transform, SkinTablet.BreathSeconds);
            float inset = size * 9 / BoardLayout.TabletDp, pip = size * 22 / BoardLayout.TabletDp;
            var glyph = ui.Piece(name + " icon", SkinSlots.IconReroll, new Rect(rect.x + inset, rect.y + inset, size - 2 * inset, size - 2 * inset), face.transform);
            var badgeRect = new Rect(rect.x + size * 46 / BoardLayout.TabletDp, rect.yMax + size * 6 / BoardLayout.TabletDp - pip, pip, pip);
            var badgeHalo = ui.Glow(name + " badge light", new Rect(badgeRect.x - 6 * d, badgeRect.y - 6 * d, pip + 12 * d, pip + 12 * d),
                SkinUi.WithAlpha(art.Token(SkinTokens.Accent), .35f), face.transform);
            var badge = ui.Piece(name + " badge", SkinSlots.Badge, badgeRect, face.transform);
            var count = ui.Label(name + " label", "", badgeRect, 12, SkinTokens.TextOnPrimary, face.transform, SkinUi.Type.Number);
            var tablet = face.gameObject.AddComponent<SkinTablet>();
            tablet.Bind(button, glyph, halo, badgeHalo, badge, count, art.Token(SkinTokens.TextOnPrimary), art.Token(SkinTokens.Text));
            var ring = ui.Piece(name + " full ring", SkinSlots.FxRingSoft, new Rect(badgeRect.x - 4 * d, badgeRect.y - 4 * d, pip + 8 * d, pip + 8 * d), face.transform);
            ring.color = art.Token(SkinTokens.Accent); ring.enabled = false; capRings[tablet] = ring;
            return tablet;
        }
        // Sizes a text's underpaint to the words it actually holds.
        private void FitUnderpaint(Image patch, TMP_Text text, bool centred)
        {
            var rect = SkinUi.ScreenRect(text.rectTransform);
            var size = text.GetPreferredValues(text.text, rect.width, float.PositiveInfinity);
            float width = Mathf.Min(rect.width, size.x), height = Mathf.Min(rect.height, size.y);
            float x = centred ? rect.center.x - width / 2 : rect.x;
            SkinUi.Place(patch.rectTransform, new Rect(x, rect.yMax - height, width, height), patch.transform.parent);
            float pad = SkinUi.UnderpaintPadDp * Layout.Density;
            patch.rectTransform.anchoredPosition -= new Vector2(pad, pad * .75f);
            patch.rectTransform.sizeDelta += new Vector2(2 * pad, 1.5f * pad);
            patch.enabled = !string.IsNullOrEmpty(text.text) && text.gameObject.activeSelf;
        }

        private void ShowTimeLeft()
        {
            var facts = owner.Session?.DailyFacts;
            if (timeLeft != null && facts != null) timeLeft.text = HudLayout.TimeLeft(facts.ClosesAt - facts.Now());
        }
        private uint movesLeft;
        private bool playing;
        private int starsLit;
        public void Summary(RunSummary state, BoardSession session, bool available)
        {
            ShowScore(session.Daily ? state.DailyScore : state.Score);
            movesLeft = HudLayout.MovesLeft(state, session);
            playing = state.Phase == (byte)CorePhase.Playing;
            moves.text = movesLeft.ToString();
            string tablet = HudLayout.MovesSlot(movesLeft);
            movesFace.sprite = art.SkinUi(tablet);
            moves.color = art.Token(tablet == SkinSlots.MovesEmber ? SkinTokens.Negative : tablet == SkinSlots.MovesWarm ? SkinTokens.Accent : SkinTokens.Score);
            movesGlow.enabled = tablet != SkinSlots.MovesCalm;
            movesGlow.sprite = art.SkinUi(tablet == SkinSlots.MovesEmber ? SkinSlots.MovesEmberGlow : SkinSlots.MovesWarmGlow);
            var rules = session.Rules;
            if (!session.Daily)
            {
                byte latched = state.LatchedStarSources;
                ShowPlate(plates[1], state.PrimaryProgress, rules.PrimaryCount, (latched & 2) != 0);
                ShowPlate(plates[2], state.SecondaryProgress, rules.SecondaryCount, (latched & 4) != 0);
                starsLit = HudLayout.StarCount(latched);
                for (int i = 0; i < 3; i++)
                {
                    bool earned = i < starsLit;
                    if (!flying[i]) stars[i].sprite = art.SkinUi(earned ? SkinSlots.StarLit : SkinSlots.StarSocket);
                    starHalos[i].enabled = earned && !flying[i];
                }
            }
            else
            {
                pressure.text = HudLayout.PressureValue(state);
                pressureFill.fillAmount = HudLayout.PressureProgress(state);
                ShowPlate(plates[1], state.ObjectiveTotal, 0, false);
                var facts = session.DailyFacts;
                if (facts != null)
                {
                    // The badge holds the best so far; its crown lights once this run beats it.
                    best.text = Math.Max(facts.Best, state.DailyScore).ToString("N0", System.Globalization.CultureInfo.InvariantCulture);
                    bool beaten = state.DailyScore > facts.Best;
                    bestCrown.sprite = art.SkinUi(SkinSlots.IconCrown); bestCrown.color = SkinUi.WithAlpha(Color.white, beaten ? 1 : .55f);
                    best.color = art.Token(beaten ? SkinTokens.Accent : SkinTokens.TextMuted);
                }
                ShowTimeLeft();
            }
            guardianTablet.Icons(art.SkinUi(HudLayout.BonusIcon(state.BonusType, true)), art.SkinUi(HudLayout.BonusIcon(state.BonusType, false)));
            rerollTablet.Icons(art.SkinUi(SkinSlots.IconReroll), art.SkinUi(SkinSlots.IconRerollEmpty));
            guardianTablet.Show(state.BonusCharges, available);
            rerollTablet.Show(state.RerollCharges, available);
            ShowCap(guardianTablet, state.BonusCharges); ShowCap(rerollTablet, state.RerollCharges);
            NeedsTextReflow = new[] { moves, score, objective, earnCaption }
                .Any(label => label != null && label.gameObject.activeInHierarchy && label.GetPreferredValues(label.text, label.rectTransform.rect.width, float.PositiveInfinity).y > label.rectTransform.rect.height + .5f);
        }
        // The armed guardian power: its tablet wears its armed face, the Earn
        // panel beside it says what to tap, with a cancel, and the rows that can
        // be tapped pulse. All follow the controller's choice, through any redraw.
        public void Choose(bool chosen)
        {
            BonusChosen = chosen;
            armedFace.sprite = art.SkinUi(chosen ? SkinSlots.TabletArmed : SkinSlots.GoalPlate);
            prompt.text = chosen ? BoardNotices.Prompt(owner.State.BonusType) : "";
            prompt.gameObject.SetActive(chosen); promptCancel.SetActive(chosen);
            foreach (var part in earnParts) part.SetActive(!chosen);
            ShowTargets();
        }
        // A soft band over every row that holds a block, while a power is armed.
        public const float TargetAlpha = .45f;
        private void ShowTargets()
        {
            for (int row = 0; row < 10; row++)
            {
                bool occupied = false;
                for (int col = 0; col < 8 && !occupied; col++) occupied = DisplayGrid[row * 8 + col] != 0;
                bool show = BonusChosen && occupied;
                if (targetRows[row] == null)
                {
                    if (!show) continue;
                    targetRows[row] = NewSprite("Bonus target row " + row, art.SkinUi(SkinSlots.FxGlow), 3);
                    Size(targetRows[row], new Rect(Layout.Board.x - .1f * Layout.Board.width, Layout.Board.y + (row - .25f) * Layout.Cell, 1.2f * Layout.Board.width, 1.5f * Layout.Cell));
                }
                targetRows[row].enabled = show;
            }
        }
        // A full tablet says so: its badge reads the count over the cap, in a gold ring.
        private void ShowCap(SkinTablet tablet, int charges)
        {
            bool full = charges >= Protocol.ChargeCap;
            capRings[tablet].enabled = full;
            tablet.Count.enableWordWrapping = false;
            tablet.Count.text = full ? charges + "/" + Protocol.ChargeCap : charges.ToString();
            tablet.Count.fontSize = (full ? 9.5f : 12) * Layout.Density * ui.Scale;
        }
        public void Status(string text)
        {
            status.text = text;
            if (statusPlate != null) statusPlate.enabled = !string.IsNullOrEmpty(text);
        }
        // Move feedback, shown once the move's blocks have settled (DECISIONS
        // 2026-10-02). "+N" rises from just above the score plate while the
        // score counts up, and the old client's callouts shout over the board's
        // centre in the display face: "PERFECT" for a perfect clear and
        // "COMBO ×N" for a move that cleared N lines, two or more. A perfect
        // clear's reroll rises from its tablet, or the tablet says it is full.
        public const int ComboLines = 2;
        public static string ComboText(int lines) => lines >= ComboLines ? "COMBO ×" + lines : null;
        public const float ComboSeconds = 1.6f, PerfectSeconds = 1.9f, PerfectDelay = .16f, GainSeconds = .9f, GainRiseDp = 22;
        public const string FullNote = "Full";
        public void ShowGains(uint scoreGain, ulong themeGain, int lines, bool reducedMotion, bool perfectClear = false, bool rerollGranted = false,
            int bonusEarned = 0, bool bonusFull = false)
        {
            float d = Layout.Density;
            // An earned guardian charge rises from its tablet; an earn the full
            // tablet could not take says so instead of passing unseen.
            if (bonusEarned > 0)
            {
                var power = Layout.GuardianButton; var foot = new Vector2(power.center.x, power.yMax + 2 * d);
                if (bonusFull) Gain("Accepted bonus cap", FullNote, foot, SkinTokens.Accent, 14, reducedMotion);
                else Gain("Accepted bonus chip", "+" + bonusEarned, foot, SkinTokens.Accent, 18, reducedMotion);
            }
            if (scoreGain > 0)
            {
                if (!reducedMotion) StartCoroutine(CountScore(scoreShown + scoreGain));
                // Just above the score's own numerals, centred on them.
                Gain("Accepted score chip", "+" + scoreGain, AboveNumerals(score), SkinTokens.Score, 22, reducedMotion);
            }
            // The objective's gain rises beside its plate, clear of the plate above it.
            if (themeGain > 0 && objective != null)
                Gain("Accepted theme chip", "+" + themeGain, new Vector2(plates[1].Rect.x, plates[1].Rect.center.y), SkinTokens.Objective, 18, reducedMotion, true);
            string combo = ComboText(lines);
            float centre = Layout.Board.center.y, apart = 30 * d * ui.Scale;
            if (perfectClear)
                Callout("Accepted perfect clear", "PERFECT", 46, SkinTokens.Accent, centre + (combo == null ? 0 : apart), PerfectDelay, PerfectSeconds, reducedMotion);
            if (combo != null)
                Callout("Accepted combo", combo, 38, SkinTokens.Text, centre - (perfectClear ? apart : 0), 0, ComboSeconds, reducedMotion);
            if (!perfectClear) return;
            var tablet = Layout.RerollButton;
            if (rerollGranted) Gain("Accepted reroll chip", "+1", new Vector2(tablet.center.x, tablet.yMax + 2 * d), SkinTokens.Accent, 18, reducedMotion);
            else Gain("Accepted reroll cap", FullNote, new Vector2(tablet.center.x, tablet.yMax + 2 * d), SkinTokens.Accent, 14, reducedMotion);
        }
        // The top centre of a number's drawn numerals, on screen.
        private static Vector2 AboveNumerals(TMP_Text number)
        {
            number.ForceMeshUpdate();
            var ink = number.textBounds; var rect = number.rectTransform;
            if (ink.size.x <= 0) { var whole = SkinUi.ScreenRect(rect); return new Vector2(whole.center.x, whole.center.y); }
            return rect.TransformPoint(new Vector3(ink.center.x, ink.max.y));
        }
        // A cue: words in the display face with a dark outline, so they read
        // over any block or painting. The outline is the same words drawn in
        // ink around the fill (eight copies), inside one holder that the cue's
        // motion and fade act on.
        public const string CueHolder = " cue";
        private static readonly Color32 CalloutInk = new Color32(4, 14, 22, 255);
        private (RectTransform holder, CanvasGroup group, TMP_Text label) Cue(string name, string value, string token, float size, float maxWidth = 0)
        {
            float d = Layout.Density;
            var holder = new GameObject(name + CueHolder, typeof(RectTransform), typeof(CanvasGroup)).GetComponent<RectTransform>();
            holder.SetParent(canvas.transform, false); holder.SetSiblingIndex(modalShield.transform.GetSiblingIndex());
            var group = holder.GetComponent<CanvasGroup>(); group.blocksRaycasts = false; group.interactable = false;
            TMP_Text Words(string label, Color color)
            {
                var text = ui.Label(label, value, Rect.zero, size, token, holder, SkinUi.Type.Display);
                text.enableWordWrapping = false; text.color = color;
                var rect = text.rectTransform; rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.pivot = new Vector2(.5f, .5f);
                rect.offsetMin = rect.offsetMax = Vector2.zero;
                return text;
            }
            var probe = Words(name + " outline", CalloutInk);
            float scale = 1, wide = probe.GetPreferredValues(value, float.PositiveInfinity, float.PositiveInfinity).x;
            if (maxWidth > 0 && wide > maxWidth) scale = maxWidth / wide;
            probe.fontSize *= scale;
            // The outline's weight: a twelfth of the letter size, at least 1.5 dp.
            float stroke = Mathf.Max(1.5f * d, probe.fontSize / 12);
            for (int i = 0; i < 8; i++)
            {
                var copy = i == 0 ? probe : Words(name + " outline", CalloutInk);
                copy.fontSize = probe.fontSize;
                float angle = i * Mathf.PI / 4;
                copy.rectTransform.anchoredPosition = new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * stroke;
            }
            var fill = Words(name, art.Token(token)); fill.fontSize = probe.fontSize;
            var want = fill.GetPreferredValues(value, float.PositiveInfinity, float.PositiveInfinity);
            holder.pivot = new Vector2(.5f, .5f); holder.anchorMin = holder.anchorMax = Vector2.zero;
            holder.sizeDelta = new Vector2(Mathf.Ceil(want.x) + 2 * stroke + 8 * d, Mathf.Ceil(want.y) + 2 * stroke + 4 * d);
            return (holder, group, fill);
        }
        private void PlaceCue(RectTransform holder, Vector2 centre)
        {
            var corners = new Vector3[4]; ((RectTransform)canvas.transform).GetWorldCorners(corners);
            holder.anchoredPosition = (centre - (Vector2)corners[0]) / canvas.scaleFactor;
        }
        // A small amount or note that rises from foot (its bottom centre; its
        // right middle when beside) and fades. It stays inside the safe area:
        // where there is no room to rise it rises less. Reduced motion shows it
        // in place and fades it.
        private void Gain(string name, string value, Vector2 foot, string token, float size, bool reducedMotion, bool beside = false)
        {
            float d = Layout.Density;
            var (holder, group, _) = Cue(name, value, token, size);
            float width = holder.sizeDelta.x, height = holder.sizeDelta.y;
            var frame = Layout.Frame;
            float x = beside ? foot.x - width / 2 - 4 * d : foot.x, y = beside ? foot.y : foot.y + height / 2;
            x = Mathf.Clamp(x, frame.xMin + width / 2 + 2 * d, frame.xMax - width / 2 - 2 * d);
            y = Mathf.Min(y, frame.yMax - height / 2);
            float rise = reducedMotion ? 0 : Mathf.Clamp(frame.yMax - height / 2 - y, 0, GainRiseDp * d);
            PlaceCue(holder, new Vector2(x, y));
            StartCoroutine(RiseAndFade(holder, group, rise));
        }
        private static IEnumerator RiseAndFade(RectTransform holder, CanvasGroup group, float rise)
        {
            var origin = holder.anchoredPosition;
            for (float elapsed = 0; elapsed < GainSeconds && holder != null; elapsed += Time.unscaledDeltaTime)
            {
                float k = elapsed / GainSeconds;
                holder.anchoredPosition = origin + Vector2.up * rise * (1 - (1 - k) * (1 - k));
                group.alpha = Mathf.Clamp01((GainSeconds - elapsed) / .35f);
                yield return null;
            }
            if (holder != null) Destroy(holder.gameObject);
        }
        // A callout, as the old client shouted it: the word in the display face,
        // a coloured fill inside a dark outline over a glow, never wider than
        // the board. It punches in past its size with a turn, settles, holds,
        // then swells, rises and fades. Reduced motion fades it in and out in
        // place.
        public const float CalloutRiseDp = 14;
        private static readonly (float at, float scale, float turn, float rise)[] Shout =
            { (0, 0, -20, 0), (.1f, 1.4f, 8, 0), (.2f, 1.1f, -3, 0), (.72f, 1.1f, 0, 0), (.86f, 1.2f, 5, .3f), (1, .9f, 12, 1) };
        // The callout's pose at k, from 0 to 1 of its time: its scale, its turn in
        // degrees, how far it has risen (0 to 1) and its opacity.
        public static (float scale, float turn, float rise, float alpha) CalloutPose(float k)
        {
            k = Mathf.Clamp01(k);
            int next = 1; while (next < Shout.Length - 1 && Shout[next].at < k) next++;
            var from = Shout[next - 1]; var to = Shout[next];
            float t = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(from.at, to.at, k));
            return (Mathf.Lerp(from.scale, to.scale, t), Mathf.Lerp(from.turn, to.turn, t), Mathf.Lerp(from.rise, to.rise, t),
                Mathf.Min(Mathf.Clamp01(k / Shout[1].at), Mathf.Clamp01((1 - k) / (1 - Shout[4].at))));
        }
        private void Callout(string name, string value, float size, string token, float centreY, float delay, float seconds, bool reducedMotion)
        {
            float d = Layout.Density, width = Layout.Board.width - 16 * d;
            var (holder, group, label) = Cue(name, value, token, size, width / 1.4f);
            PlaceCue(holder, new Vector2(Layout.Board.center.x, centreY));
            float tall = holder.sizeDelta.y;
            var glow = ui.Rect<Image>(name + " glow", Rect.zero, holder);
            glow.sprite = art.SkinUi(SkinSlots.FxGlow); glow.raycastTarget = false; glow.color = SkinUi.WithAlpha(art.Token(SkinTokens.Accent), .4f);
            glow.rectTransform.anchorMin = glow.rectTransform.anchorMax = glow.rectTransform.pivot = new Vector2(.5f, .5f);
            glow.rectTransform.anchoredPosition = Vector2.zero; glow.rectTransform.sizeDelta = new Vector2(4.8f * tall, 2.2f * tall);
            glow.transform.SetAsFirstSibling();
            StartCoroutine(Shouted(holder, group, delay, seconds, reducedMotion ? 0 : CalloutRiseDp * d, reducedMotion));
        }
        private static IEnumerator Shouted(RectTransform holder, CanvasGroup group, float delay, float seconds, float rise, bool reducedMotion)
        {
            group.alpha = 0; var origin = holder.anchoredPosition;
            for (float waited = 0; waited < delay; waited += Time.unscaledDeltaTime) yield return null;
            for (float elapsed = 0; elapsed < seconds && holder != null; elapsed += Time.unscaledDeltaTime)
            {
                float k = elapsed / seconds;
                if (reducedMotion) group.alpha = Mathf.Min(Mathf.Clamp01(elapsed / .12f), Mathf.Clamp01((seconds - elapsed) / .25f));
                else
                {
                    var pose = CalloutPose(k);
                    holder.localScale = new Vector3(pose.scale, pose.scale, 1);
                    holder.localRotation = Quaternion.Euler(0, 0, pose.turn);
                    holder.anchoredPosition = origin + Vector2.up * rise * pose.rise;
                    group.alpha = pose.alpha;
                }
                yield return null;
            }
            if (holder != null) Destroy(holder.gameObject);
        }
        public static string ObjectiveName(byte kind, byte value, byte count = 0) => PageCatalog.Load().ObjectiveName(kind, value, count);

        // Pressure, as the old client showed it (DECISIONS 2026-10-02): with two
        // rows or fewer free above the stack the frame and the glass pulse warm
        // every two seconds; with none free they pulse red, faster and stronger.
        // The guardian looks worried until the board recovers. Reduced motion
        // holds the tint instead of pulsing.
        public const int PressureRows = 2;
        public static int FreeRows(byte[] grid)
        {
            for (int row = 9; row >= 0; row--)
                for (int col = 0; col < 8; col++)
                    if (grid[row * 8 + col] != 0) return 9 - row;
            return 10;
        }
        // The guardian's level opens with the guardian: its name and title shout
        // over the board while it greets the player from its aura.
        public void IntroduceGuardian(bool reducedMotion)
        {
            float centre = Layout.Board.center.y, apart = 26 * Layout.Density * ui.Scale;
            Callout("Guardian name", art.GuardianName.ToUpperInvariant(), 46, SkinTokens.Accent, centre + apart, 0, IntroSeconds, reducedMotion);
            Callout("Guardian title", art.GuardianTitle, 22, SkinTokens.Text, centre - apart, PerfectDelay, IntroSeconds, reducedMotion);
            Face("greeting"); guardianCheerUntil = Time.unscaledTime + IntroSeconds;
        }
        // 0 calm, 1 warning, 2 critical.
        public static int PressureLevel(int freeRows) => freeRows <= 0 ? 2 : freeRows <= PressureRows ? 1 : 0;
        public int Pressure { get; private set; }
        public const string PressureFace = "surprised";
        private string RestFace => Pressure > 0 ? PressureFace : "idle";
        private void ShowPressure(float now)
        {
            if (pressureFrame == null) return;
            pressureFrame.enabled = pressureTint.enabled = Pressure > 0;
            if (Pressure == 0) return;
            bool critical = Pressure == 2;
            var danger = art.Token(SkinTokens.Negative);
            var tone = critical ? danger : Color.Lerp(danger, art.Token(SkinTokens.Accent), .5f);
            float wave = owner.ReducedMotion ? .6f : .5f - .5f * Mathf.Cos(2 * Mathf.PI * now / (critical ? 1.2f : 2));
            pressureFrame.color = SkinUi.WithAlpha(tone, critical ? Mathf.Lerp(.5f, 1, wave) : Mathf.Lerp(.3f, .9f, wave));
            pressureTint.color = SkinUi.WithAlpha(tone, (critical ? .5f : .28f) * wave);
        }
        public void SetBoard(byte[] grid)
        {
            Pressure = PressureLevel(FreeRows(grid));
            foreach (var block in blocks.Values) ReturnBlock(block);
            blocks.Clear(); DisplayGrid = (byte[])grid.Clone();
            for (int row = 0; row < 10; row++) for (int col = 0; col < 8;)
            {
                byte width = grid[row * 8 + col];
                if (width == 0) { col++; continue; }
                var sprite = TakeBlock("Block " + row + ":" + col, width);
                PositionBlock(sprite, row, col, width); blocks.Add(row * 8 + col, sprite); col += width;
            }
            if (BonusChosen) ShowTargets();
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
                    // The player's move has its sound, every time; falls are silent.
                    if (reason == 0) sound(SoundCues.Move);
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
                        sound(SoundCues.LineBreak); clears++;
                        yield return Clear(removed, clears, (uint)NativeWire.Read(item.Payload, 0, 2), reducedMotion);
                    }
                    else
                    {
                        sound(SoundCues.Bonus);
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
                    // The perfect clear bursts over the whole board; its callout follows the trace.
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
        // The next-row label sits in the incoming row's path; it steps aside
        // while the row crosses it and returns once the row has landed.
        private TMP_Text nextLabel;
        private Image nextShade;
        private float nextAlpha = -1, nextShadeAlpha;
        private void ShowNextLabel(float visible)
        {
            if (nextLabel == null) return;
            if (nextAlpha < 0) { nextAlpha = nextLabel.color.a; nextShadeAlpha = nextShade.color.a; }
            nextLabel.color = SkinUi.WithAlpha(nextLabel.color, nextAlpha * visible);
            nextShade.color = SkinUi.WithAlpha(nextShade.color, nextShadeAlpha * visible);
        }
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
                ShowNextLabel(LabelClearance(incoming.Select(item => item.sprite)));
                yield return null;
            }
            ShowNextLabel(1);
            foreach (var (sprite, _, _) in incoming) ReturnBlock(sprite);
        }
        // The label fades as a rising block nears it: gone while one crosses it,
        // whole again a cell away.
        private float LabelClearance(IEnumerable<SpriteRenderer> sprites)
        {
            if (nextLabel == null) return 1;
            var zone = SkinUi.ScreenRect(nextLabel.rectTransform);
            float nearest = float.PositiveInfinity;
            foreach (var sprite in sprites)
            {
                var b = sprite.bounds;
                float gap = Mathf.Max(zone.yMin - b.max.y, b.min.y - zone.yMax);
                nearest = Mathf.Min(nearest, Mathf.Max(0, gap));
            }
            return Mathf.Clamp01(nearest / Layout.Cell);
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

        public void OpenModal(string title, string body, params (string label, Action action)[] actions) =>
            OpenModal(title, body, null, actions);
        // The board's dialogs share the Lumen dialog of the pause: the guardian's
        // medallion breaking the panel's top edge, a Fraunces title over muted
        // details, 56 dp pills with the first one lit, and a destructive action
        // as the secondary pill in the negative ink with the close icon, set
        // apart from the actions above it.
        public const float DestructiveGapDp = 16, DialogTitleDp = 30, DialogDetailsDp = 14, DialogPillDp = 56;
        public void OpenModal(string title, string body, string destructive, params (string label, Action action)[] actions)
        {
            CloseModal();
            modalShield.color = art.Token(SkinTokens.Scrim); modalShield.raycastTarget = true;
            modal = new GameObject("Modal content", typeof(RectTransform));
            modal.transform.SetParent(modalShield.transform, false);
            SkinUi.Place(modal.GetComponent<RectTransform>(), new Rect(0, 0, Screen.width, Screen.height), modalShield.transform);
            float d = Layout.Density, width = Mathf.Min(356 * d, Layout.Frame.width - 44 * d), inner = width - 52 * d;
            float titleHeight = ui.TextHeight(title, inner, DialogTitleDp, SkinUi.Type.Title);
            float bodyHeight = string.IsNullOrEmpty(body) ? 0 : ui.TextHeight(body, inner, DialogDetailsDp, SkinUi.Type.Caption);
            var buttonHeights = actions.Select(action => Mathf.Max(DialogPillDp * d,
                ui.TextHeight(action.label, inner - 20 * d, SkinUi.ButtonDp, SkinUi.Type.Number) + 24 * d)).ToArray();
            float gap = actions.Any(action => action.label == destructive) ? DestructiveGapDp * d : 0;
            float contentHeight = 38 * d + titleHeight + (bodyHeight > 0 ? 6 * d + bodyHeight : 0) + 22 * d
                + buttonHeights.Sum() + Mathf.Max(0, actions.Length - 1) * 12 * d + gap + 30 * d;
            // The medallion rises 51 dp above the panel; both stay inside the frame.
            float room = Layout.Frame.height - 24 * d - 51 * d, height = Mathf.Min(room, contentHeight);
            float top = Layout.Frame.center.y + height / 2 - 26 * d;
            var rect = new Rect(Layout.Frame.center.x - width / 2, top - height, width, height);
            var panel = ui.Piece("Dialog panel", SkinSlots.Dialog, rect, modal.transform);
            panel.raycastTarget = true;
            ui.Medallion("Dialog guardian", new Rect(rect.center.x - 40 * d, top + 11 * d - 40 * d, 80 * d, 80 * d), art.Sprite("boss__portrait"), modal.transform);
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
            float x = rect.x + 26 * d, cursor = contentRect.yMax - 38 * d;
            ui.Label("Dialog title", title, new Rect(x, cursor - titleHeight, inner, titleHeight), DialogTitleDp, SkinTokens.Text, content, SkinUi.Type.Title);
            cursor -= titleHeight;
            if (bodyHeight > 0)
            {
                cursor -= 6 * d;
                ui.Label("Dialog details", body, new Rect(x, cursor - bodyHeight, inner, bodyHeight), DialogDetailsDp, SkinTokens.TextMuted, content,
                    SkinUi.Type.Caption);
                cursor -= bodyHeight;
            }
            cursor -= 22 * d;
            for (int i = 0; i < actions.Length; i++)
            {
                bool destroys = actions[i].label == destructive, lit = i == 0 && !destroys;
                if (destroys && i > 0) cursor -= gap;
                cursor -= buttonHeights[i];
                var pill = new Rect(x, cursor, inner, buttonHeights[i]);
                if (lit && !owner.ReducedMotion)
                    ui.Glow("Dialog " + actions[i].label + " halo", new Rect(pill.center.x - pill.width * .65f, pill.center.y - pill.height * .65f,
                        pill.width * 1.3f, pill.height * 1.3f), SkinUi.WithAlpha(art.Token(SkinTokens.Accent), .4f), content, PageViews.HaloSeconds);
                ui.TextButton("Dialog " + actions[i].label, pill, actions[i].label, actions[i].action, lit, content, out var label,
                    destroys ? SkinSlots.IconClose : null);
                if (destroys) label.color = art.Token(SkinTokens.Negative);
                cursor -= 12 * d;
            }
        }
        // A small confirm sheet in the thumb zone, standing over the control it
        // belongs to: a question, its cost in one short line and two compact
        // buttons. It leaves the board's centre clear; a tap outside it keeps
        // things as they are (the second action).
        public const float SheetWidthDp = 236, SheetButtonDp = 48, SheetTitleDp = 18, SheetLineDp = 13;
        public void OpenSheet(Rect over, string title, string line, (string label, Action action) confirm, (string label, Action action) keep)
        {
            CloseModal();
            float d = Layout.Density, pad = 12 * d, gap = 8 * d;
            modalShield.color = SkinUi.WithAlpha(art.Token(SkinTokens.Scrim), .28f); modalShield.raycastTarget = true;
            modal = new GameObject("Modal content", typeof(RectTransform));
            modal.transform.SetParent(modalShield.transform, false);
            SkinUi.Place(modal.GetComponent<RectTransform>(), new Rect(0, 0, Screen.width, Screen.height), modalShield.transform);
            var outside = ui.Rect<Image>("Sheet outside", new Rect(0, 0, Screen.width, Screen.height), modal.transform);
            outside.color = Color.clear; outside.raycastTarget = true;
            outside.gameObject.AddComponent<TouchAnywhere>().Touched = () => keep.action();
            var frame = Layout.Frame;
            float width = Mathf.Min(SheetWidthDp * d * Mathf.Sqrt(ui.Scale), frame.width - 16 * d), inner = width - 2 * pad;
            float titleHeight = ui.TextHeight(title, inner, SheetTitleDp, SkinUi.Type.Title), lineHeight = ui.TextHeight(line, inner, SheetLineDp, SkinUi.Type.Caption);
            float height = pad + titleHeight + 2 * d + lineHeight + 10 * d + SheetButtonDp * d + pad;
            float x = Mathf.Clamp(over.xMax + 4 * d - width, frame.xMin + 8 * d, frame.xMax - 8 * d - width);
            var rect = new Rect(x, over.yMax + 10 * d, width, height);
            var panel = ui.Piece("Sheet panel", SkinSlots.Plate, rect, modal.transform); panel.raycastTarget = true;
            float cursor = rect.yMax - pad - titleHeight;
            ui.Label("Dialog title", title, new Rect(rect.x + pad, cursor, inner, titleHeight), SheetTitleDp, SkinTokens.Text, modal.transform, SkinUi.Type.Title);
            cursor -= 2 * d + lineHeight;
            ui.Label("Dialog details", line, new Rect(rect.x + pad, cursor, inner, lineHeight), SheetLineDp, SkinTokens.TextMuted, modal.transform, SkinUi.Type.Caption);
            float button = (inner - gap) / 2, y = rect.y + pad;
            ui.TextButton("Dialog " + confirm.label, new Rect(rect.x + pad, y, button, SheetButtonDp * d), confirm.label, confirm.action, true, modal.transform, out _);
            ui.TextButton("Dialog " + keep.label, new Rect(rect.x + pad + button + gap, y, button, SheetButtonDp * d), keep.label, keep.action, false, modal.transform, out _);
        }
        public void CloseModal()
        {
            if (modal != null) { modal.SetActive(false); Destroy(modal); }
            modal = null;
            if (modalShield == null) return;
            modalShield.color = Color.clear; modalShield.raycastTarget = false;
            var scene = modalShield.GetComponentInChildren<PausedScene>(true);
            if (scene != null) { scene.gameObject.SetActive(false); Destroy(scene.gameObject); }
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
            if (!countingScore) { scoreShown = value; ShowScoreText(value); }
        }
        private void ShowScoreText(uint value)
        {
            if (!hud.Campaign) { score.text = value.ToString("N0", System.Globalization.CultureInfo.InvariantCulture); return; }
            // The plate counts toward the star: a met target reads full, with its tick.
            uint target = owner.Session.Rules.PointsRequired;
            ShowPlate(plates[0], Math.Min(value, target), target, value >= target);
        }
        private IEnumerator CountScore(uint target)
        {
            countingScore = true; scoreTarget = target;
            yield return new WaitForSecondsRealtime(.35f);
            uint from = scoreShown;
            for (float t = 0; t < .45f && scoreTarget >= from; t += Time.unscaledDeltaTime)
            {
                scoreShown = from + (uint)Mathf.RoundToInt((scoreTarget - from) * (1 - Mathf.Pow(1 - t / .45f, 3)));
                ShowScoreText(scoreShown);
                yield return null;
            }
            countingScore = false; ShowScore(scoreTarget);
            Pop(score.rectTransform, 1.18f, .2f);
        }

        // After an accepted action: each newly earned star flies from its goal's
        // plate to the next empty socket, left to right, and ignites there, and
        // the guardian celebrates a combo, a perfect clear or a star. Reduced
        // motion lights the socket and keeps the guardian's face, without movement.
        public void Celebrate(byte previousStars, byte earnedStars, int lines, bool perfectClear)
        {
            bool earned = false;
            if (hud.Campaign)
                foreach (var (goal, socket) in HudLayout.NewStars(previousStars, earnedStars))
                {
                    earned = true;
                    if (!owner.ReducedMotion) StartCoroutine(Fly(goal, socket));
                }
            if (!earned && lines < ComboLines && !perfectClear || guardianFinal) return;
            Face("celebrate");
            guardianCheerUntil = Time.unscaledTime + GuardianCheer;
            if (!owner.ReducedMotion) GuardianPulse(SkinSlots.FxHalo, art.Token(SkinTokens.LightGlow), .9f, .28f);
        }
        // The star rises from the plate's pictogram along an arc for 450 ms while
        // the socket waits empty; it then lands, scaling 0.6, 1.15, 1 over 400 ms
        // with a flare, a ring and six sparks.
        public const float FlightSeconds = .45f;
        private IEnumerator Fly(int goal, int index)
        {
            var socket = stars[index].rectTransform;
            var to = SkinUi.ScreenRect(socket).center;
            var from = SkinUi.ScreenRect(plates[goal].Pictogram.rectTransform).center;
            float d = Layout.Density, size = socket.rect.width;
            var gold = art.Token(SkinTokens.Accent);
            flying[index] = true;
            stars[index].sprite = art.SkinUi(SkinSlots.StarSocket); starHalos[index].enabled = false;
            var star = ui.Rect<Image>("Star " + index + " flight", new Rect(from.x - size / 2, from.y - size / 2, size, size), canvas.transform);
            star.sprite = art.SkinUi(SkinSlots.StarLit); star.raycastTarget = false;
            star.transform.SetSiblingIndex(modalShield.transform.GetSiblingIndex());
            var trail = ui.Rect<Image>("Star " + index + " trail", new Rect(from.x - size / 2, from.y - size / 2, size, size), canvas.transform);
            trail.sprite = art.SkinUi(SkinSlots.FxTrail); trail.raycastTarget = false; trail.color = SkinUi.WithAlpha(gold, .55f);
            trail.transform.SetSiblingIndex(star.transform.GetSiblingIndex());
            var lift = Vector2.up * 40 * d + Vector2.left * 12 * d;
            for (float t = 0; t < FlightSeconds; t += Time.unscaledDeltaTime)
            {
                float k = Mathf.SmoothStep(0, 1, t / FlightSeconds), scale = Mathf.Lerp(.6f, 1, k);
                var at = Vector2.Lerp(from, to, k) + lift * Mathf.Sin(Mathf.PI * k);
                SkinUi.Place(star.rectTransform, new Rect(at.x - size * scale / 2, at.y - size * scale / 2, size * scale, size * scale), canvas.transform);
                var behind = Vector2.Lerp(from, to, Mathf.Max(0, k - .12f)) + lift * Mathf.Sin(Mathf.PI * Mathf.Max(0, k - .12f));
                SkinUi.Place(trail.rectTransform, new Rect(behind.x - size * .4f, behind.y - size * .4f, size * .8f, size * .8f), canvas.transform);
                yield return null;
            }
            Destroy(star.gameObject); Destroy(trail.gameObject);
            flying[index] = false;
            stars[index].sprite = art.SkinUi(SkinSlots.StarLit); starHalos[index].enabled = true;
            var origin = socket.anchoredPosition;
            float flare = 48 * d;
            var bloom = ui.Rect<Image>("Star " + index + " flare", new Rect(to.x - flare / 2, to.y - flare / 2, flare, flare), socket.parent);
            bloom.sprite = art.SkinUi(SkinSlots.FxStarFlare); bloom.raycastTarget = false; bloom.transform.SetSiblingIndex(socket.GetSiblingIndex());
            var sparks = new Image[6];
            string[] kinds = { SkinSlots.FxSpark1, SkinSlots.FxSpark2, SkinSlots.FxSpark3 };
            for (int i = 0; i < 6; i++)
            {
                sparks[i] = ui.Rect<Image>("Star " + index + " spark", new Rect(to.x - 4 * d, to.y - 4 * d, 8 * d, 8 * d), canvas.transform);
                sparks[i].sprite = art.SkinUi(kinds[i % 3]); sparks[i].raycastTarget = false; sparks[i].color = gold;
            }
            StartCoroutine(Ring(starRings[index]));
            for (float t = 0; t < .4f && socket != null; t += Time.unscaledDeltaTime)
            {
                float k = t / .4f, scale = k < .5f ? Mathf.Lerp(.6f, 1.15f, k / .5f) : Mathf.Lerp(1.15f, 1, (k - .5f) / .5f);
                socket.localScale = new Vector3(scale, scale, 1);
                socket.anchoredPosition = origin - socket.rect.size * (scale - 1) / 2;
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
            if (socket != null) { socket.localScale = Vector3.one; socket.anchoredPosition = origin; }
        }

        // A tap or long press on a plate opens its bubble: the goal's caption and
        // its progress, beside the plate with the tail pointing at it. The next
        // touch anywhere closes it.
        public bool BubbleOpen => bubble != null;
        public bool ModalOpen => modal != null;
        public void OpenBubble(int index)
        {
            if (bubble != null || plates[index] == null || owner.Session == null) return;
            var plate = plates[index]; var rules = owner.Session.Rules;
            string progress = owner.Session.Daily ? null
                : index == 0 ? Math.Min(scoreShown, rules.PointsRequired) + " / " + rules.PointsRequired
                : index == 1 ? owner.State.PrimaryProgress + " / " + rules.PrimaryCount
                : ((owner.State.LatchedStarSources & 4) != 0 ? rules.SecondaryCount : owner.State.SecondaryProgress) + " / " + Math.Max((byte)1, rules.SecondaryCount);
            float d = Layout.Density, k = hud.K;
            var catcher = ui.Rect<Image>("Bubble catcher", new Rect(0, 0, Screen.width, Screen.height), canvas.transform);
            catcher.color = Color.clear; catcher.raycastTarget = true;
            catcher.transform.SetSiblingIndex(modalShield.transform.GetSiblingIndex());
            catcher.gameObject.AddComponent<TouchAnywhere>().Touched = CloseBubble;
            bubble = catcher.gameObject;
            // The body is 150 dp wide (more for larger text), padded 12 by 10 dp.
            float width = Mathf.Max(150 * k, 150 * k * Mathf.Sqrt(ui.Scale)) * d, inner = width - 24 * k * d;
            float captionHeight = ui.TextHeight(plate.Caption, inner, hud.BubblePt, SkinUi.Type.Caption, HudLayout.BubbleLeading);
            float countHeight = progress == null ? 0 : ui.TextHeight(progress, inner, hud.BubbleCountPt, SkinUi.Type.Display);
            float height = Mathf.Max(70 * k * d, 20 * k * d + captionHeight + countHeight);
            float tail = 14 * k * d, right = plate.Rect.x - (tail - 2 * k * d);
            float top = Mathf.Min(Layout.Frame.yMax - 4 * d, plate.Rect.center.y + height / 2);
            var body = new Rect(right - width, top - height, width, height);
            ui.Piece("Bubble", SkinSlots.TapBubble, body, bubble.transform);
            float tailY = Mathf.Clamp(plate.Rect.center.y, body.y + 18 * k * d, body.yMax - 18 * k * d);
            ui.Piece("Bubble tail", SkinSlots.TapBubbleTail, new Rect(body.xMax - 2 * k * d, tailY - 9 * k * d, tail, 18 * k * d), bubble.transform);
            var caption = ui.Label("Bubble caption", plate.Caption, new Rect(body.x + 12 * k * d, body.yMax - 10 * k * d - captionHeight, inner, captionHeight),
                hud.BubblePt, SkinTokens.TextOnPrimary, bubble.transform, SkinUi.Type.Caption, TextAlignmentOptions.TopLeft);
            caption.lineSpacing = SkinUi.LineSpacing(caption.font, HudLayout.BubbleLeading);
            if (progress != null)
                ui.Label("Bubble progress", progress, new Rect(body.x + 12 * k * d, body.yMax - 10 * k * d - captionHeight - countHeight, inner, countHeight),
                    hud.BubbleCountPt, SkinTokens.TextOnPrimary, bubble.transform, SkinUi.Type.Display, TextAlignmentOptions.TopLeft);
        }
        public void CloseBubble()
        {
            if (bubble != null) { bubble.SetActive(false); Destroy(bubble); }
            bubble = null;
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
        // The guardian rests on the rim: frames only change its face (drawn over
        // the idle body), so its body and paws never move or change. It blinks every few seconds, cheers for a
        // moment, then returns to its calm face unless the run has ended.
        private void Face(string frame)
        {
            if (guardianFace == frame) return;
            guardianFace = frame;
            var face = art.Face(frame);
            guardianPatch.enabled = face != null;
            if (face == null) return;
            guardianPatch.sprite = face; Size(guardianPatch, art.FaceIn(hud.Guardian));
        }
        // In the last three moves the unearned sockets breathe, 1.2 s a breath,
        // and the ember tablet's glow pulses each second. Reduced motion holds them.
        private void Breathe(float now)
        {
            bool still = owner.ReducedMotion;
            float breath = still ? 1 : 1 - .45f * (.5f - .5f * Mathf.Cos(2 * Mathf.PI * now / 1.2f));
            for (int i = 0; i < 3 && stars[i] != null; i++)
            {
                bool risk = playing && movesLeft > 0 && movesLeft <= 3 && !flying[i] && i >= starsLit;
                stars[i].color = SkinUi.WithAlpha(Color.white, risk ? breath : 1);
            }
            if (movesGlow != null && movesGlow.enabled)
                movesGlow.color = SkinUi.WithAlpha(Color.white, movesLeft <= 3 && !still ? .7f + .3f * Mathf.Sin(2 * Mathf.PI * now) : .85f);
        }
        private void Update()
        {
            ShowAwaiting(Time.unscaledTime); ShowPressure(Time.unscaledTime);
            if (guardianAura != null)
                guardianAura.color = SkinUi.WithAlpha(guardianAura.color, owner.ReducedMotion ? AuraAlpha : AuraAlpha * (.75f + .25f * Mathf.Sin(2 * Mathf.PI * Time.unscaledTime / 3)));
            if (BonusChosen)
            {
                float pulse = owner.ReducedMotion ? .85f : .8f + .2f * Mathf.Sin(2 * Mathf.PI * Time.unscaledTime / 1.2f);
                foreach (var band in targetRows)
                    if (band != null && band.enabled) band.color = SkinUi.WithAlpha(art.Token(SkinTokens.Accent), TargetAlpha * pulse);
            }
            if (owner != null && owner.State != null) Breathe(Time.unscaledTime);
            ShowTimeLeft();
            if (guardian == null) return;
            float now = Time.unscaledTime;
            if (guardianFinal) return;
            if (guardianCheerUntil > 0 && now < guardianCheerUntil) return;
            if (guardianCheerUntil > 0) { guardianCheerUntil = 0; Face(RestFace); nextBlink = now + 3.2f; }
            if (owner.ReducedMotion) { if (guardianFace != RestFace) Face(RestFace); return; }
            if (blinkUntil > 0 && now >= blinkUntil) { blinkUntil = 0; Face(RestFace); nextBlink = now + 3.2f + 1.9f * Mathf.Repeat(now * .618f, 1); }
            else if (blinkUntil == 0 && now >= nextBlink) { Face("blink"); blinkUntil = now + BlinkSeconds; }
            else if (blinkUntil == 0 && guardianFace != RestFace) Face(RestFace);
        }

        private SpriteRenderer NewSprite(string name, Sprite sprite, int order)
        {
            var go = new GameObject(name, typeof(SpriteRenderer)); go.transform.SetParent(boardRoot, false);
            var renderer = go.GetComponent<SpriteRenderer>(); renderer.sprite = sprite; renderer.sortingOrder = order;
            renderer.sharedMaterial = BoardLight.Unlit;
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
        }
    }
}
