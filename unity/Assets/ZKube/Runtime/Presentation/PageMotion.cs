using UnityEngine;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    // A halo that breathes between 70% and 100% of its alpha. Reduced motion
    // holds it at full strength.
    public sealed class Breathe : MonoBehaviour
    {
        public const float PeriodSeconds = 2.4f;
        private Graphic graphic;
        private float alpha;

        public void Bind(Graphic target) { graphic = target; alpha = target.color.a; }

        private void Update()
        {
            if (graphic == null) return;
            float level = AppPreferences.ReducedMotion ? 1 : .85f + .15f * Mathf.Sin(Time.unscaledTime * 2 * Mathf.PI / PeriodSeconds);
            var color = graphic.color; color.a = alpha * level; graphic.color = color;
        }
    }
}
