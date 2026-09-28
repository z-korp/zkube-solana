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
        private Rect track;
        private RectTransform knob;
        private Image on;
        private Action<bool> changed;
        public bool Value { get; private set; }

        internal void Bind(Rect trackRect, Image onFill, RectTransform knobRect, bool value, Action<bool> onChanged)
        {
            track = trackRect; on = onFill; knob = knobRect; changed = onChanged;
            Show(value);
        }

        public void SetWithoutNotify(bool value) => Show(value);

        public void OnPointerClick(PointerEventData eventData)
        {
            Show(!Value); changed?.Invoke(Value);
        }

        private void Show(bool value)
        {
            Value = value; on.enabled = value;
            var size = knob.sizeDelta;
            float x = value ? track.xMax - track.height / 2 : track.x + track.height / 2;
            SkinUi.Place(knob, new Rect(x - size.x / 2, track.center.y - size.y / 2, size.x, size.y), knob.parent);
        }
    }

    // Kit buttons squash to 92% while pressed and spring back with a little
    // overshoot on release, about their centre. Reduced motion keeps them still.
    public sealed class PressSquash : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IPointerExitHandler
    {
        private const float Pressed = .92f, Stiffness = 900, Damping = 28;
        private RectTransform rect;
        private Vector2 origin;
        private float size = 1, speed, target = 1;
        private bool moving;
        public float Size => size;

        public void OnPointerDown(PointerEventData eventData)
        {
            var selectable = GetComponent<Selectable>();
            if (AppPreferences.ReducedMotion || selectable != null && !selectable.IsInteractable()) return;
            if (!moving) { rect = (RectTransform)transform; origin = rect.anchoredPosition; moving = true; }
            target = Pressed;
        }
        public void OnPointerUp(PointerEventData eventData) => target = 1;
        public void OnPointerExit(PointerEventData eventData) => target = 1;

        private void Update()
        {
            if (!moving) return;
            float dt = Mathf.Min(Time.unscaledDeltaTime, 1 / 30f);
            speed += (Stiffness * (target - size) - Damping * speed) * dt;
            size += speed * dt;
            if (target == 1 && Mathf.Abs(size - 1) < .001f && Mathf.Abs(speed) < .01f) { size = 1; speed = 0; moving = false; }
            rect.localScale = new Vector3(size, size, 1);
            rect.anchoredPosition = origin - rect.rect.size * (size - 1) / 2;
        }
    }

    // The tab bar built by SkinUi.TabBar; the selected plate sits behind one tab.
    public sealed class SkinTabBar : MonoBehaviour
    {
        private Rect[] tabs;
        private RectTransform selected;
        public int Selected { get; private set; }

        internal void Bind(Rect[] tabRects, RectTransform plate, int index)
        {
            tabs = tabRects; selected = plate;
            Select(index);
        }

        // Moves the highlight; the page decides what a tab shows.
        public void Select(int index)
        {
            if (index < 0 || index >= tabs.Length) throw new ArgumentOutOfRangeException(nameof(index));
            Selected = index;
            SkinUi.Place(selected, tabs[index], selected.parent);
        }
    }
}
