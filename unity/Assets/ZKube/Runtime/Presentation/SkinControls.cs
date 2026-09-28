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
