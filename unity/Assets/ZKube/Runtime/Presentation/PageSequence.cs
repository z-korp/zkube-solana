using System;
using System.Collections.Generic;
using UnityEngine;

namespace ZKube.Presentation
{
    // A page's timed entrance: each step eases one piece from its start (0) to
    // its end state (1). Adding a step shows its start at once; Finish jumps
    // every step to its end, for a tap that skips the sequence.
    public sealed class PageSequence : MonoBehaviour
    {
        private readonly List<(float start, float seconds, Action<float> apply)> steps = new List<(float, float, Action<float>)>();
        private float began = float.NaN;
        public bool Playing => steps.Count != 0;
        public event Action Finished;

        public void Add(float start, float seconds, Action<float> apply)
        {
            steps.Add((start, Mathf.Max(.001f, seconds), apply));
            apply(0);
            if (float.IsNaN(began)) began = Time.unscaledTime;
        }

        public void Finish()
        {
            if (steps.Count == 0) return;
            foreach (var step in steps) step.apply(1);
            steps.Clear();
            Finished?.Invoke();
        }

        private void Update()
        {
            if (steps.Count == 0) return;
            float now = Time.unscaledTime - began;
            bool done = true;
            foreach (var step in steps)
            {
                float t = Mathf.Clamp01((now - step.start) / step.seconds);
                step.apply(t);
                done &= t >= 1;
            }
            if (done) Finish();
        }

        public static float EaseOut(float t) => 1 - (1 - t) * (1 - t);
        public static float EaseOutBack(float t) { const float c = 1.70158f; float u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
        // Grows past its end and settles: 0.6, then 1.15, then 1.
        public static float Ignite(float t) => t < .6f ? Mathf.Lerp(.6f, 1.15f, EaseOut(t / .6f)) : Mathf.Lerp(1.15f, 1, (t - .6f) / .4f);

        // Scales a piece placed by SkinUi.Place (at placed, from its parent's
        // lower-left corner) about a screen point.
        public static void ScaleAbout(RectTransform piece, Vector2 placed, Vector2 pivot, float scale)
        {
            var corners = new Vector3[4]; ((RectTransform)piece.parent).GetWorldCorners(corners);
            piece.localScale = new Vector3(scale, scale, 1);
            piece.anchoredPosition = scale * placed + (1 - scale) * (pivot - (Vector2)corners[0]);
        }
    }
}
