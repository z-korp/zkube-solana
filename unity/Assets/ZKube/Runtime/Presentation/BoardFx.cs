using System.Collections.Generic;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Board particles, from the skin's effect sprites. A cleared block shatters:
    // its own shape flashes white, then chunks of it in its width colour fly out
    // along its whole length, spinning under gravity, with a few white sparks and
    // one glow puff. A completed line first sweeps with light and releases motes.
    // Combos throw more chunks further and add a restrained burst; a perfect
    // clear bursts over the whole board. Sprites come from one fixed pool; a full
    // pool draws fewer pieces instead of allocating. Effects are presentation
    // only and never hold up the trace.
    public sealed class BoardFx : MonoBehaviour
    {
        // Block clears leave the reserve free, so a burst always has sprites
        // even after a full-board clear.
        public const int PoolSize = 240, CelebrationReserve = 48, MaxChunks = 16;
        // Flash, sparks and puff around each block's chunks.
        private const int BreakFixedPieces = 6;
        public const float FlashSeconds = .06f, ChunkSeconds = .6f;
        private const float Gravity = 9;
        private static readonly string[] Shards = { SkinSlots.FxShard1, SkinSlots.FxShard2, SkinSlots.FxShard3, SkinSlots.FxShard4 };
        private static readonly string[] Sparks = { SkinSlots.FxSpark1, SkinSlots.FxSpark2, SkinSlots.FxSpark3 };
        private struct Particle
        {
            public SpriteRenderer Renderer;
            public Vector2 Origin, Velocity;
            public Vector3 FixedScale;
            public float Start, Life, Gravity, SizeFrom, SizeTo, AlphaFrom, AlphaTo, FadeFrom, Spin, Angle, Cell, StretchFrom, StretchTo;
            public Color Tint;
        }
        private readonly List<SpriteRenderer> pool = new List<SpriteRenderer>();
        private readonly List<Particle> live = new List<Particle>();
        private Transform parent;
        private BoardArt art;
        private int order;
        private Material sprites, flash;

        public int Live => live.Count;
        public int Created => pool.Count;

        public void Initialize(BoardArt source, Transform spriteRoot, int sortingOrder)
        {
            art = source; parent = spriteRoot; order = sortingOrder;
            var shader = Resources.Load<Shader>("ZKube/SpriteFlash");
            if (shader == null) throw new System.InvalidOperationException("The sprite flash shader is missing");
            flash = new Material(shader) { name = "Block flash" };
        }

        // A block's full break: 8 chunks for one cell up to 12 for four, and more
        // for later clears in a combo.
        public static int ChunksFor(int width, float strength) =>
            Mathf.Min(MaxChunks, Mathf.RoundToInt((8 + (width - 1) * 4f / 3) * (1 + .5f * (strength - 1))));
        // How many chunks each of this many blocks may throw with the pool that is left.
        public int ChunksPerBlock(int blocks) =>
            blocks <= 0 ? 0 : Mathf.Clamp((PoolSize - CelebrationReserve - live.Count) / blocks - BreakFixedPieces, 0, MaxChunks);

        // One block breaking. block is its renderer, width its length in cells and
        // cell the cell size in pixels; strength spreads later clears in a combo.
        // seed (the block's board cell) varies its pieces so a row does not repeat.
        public void Break(SpriteRenderer block, int width, float cell, Color tint, int chunks, float strength, int seed)
        {
            int budget = PoolSize - CelebrationReserve - live.Count;
            if (budget < BreakFixedPieces) return;
            float now = Time.unscaledTime;
            Vector2 center = block.transform.position;
            // The block's own silhouette flashes white, then it is gone.
            var shape = Spawn(null, center, Vector2.zero, 0, cell, Color.white, now, FlashSeconds, 1, 1, 1, .2f, .4f, 0, 0, 1, 1, flash);
            if (shape >= 0)
            {
                var p = live[shape]; p.Renderer.sprite = block.sprite; p.FixedScale = block.transform.localScale; live[shape] = p;
            }
            // Pieces stay within about a cell of the block and fade by 600 ms, so a
            // multi-row clear never paints the board in debris; combos reach a little further.
            float start = now + FlashSeconds * .6f, length = width * cell, reach = 1 + .5f * (strength - 1);
            Spawn(SkinSlots.FxGlow, center, Vector2.zero, 0, cell, tint, start, .3f, .9f, 1.3f, .55f, 0, 0, 0, 0, width, width);
            int count = Mathf.Clamp(chunks, 0, Mathf.Min(MaxChunks, budget - BreakFixedPieces));
            for (int i = 0; i < count; i++)
            {
                // Chunks come from the whole block, thrown outward from its centre with
                // an upward kick; the farther they start, the harder they fly sideways.
                float along = (i + .5f + (Jitter(seed + i) - .5f) * .6f) / count - .5f;
                var origin = center + new Vector2(along * (length - .3f * cell), (Jitter(seed + 7 * i) - .5f) * .45f * cell);
                float side = along * 2 + (Jitter(seed + 3 * i) - .5f) * .8f;
                var velocity = new Vector2(side * (.55f + .55f * Jitter(i + seed)), 1.2f + 1f * Jitter(i + 5 + seed)) * reach;
                float size = i % 3 == 0 ? .45f : i % 3 == 1 ? .4f : .35f;
                Spawn(Shards[(i + seed) % Shards.Length], origin, velocity, Gravity, cell, tint, start, ChunkSeconds - FlashSeconds, size, size * .9f,
                    1, 0, .3f, (i % 2 == 0 ? 1 : -1) * (320 + 70 * (i % 4)), 41 * i + 13 * seed, 1, 1);
            }
            int sparks = width >= 3 ? 4 : 3;
            for (int i = 0; i < sparks; i++)
            {
                float angle = (i + .5f) * 2 * Mathf.PI / sparks + Jitter(seed + i) * .8f;
                var velocity = new Vector2(Mathf.Cos(angle), Mathf.Sin(angle) + .6f) * (1.8f + .8f * Jitter(seed + 2 * i)) * reach;
                Spawn(Sparks[(i + seed) % Sparks.Length], center + Vector2.right * (Jitter(seed + 11 * i) - .5f) * length * .6f, velocity, Gravity * .35f,
                    cell, new Color(1, 1, 1, .85f), start, .4f, .2f, .1f, 1, 0, .3f, 0, 0, 1, 1);
            }
        }

        // A completed line: the sweep opens from the row's centre across the row
        // in 180 ms and fades, and a few motes rise from it. columns is the row's
        // length in cells.
        public void LineSweep(Vector2 center, float cell, int columns, Color tint)
        {
            float now = Time.unscaledTime, height = .52f;
            Spawn(SkinSlots.FxSweep, center, Vector2.zero, 0, cell, tint, now, .18f, height, height * 1.1f, .8f, 0, .45f, 0, 0,
                columns * .15f / height, columns / height);
            for (int i = 0; i < 6; i++)
            {
                var origin = center + Vector2.right * ((i + .5f) / 6 - .5f) * columns * cell;
                Spawn(SkinSlots.FxMote, origin, new Vector2((Jitter(i) - .5f) * .3f, 1.4f + .6f * Jitter(i + 4)), 0, cell, tint, now + .04f * i, .6f,
                    .09f, .06f, .75f, 0, .35f, 0, 0, 1, 1);
            }
        }

        // A block a power removed: its light lets go as one slow soft puff and two
        // motes drifting up, with nothing thrown and nothing burst.
        public void Release(Vector2 center, int width, float cell, Color tint, int seed)
        {
            if (PoolSize - CelebrationReserve - live.Count < 3) return;
            float now = Time.unscaledTime;
            Spawn(SkinSlots.FxGlow, center, Vector2.zero, 0, cell, tint, now, .5f, .9f, 1.35f, .45f, 0, .2f, 0, 0, width * .9f, width * .9f);
            for (int i = 0; i < 2; i++)
            {
                var origin = center + Vector2.right * ((Jitter(seed + 3 * i) - .5f) * (width - .3f) * cell);
                Spawn(SkinSlots.FxMote, origin, new Vector2((Jitter(seed + i) - .5f) * .3f, .9f + .4f * Jitter(seed + 5 + i)), 0, cell, tint,
                    now + .05f * i, .7f, .12f, .08f, .8f, 0, .3f, 0, 0, 1, 1);
            }
        }

        // A restrained burst and one soft ring, sized in cells: a combo over its
        // clear, a perfect clear over the whole board. No camera shake.
        public void Burst(Vector2 center, float cell, Color tint, float cells)
        {
            float now = Time.unscaledTime;
            Spawn(SkinSlots.FxBurst, center, Vector2.zero, 0, cell, tint, now, .5f, cells * .6f, cells * 1.1f, .42f, 0, .3f, 0, 0, 1, 1);
            Spawn(SkinSlots.FxRingSoft, center, Vector2.zero, 0, cell, tint, now, .5f, cells * .4f, cells * 1.2f, .55f, 0, .2f, 0, 0, 1, 1);
        }

        // One low pulse behind the guardian, sized in cells: its celebration halo
        // or, on defeat, a dim ripple that fades without a flash.
        public void Behind(string slot, Vector2 center, float cell, Color tint, float cells, float life, float alpha)
        {
            Spawn(slot, center, Vector2.zero, 0, cell, tint, Time.unscaledTime, life, cells * .8f, cells * 1.1f, alpha, 0, .35f, 0, 0, 1, 1, null, -17);
        }

        // A repeatable spread in [0, 1) so every burst of the same size looks the same.
        private static float Jitter(int i) => ((i * 37 % 11) + 11) % 11 / 11f;

        private int Spawn(string slot, Vector2 origin, Vector2 velocity, float gravity, float cell, Color tint, float start, float life,
            float sizeFrom, float sizeTo, float alphaFrom, float alphaTo, float fadeFrom, float spin, float angle, float stretchFrom, float stretchTo,
            Material material = null, int? sortingOrder = null)
        {
            var renderer = Take();
            if (renderer == null) return -1;
            if (sprites == null) sprites = renderer.sharedMaterial;
            renderer.sharedMaterial = material != null ? material : sprites;
            renderer.sortingOrder = sortingOrder ?? order;
            if (slot != null) renderer.sprite = art.SkinUi(slot);
            renderer.color = Color.clear;
            live.Add(new Particle { Renderer = renderer, Origin = origin, Velocity = velocity, Gravity = gravity, Start = start, Life = life,
                SizeFrom = sizeFrom, SizeTo = sizeTo, AlphaFrom = alphaFrom, AlphaTo = alphaTo, FadeFrom = fadeFrom, Spin = spin, Angle = angle,
                Cell = cell, Tint = tint, StretchFrom = stretchFrom, StretchTo = stretchTo });
            return live.Count - 1;
        }
        private SpriteRenderer Take()
        {
            foreach (var renderer in pool) if (!renderer.gameObject.activeSelf) { renderer.gameObject.SetActive(true); return renderer; }
            if (pool.Count >= PoolSize) return null;
            var go = new GameObject("Board effect", typeof(SpriteRenderer)); go.transform.SetParent(parent, false);
            var created = go.GetComponent<SpriteRenderer>(); created.sortingOrder = order;
            pool.Add(created);
            return created;
        }

        private void Update()
        {
            float now = Time.unscaledTime;
            for (int i = live.Count - 1; i >= 0; i--)
            {
                var p = live[i];
                float age = now - p.Start;
                if (age >= p.Life) { p.Renderer.gameObject.SetActive(false); live.RemoveAt(i); continue; }
                if (age < 0) continue;
                float t = age / p.Life;
                float alpha = t < p.FadeFrom ? p.AlphaFrom : Mathf.Lerp(p.AlphaFrom, p.AlphaTo, (t - p.FadeFrom) / (1 - p.FadeFrom));
                var renderer = p.Renderer;
                renderer.transform.position = p.Origin + (p.Velocity * age + .5f * p.Gravity * age * age * Vector2.down) * p.Cell;
                if (p.FixedScale != Vector3.zero) renderer.transform.localScale = p.FixedScale;
                else
                {
                    float pixels = Mathf.Lerp(p.SizeFrom, p.SizeTo, t) * p.Cell / renderer.sprite.bounds.size.y;
                    // Sprites are drawn at their own aspect, stretched along x.
                    float aspect = renderer.sprite.bounds.size.x / renderer.sprite.bounds.size.y;
                    renderer.transform.localScale = new Vector3(pixels * Mathf.Lerp(p.StretchFrom, p.StretchTo, t) / aspect, pixels, 1);
                }
                renderer.transform.rotation = Quaternion.Euler(0, 0, p.Angle + p.Spin * age);
                var tint = p.Tint; tint.a *= alpha; renderer.color = tint;
            }
        }
        private void OnDestroy() { if (flash != null) Destroy(flash); }
    }
}
