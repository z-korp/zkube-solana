using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The board's light: quarter-resolution bloom that only rims, glyphs, glows
    // and effects cross; the realm's key light, from its painting's light source,
    // on the painting and the guardian only (blocks, cells, frame and effects use
    // the unlit sprite material); the realm's motes drifting slowly outside the
    // board, behind the well; its light shafts; and a slow breath in the board's
    // backlight. Reduced motion keeps the light and drops the motes and breaths.
    public sealed class BoardLight : MonoBehaviour
    {
        public const float BloomThreshold = .9f, BloomIntensity = .5f, BloomScatter = .6f, KeyIntensity = .2f;
        public const int MoteCount = 18;
        private static Material unlit;
        // The 2D renderer's lit sprite material, for the painting and the guardian.
        // A copy lives in Resources so player builds keep its shader.
        private static Material lit;
        public static Material Lit => lit != null ? lit : lit = Resources.Load<Material>("ZKube/SpriteLit")
            ?? throw new System.InvalidOperationException("The lit sprite material is missing");
        // Sprites untouched by the 2D lights.
        public static Material Unlit => unlit != null ? unlit : unlit = new Material(Resources.Load<Shader>("ZKube/SpriteUnlit")
            ?? throw new System.InvalidOperationException("The unlit sprite shader is missing")) { name = "Unlit sprite" };

        // One global light gives lit sprites their painted brightness; boards share it.
        private static Light2D ambient;
        private static int users;
        private struct Mote { public SpriteRenderer Renderer; public Vector2 Base; public float Speed, Phase, Sway; }
        private readonly List<Mote> motes = new List<Mote>();
        private readonly List<SpriteRenderer> shafts = new List<SpriteRenderer>();
        private VolumeProfile profile;
        private SpriteRenderer backlight;
        private Rect avoid, screen;
        private float density, backlightAlpha;
        private int drift;
        private bool sharing;
        public Light2D Key { get; private set; }
        public Bloom Bloom { get; private set; }
        public int Motes => motes.Count;
        public int Shafts => shafts.Count;
        public IEnumerable<SpriteRenderer> MoteRenderers { get { foreach (var mote in motes) yield return mote.Renderer; } }

        public void Initialize(BoardArt art, Camera camera, Bounds painting, BoardLayout layout, Transform root, SpriteRenderer boardBacklight)
        {
            density = layout.Density; screen = new Rect(0, 0, Screen.width, Screen.height);
            camera.GetUniversalAdditionalCameraData().renderPostProcessing = true;
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            Bloom = profile.Add<Bloom>(true);
            Bloom.threshold.Override(BloomThreshold); Bloom.intensity.Override(BloomIntensity); Bloom.scatter.Override(BloomScatter);
            Bloom.highQualityFiltering.Override(false); Bloom.downscale.Override(BloomDownscaleMode.Quarter); Bloom.maxIterations.Override(4);
            var volume = gameObject.AddComponent<Volume>(); volume.isGlobal = true; volume.sharedProfile = profile;

            sharing = true;
            if (users++ == 0)
            {
                ambient = new GameObject("Board ambient light").AddComponent<Light2D>();
                ambient.lightType = Light2D.LightType.Global; ambient.color = Color.white; ambient.intensity = 1;
            }
            var light = art.Light; var key = art.Token(SkinTokens.LightKey);
            var source = new Vector2(painting.min.x + light.source[0] * painting.size.x, painting.max.y - light.source[1] * painting.size.y);
            Key = new GameObject("Realm key light").AddComponent<Light2D>();
            Key.transform.SetParent(root, false); Key.transform.position = source;
            Key.lightType = Light2D.LightType.Point; Key.color = key; Key.intensity = KeyIntensity;
            Key.pointLightInnerRadius = 0; Key.pointLightOuterRadius = screen.height * .55f; Key.falloffIntensity = .6f;

            backlight = boardBacklight; backlightAlpha = backlight.color.a;
            if (AppPreferences.ReducedMotion) return;
            // Shafts fall from the light source toward the board, 96 x 384 dp as drawn.
            var toward = ((Vector2)layout.Rim.center - source).normalized;
            for (int i = 0; i < light.shafts; i++)
            {
                var shaft = Sprite("Realm light shaft", art.SkinUi(SkinSlots.FxShaft), -19, root);
                float turn = light.shafts == 1 ? 0 : (i == 0 ? -8 : 8);
                var direction = Quaternion.Euler(0, 0, turn) * toward;
                Size(shaft, 96 * density, 384 * density);
                shaft.transform.position = source + (Vector2)direction * 192 * density;
                shaft.transform.rotation = Quaternion.FromToRotation(Vector3.down, direction);
                shaft.color = SkinUi.WithAlpha(key, .11f);
                shafts.Add(shaft);
            }
            // Motes drift outside the board: above its rim and around the tray and footer.
            avoid = new Rect(layout.Rim.x - 8 * density, layout.Rim.y - 8 * density, layout.Rim.width + 16 * density, layout.Rim.height + 16 * density);
            drift = light.moteDrift;
            var sprite = art.SkinRealm(SkinSlots.Mote);
            var random = new System.Random(art.RealmId * 7919);
            for (int i = 0; i < MoteCount; i++)
            {
                var mote = Sprite("Realm mote", sprite, -18, root);
                float size = light.moteDp * density * (.75f + .5f * (float)random.NextDouble());
                Size(mote, size, size);
                motes.Add(new Mote
                {
                    Renderer = mote, Base = new Vector2((float)random.NextDouble() * screen.width, (float)random.NextDouble() * screen.height),
                    Speed = (8 + 10 * (float)random.NextDouble()) * density, Phase = (float)random.NextDouble() * 6.283f,
                    Sway = (6 + 8 * (float)random.NextDouble()) * density,
                });
            }
            Update();
        }

        // Every board sprite is made here, unlit unless given the lit material. The material
        // goes on before the sprite: under the SRP Batcher a renderer handed a shared material
        // after its sprite draws with the texture of whichever sprite was drawn before it.
        internal static SpriteRenderer Sprite(string name, Sprite sprite, int order, Transform root, Material material = null)
        {
            var renderer = new GameObject(name, typeof(SpriteRenderer)).GetComponent<SpriteRenderer>();
            renderer.transform.SetParent(root, false); renderer.sharedMaterial = material != null ? material : Unlit;
            renderer.sprite = sprite; renderer.sortingOrder = order;
            return renderer;
        }
        private static void Size(SpriteRenderer renderer, float width, float height)
        {
            var bounds = renderer.sprite.bounds.size;
            renderer.transform.localScale = new Vector3(width / bounds.x, height / bounds.y, 1);
        }

        private void Update()
        {
            if (AppPreferences.ReducedMotion) { backlight.color = SkinUi.WithAlpha(backlight.color, backlightAlpha); return; }
            float now = Time.unscaledTime;
            // The realm's glow breathes over 8 s; each shaft over its own 9-11 s.
            backlight.color = SkinUi.WithAlpha(backlight.color, backlightAlpha * (.9f + .1f * Mathf.Sin(now * 2 * Mathf.PI / 8)));
            for (int i = 0; i < shafts.Count; i++)
                shafts[i].color = SkinUi.WithAlpha(shafts[i].color, .11f + .05f * Mathf.Sin(now * 2 * Mathf.PI / (9 + 2 * i) + i));
            foreach (var mote in motes)
            {
                float y = Mathf.Repeat(mote.Base.y + drift * mote.Speed * now, screen.height + 40 * density) - 20 * density;
                var at = new Vector2(mote.Base.x + mote.Sway * Mathf.Sin(now * .7f + mote.Phase), y);
                mote.Renderer.transform.position = at;
                // A mote fades out near the board, so none drifts across it.
                float gap = Mathf.Max(avoid.xMin - at.x, at.x - avoid.xMax, avoid.yMin - at.y, at.y - avoid.yMax);
                mote.Renderer.color = new Color(1, 1, 1, .55f * Mathf.Clamp01(gap / (24 * density)));
            }
        }

        private void OnDestroy()
        {
            if (profile != null) Destroy(profile);
            if (sharing && --users == 0 && ambient != null) Destroy(ambient.gameObject);
        }
    }
}
