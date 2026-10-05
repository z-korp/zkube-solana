using TMPro;
using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    // A horizontal slider built by SkinUi.Slider. Its whole rect takes touches:
    // a press or a drag sets the value from the pointer's position on the track.
    public sealed class SkinSlider : MonoBehaviour, IPointerDownHandler, IDragHandler
    {
        private Rect track;
        private RectTransform fill, knob;
        private Action<float> changed;
        public float Value { get; private set; }

        internal void Bind(Rect trackRect, RectTransform fillClip, RectTransform knobRect, float value, Action<float> onChanged)
        {
            track = trackRect; fill = fillClip; knob = knobRect; changed = onChanged;
            Show(Checked(value));
        }

        // Sets the value without reporting it, for a value that changed elsewhere.
        public void SetWithoutNotify(float value) => Show(Checked(value));

        public void OnPointerDown(PointerEventData eventData) => Point(eventData.position);
        public void OnDrag(PointerEventData eventData) => Point(eventData.position);

        private void Point(Vector2 screen)
        {
            float value = Mathf.Clamp01((screen.x - track.x) / track.width);
            if (value == Value) return;
            Show(value); changed?.Invoke(value);
        }
        private static float Checked(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) throw new ArgumentOutOfRangeException(nameof(value));
            return Mathf.Clamp01(value);
        }
        private void Show(float value)
        {
            Value = value;
            float x = track.x + track.width * value;
            SkinUi.Place(fill, new Rect(track.x, track.y, x - track.x, track.height), fill.parent);
            var size = knob.sizeDelta;
            SkinUi.Place(knob, new Rect(x - size.x / 2, track.center.y - size.y / 2, size.x, size.y), knob.parent);
        }
    }

    // An on/off switch built by SkinUi.Toggle; a tap flips it.
    public sealed class SkinToggle : MonoBehaviour, IPointerClickHandler
    {
        // On is the sound sliders' gold fill under the knob in its own light
        // (DECISIONS 2026-10-02), off a dim knob on the dark track.
        public static readonly Color OnKnob = Color.white, OffKnob = new Color(143 / 255f, 166 / 255f, 178 / 255f, 1);
        private Rect track;
        private Image knob, on;
        private Action<bool> changed;
        public bool Value { get; private set; }

        internal void Bind(Rect trackRect, Image onFill, Image knobImage, bool value, Action<bool> onChanged)
        {
            track = trackRect; on = onFill; knob = knobImage; changed = onChanged;
            Show(value);
        }

        public void SetWithoutNotify(bool value) => Show(value);

        public void OnPointerClick(PointerEventData eventData)
        {
            Show(!Value); changed?.Invoke(Value);
        }

        private void Show(bool value)
        {
            Value = value; on.enabled = value; knob.color = value ? OnKnob : OffKnob;
            var rect = knob.rectTransform; var size = rect.sizeDelta;
            float x = value ? track.xMax - track.height / 2 : track.x + track.height / 2;
            SkinUi.Place(rect, new Rect(x - size.x / 2, track.center.y - size.y / 2, size.x, size.y), rect.parent);
        }
    }

    // Kit buttons squash to 92% while pressed and spring back with a little
    // overshoot on release, about their centre. Reduced motion keeps them still.
    // A press, per the motion spec: the face sinks to 97% over 60 ms as the
    // pressed art swaps in; on release it rises through a 103% overshoot back to
    // rest over 120 ms, and a glint of warm light flashes at the touch point
    // (0, 50%, 0 over 180 ms). Reduced motion keeps the pressed art and the glint,
    // without scaling. The action itself starts on release, as buttons do.
    // The loader on a button whose action is in progress: its mark turns for as
    // long as it shows. Reduced motion shows a still mark instead and no Turn.
    public sealed class Turn : MonoBehaviour
    {
        public const float DegreesPerSecond = 300;
        private void Awake()
        {
            // It turns about its middle, where it was placed.
            var rect = (RectTransform)transform; var shift = Vector2.Scale(new Vector2(.5f, .5f) - rect.pivot, rect.rect.size);
            rect.pivot = new Vector2(.5f, .5f); rect.anchoredPosition += shift;
        }
        private void Update() => transform.localEulerAngles = new Vector3(0, 0, -Mathf.Repeat(Time.unscaledTime * DegreesPerSecond, 360));
    }

    // A figure that just grew counts up to its new value, over CountSeconds.
    public sealed class CountUp : MonoBehaviour
    {
        public const float CountSeconds = .7f;
        private TMPro.TMP_Text label; private ulong from, to; private float started;
        public void Begin(TMPro.TMP_Text text, ulong was, ulong now)
        { label = text; from = was; to = now; started = Time.unscaledTime; label.text = was.ToString(System.Globalization.CultureInfo.InvariantCulture); }
        private void Update()
        {
            float t = Mathf.Clamp01((Time.unscaledTime - started) / CountSeconds);
            label.text = ((ulong)System.Math.Round(from + (to - from) * (double)Mathf.SmoothStep(0, 1, t))).ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (t >= 1) Destroy(this);
        }
    }
    // A coin flies from where it was earned to where it is kept, then is gone.
    public sealed class Flight : MonoBehaviour
    {
        public const float FlightSeconds = .55f;
        private Vector2 from, to; private float starts;
        public void Begin(Vector2 start, Vector2 end, float delay)
        { from = start; to = end; starts = Time.unscaledTime + delay; GetComponent<Graphic>().enabled = false; }
        private void Update()
        {
            float t = (Time.unscaledTime - starts) / FlightSeconds;
            if (t < 0) return;
            GetComponent<Graphic>().enabled = true;
            if (t >= 1) { Destroy(gameObject); return; }
            float eased = Mathf.SmoothStep(0, 1, t);
            // An arc: it rises a little as it goes.
            ((RectTransform)transform).anchoredPosition = Vector2.Lerp(from, to, eased) + new Vector2(0, Mathf.Sin(Mathf.PI * eased) * 24);
        }
    }

    public sealed class PressSquash : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IPointerExitHandler
    {
        public const float Pressed = .97f, Overshoot = 1.03f, PressSeconds = .06f, ReleaseSeconds = .12f, GlintSeconds = .18f, GlintDp = 40;
        private RectTransform rect;
        private Vector2 origin;
        private float size = 1, from = 1, started;
        private bool down, moving;
        private Sprite glint;
        private float density = 1;
        public float Size => size;
        public int Glints { get; private set; }

        internal void Bind(Sprite glintSprite, float screenDensity) { glint = glintSprite; density = screenDensity; }

        public void OnPointerDown(PointerEventData eventData)
        {
            var selectable = GetComponent<Selectable>();
            if (selectable != null && !selectable.IsInteractable()) return;
            down = true;
            if (AppPreferences.ReducedMotion) return;
            if (!moving) { rect = (RectTransform)transform; origin = rect.anchoredPosition; moving = true; }
            from = size; started = Time.unscaledTime;
        }
        public void OnPointerUp(PointerEventData eventData)
        {
            if (!down) return;
            down = false;
            if (glint != null && eventData != null) Glint(eventData.position);
            if (!moving) return;
            from = size; started = Time.unscaledTime;
        }
        public void OnPointerExit(PointerEventData eventData)
        {
            if (!down) return;
            down = false;
            if (!moving) return;
            from = size; started = Time.unscaledTime;
        }

        private void Update()
        {
            if (!moving) return;
            float t = Time.unscaledTime - started;
            if (down) size = Mathf.Lerp(from, Pressed, 1 - Mathf.Pow(1 - Mathf.Clamp01(t / PressSeconds), 2));
            else
            {
                float k = Mathf.Clamp01(t / ReleaseSeconds);
                size = k < .6f ? Mathf.Lerp(from, Overshoot, k / .6f) : Mathf.Lerp(Overshoot, 1, (k - .6f) / .4f);
                if (k >= 1) { size = 1; moving = false; }
            }
            rect.localScale = new Vector3(size, size, 1);
            rect.anchoredPosition = origin - rect.rect.size * (size - 1) / 2;
        }

        private void Glint(Vector2 at)
        {
            float extent = GlintDp * density;
            var image = new GameObject("Press glint", typeof(RectTransform), typeof(Image)).GetComponent<Image>();
            image.transform.SetParent(transform, false);
            SkinUi.Place(image.rectTransform, new Rect(at.x - extent / 2, at.y - extent / 2, extent, extent), transform);
            image.sprite = glint; image.raycastTarget = false; image.color = new Color(1, .965f, .855f, 0);
            Glints++;
            StartCoroutine(Flash(image));
        }
        private static System.Collections.IEnumerator Flash(Image image)
        {
            for (float t = 0; t < GlintSeconds && image != null; t += Time.unscaledDeltaTime)
            {
                var c = image.color; c.a = .5f * Mathf.Sin(Mathf.PI * t / GlintSeconds); image.color = c;
                yield return null;
            }
            if (image != null) Destroy(image.gameObject);
        }
    }

    // The tab bar built by SkinUi.TabBar; the selected plate sits behind one tab.
    public sealed class SkinTabBar : MonoBehaviour
    {
        private Rect[] tabs;
        private RectTransform selected;
        public int Selected { get; private set; }

        private Image[] icons;
        private TMP_Text[] labels;
        private Color onChip, off;

        internal void Bind(Rect[] tabRects, RectTransform plate, int index, Image[] tabIcons, TMP_Text[] tabLabels, Color selectedInk, Color ink)
        {
            tabs = tabRects; selected = plate; icons = tabIcons; labels = tabLabels; onChip = selectedInk; off = ink;
            Select(index);
        }

        // Moves the gold chip: the selected tab's icon and label turn dark on it,
        // the others stay pale at 72%. The page decides what a tab shows.
        public void Select(int index)
        {
            if (index < 0 || index >= tabs.Length) throw new ArgumentOutOfRangeException(nameof(index));
            Selected = index;
            SkinUi.Place(selected, tabs[index], selected.parent);
            for (int i = 0; i < tabs.Length; i++)
            {
                var ink = i == index ? onChip : new Color(off.r, off.g, off.b, off.a * .72f);
                icons[i].color = ink; labels[i].color = ink;
            }
        }
        public Color Ink(int index) => labels[index].color;
    }

    // A code-placed light: an fx-glow behind something live or earned. A
    // breathing glow swings between 70% and 100% of its strength; reduced
    // motion holds it still. SkinUi caps how many are live at once.
    public sealed class SkinGlow : MonoBehaviour
    {
        private Image image;
        private Color tint;
        private float period;
        internal System.Collections.Generic.List<SkinGlow> Registry;
        public bool Breathing => period > 0;
        internal void Bind(Image glow, Color color, float breathSeconds) { image = glow; tint = color; period = breathSeconds; Show(); }
        private void Update() { if (Breathing) Show(); }
        private void Show()
        {
            float k = !Breathing || AppPreferences.ReducedMotion ? 1 : .85f + .15f * Mathf.Sin(Time.unscaledTime * 2 * Mathf.PI / period);
            var c = tint; c.a *= k; image.color = c;
        }
        private void OnDestroy() => Registry?.Remove(this);
    }

    // A piece that pulses about its centre, between its full size and Low of
    // it, once every Seconds; reduced motion holds it at its full size, where
    // its light alone marks it.
    public sealed class SkinPulse : MonoBehaviour
    {
        public const float Low = .9f, Seconds = 1.4f;
        private RectTransform rect;
        public float Scale { get; private set; } = 1;
        private void Awake()
        {
            rect = (RectTransform)transform;
            // About its centre: the kit places pieces from their lower-left corner.
            var size = rect.rect.size; var pivot = rect.pivot;
            rect.pivot = new Vector2(.5f, .5f); rect.anchoredPosition += Vector2.Scale(new Vector2(.5f, .5f) - pivot, size);
        }
        private void Update()
        {
            Scale = AppPreferences.ReducedMotion ? 1 : Mathf.Lerp(1, Low, .5f - .5f * Mathf.Cos(Time.unscaledTime * 2 * Mathf.PI / Seconds));
            rect.localScale = new Vector3(Scale, Scale, 1);
        }
    }

    // A tablet built by SkinUi.Tablet. A charged power glows in the realm's key
    // light, breathing over 3 s, with a lit gold badge; an empty one keeps its
    // place unlit, its icon at 40% and a dimmed badge showing 0. Nothing is ever
    // greyed out: only the button stops taking taps.
    public sealed class SkinTablet : MonoBehaviour
    {
        public Button Button { get; private set; }
        public Image Icon { get; private set; }
        public TMP_Text Count { get; private set; }
        private Image halo, badgeHalo, badge;
        private Color onBadge, onDim;
        public bool Charged { get; private set; }
        public const float BreathSeconds = 3;

        internal void Bind(Button button, Image icon, Image light, Image badgeLight, Image badgePiece, TMP_Text count, Color badgeText, Color text)
        {
            Button = button; Icon = icon; halo = light; badgeHalo = badgeLight; badge = badgePiece; Count = count;
            onBadge = badgeText; onDim = text;
            Show(halo == null ? (int?)null : 0, true);
        }

        private Sprite chargedIcon, emptyIcon;
        // A tablet with its own empty art shows it at zero charges instead of dimming.
        public void Icons(Sprite charged, Sprite empty) { chargedIcon = charged; emptyIcon = empty; }
        // charges is null for an uncounted utility; interactive says whether a tap acts now.
        public void Show(int? charges, bool interactive)
        {
            Charged = charges > 0;
            Button.interactable = interactive && charges != 0;
            if (emptyIcon != null) Icon.sprite = charges == 0 ? emptyIcon : chargedIcon;
            var icon = Icon.color; icon.a = charges == 0 && emptyIcon == null ? .4f : 1; Icon.color = icon;
            if (halo != null) halo.enabled = Charged;
            if (badgeHalo != null) badgeHalo.enabled = Charged;
            if (badge != null) badge.color = Charged ? Color.white : new Color(64 / 255f, 84 / 255f, 96 / 255f);
            if (Count != null) { Count.text = (charges ?? 0).ToString(); Count.color = Charged ? onBadge : onDim; }
        }
    }

    // Holding a press opens what a tap would, after HoldSeconds.
    public sealed class LongPress : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IPointerExitHandler
    {
        public const float HoldSeconds = .45f;
        private Action held;
        private float since = -1;
        internal void Bind(Action action) => held = action;
        public void OnPointerDown(PointerEventData eventData) => since = Time.unscaledTime;
        public void OnPointerUp(PointerEventData eventData) => since = -1;
        public void OnPointerExit(PointerEventData eventData) => since = -1;
        private void Update()
        {
            if (since < 0 || Time.unscaledTime - since < HoldSeconds) return;
            since = -1; held?.Invoke();
        }
    }

    // A transparent surface that takes the next touch anywhere and reports it.
    public sealed class TouchAnywhere : MonoBehaviour, IPointerDownHandler
    {
        public Action Touched;
        public void OnPointerDown(PointerEventData eventData) => Touched?.Invoke();
    }
}
