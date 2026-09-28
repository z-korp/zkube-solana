using System.Collections.Generic;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Board particles. A cleared block breaks: a white flash on the block, chunky
    // shards in its own colour thrown out and spinning under gravity, one soft
    // glow puff and a faint ring. Combos throw bigger, faster pieces and add a
    // burst; a perfect clear is the biggest burst. Sprites come from one fixed
    // pool; a full pool draws fewer pieces instead of allocating. Effects are
    // presentation only and never hold up the trace.
    public sealed class BoardFx : MonoBehaviour
    {
        // Block clears leave the reserve free, so a combo or perfect-clear burst
        // always has sprites even after a full-board clear.
        public const int PoolSize = 240, CelebrationReserve = 48, MaxShards = 10;
        private const int BlockFixedPieces = 3; // flash, glow puff, ring
        private const float ShardGravity = 9;
        private struct Particle
        {
            public SpriteRenderer Renderer;
            public Vector2 Origin, Velocity;
            public float Start, Life, Gravity, SizeFrom, SizeTo, AlphaFrom, AlphaTo, FadeFrom, Spin, Angle, Cell, Stretch;
            public Color Tint;
        }
        private readonly List<SpriteRenderer> pool = new List<SpriteRenderer>();
        private readonly List<Particle> live = new List<Particle>();
        private Transform parent;
        private BoardArt art;
        private int order;

        public int Live => live.Count;
        public int Created => pool.Count;

        public void Initialize(BoardArt source, Transform spriteRoot, int sortingOrder)
        {
            art = source; parent = spriteRoot; order = sortingOrder;
        }

        // How many shards each of this many blocks may throw with the pool that is left.
        public int ShardsPerBlock(int blocks) =>
            blocks <= 0 ? 0 : Mathf.Clamp((PoolSize - CelebrationReserve - live.Count) / blocks - BlockFixedPieces, 0, 8);

        // One block breaking. width is the block's width in cells and cell the cell
        // height in pixels; strength grows the pieces for later clears in a combo.
        // seed (the block's board cell) turns its fan so a row does not repeat.
        public void BlockClear(Vector2 center, int width, float cell, Color tint, int shards, float strength, int seed)
        {
            int budget = PoolSize - CelebrationReserve - live.Count;
            if (budget < BlockFixedPieces) return;
            float now = Time.unscaledTime;
            Spawn(SkinSlots.FxGlow, center, Vector2.zero, 0, cell, Color.white, now, .12f, 1.25f, 1.45f, .95f, 0, 0, 0, 0, width * .8f);
            Spawn(SkinSlots.FxGlow, center, Vector2.zero, 0, cell, tint, now + .04f, .34f, 1.3f * strength + .3f * width, 2.2f * strength + .3f * width, .55f, 0, 0, 0, 0, 1);
            Spawn(SkinSlots.FxRing, center, Vector2.zero, 0, cell, tint, now + .05f, .3f, .6f, 1.9f * strength, .35f, 0, 0, 0, 0, 1);
            int count = Mathf.Clamp(shards, 0, Mathf.Min(MaxShards, budget - BlockFixedPieces));
            for (int i = 0; i < count; i++)
            {
                // A fixed fan around the block with an upward kick; offsets spread
                // the pieces across the block's width.
                float angle = (i + .5f + Jitter(seed)) * 2 * Mathf.PI / count + Jitter(i + seed) * .5f;
                float speed = (2.2f + 1.2f * Jitter(i + 3 + seed)) * strength;
                var velocity = new Vector2(Mathf.Cos(angle) * speed, Mathf.Sin(angle) * speed + 2.2f * strength);
                var origin = center + Vector2.right * ((Jitter(i + 7 + seed) - .5f) * (width - .4f) * cell);
                float size = (i % 2 == 0 ? .44f : .34f) * Mathf.Sqrt(strength);
                Spawn(SkinSlots.FxShard, origin, velocity, ShardGravity, cell, tint, now + .03f, .75f, size, size * .7f, 1, 0, .55f,
                    (i % 2 == 0 ? 1 : -1) * (420 + 90 * (i % 3)), 37 * i, 1);
            }
        }

        // A completed line: a band of light across the row that swells and fades
        // in 280 ms, before its blocks break. columns is the row's length in cells.
        public void LineSweep(Vector2 center, float cell, int columns, Color tint)
        {
            float now = Time.unscaledTime;
            Spawn(SkinSlots.FxGlow, center, Vector2.zero, 0, cell, tint, now, .28f, 1.1f, 1.6f, .85f, 0, .25f, 0, 0, (columns + .6f) / 1.1f);
        }

        // A block a power removed: its light lets go as one slow soft puff and two
        // motes drifting up, with nothing thrown and nothing burst.
        public void Release(Vector2 center, int width, float cell, Color tint, int seed)
        {
            if (PoolSize - CelebrationReserve - live.Count < 3) return;
            float now = Time.unscaledTime;
            Spawn(SkinSlots.FxGlow, center, Vector2.zero, 0, cell, tint, now, .5f, .9f, 1.35f, .45f, 0, .2f, 0, 0, width * .9f);
            for (int i = 0; i < 2; i++)
            {
                var origin = center + Vector2.right * ((Jitter(seed + 3 * i) - .5f) * (width - .3f) * cell);
                Spawn(SkinSlots.FxSpark, origin, new Vector2((Jitter(seed + i) - .5f) * .3f, .9f + .4f * Jitter(seed + 5 + i)), 0, cell, tint,
                    now + .05f * i, .7f, .22f, .1f, .8f, 0, .3f, 0, 0, 1);
            }
        }

        // A celebration: a large glow and ring with shards and sparks all around, for
        // combos and perfect clears. scale grows the whole burst.
        public void Celebrate(Vector2 center, float cell, Color tint, int pieces, float scale)
        {
            float now = Time.unscaledTime;
            Spawn(SkinSlots.FxGlow, center, Vector2.zero, 0, cell, tint, now, .5f, 2 * scale, 3.2f * scale, .7f, 0, 0, 0, 0, 1);
            Spawn(SkinSlots.FxRing, center, Vector2.zero, 0, cell, tint, now, .55f, .8f, 3.4f * scale, .7f, 0, 0, 0, 0, 1);
            for (int i = 0; i < pieces; i++)
            {
                float angle = (i + .5f) * 2 * Mathf.PI / pieces, speed = (2.6f + 1.4f * Jitter(i)) * scale;
                var velocity = new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * speed + Vector2.up * 1.5f * scale;
                bool shard = i % 3 != 2;
                float size = shard ? .46f * Mathf.Sqrt(scale) : .34f * Mathf.Sqrt(scale);
                Spawn(shard ? SkinSlots.FxShard : SkinSlots.FxSpark, center, velocity, ShardGravity * .7f, cell, tint, now, .9f, size, size * .6f,
                    1, 0, .5f, (i % 2 == 0 ? 1 : -1) * 480, 29 * i, 1);
            }
        }

        // A repeatable spread in [0, 1) so every burst of the same size looks the same.
        private static float Jitter(int i) => (i * 37 % 11) / 11f;

        private void Spawn(string slot, Vector2 origin, Vector2 velocity, float gravity, float cell, Color tint, float start, float life,
            float sizeFrom, float sizeTo, float alphaFrom, float alphaTo, float fadeFrom, float spin, float angle, float stretch)
        {
            var renderer = Take();
            if (renderer == null) return;
            renderer.sprite = art.SkinUi(slot); renderer.color = Color.clear;
            live.Add(new Particle { Renderer = renderer, Origin = origin, Velocity = velocity, Gravity = gravity, Start = start, Life = life,
                SizeFrom = sizeFrom, SizeTo = sizeTo, AlphaFrom = alphaFrom, AlphaTo = alphaTo, FadeFrom = fadeFrom, Spin = spin, Angle = angle,
                Cell = cell, Tint = tint, Stretch = stretch });
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
                float size = Mathf.Lerp(p.SizeFrom, p.SizeTo, t);
                float alpha = t < p.FadeFrom ? p.AlphaFrom : Mathf.Lerp(p.AlphaFrom, p.AlphaTo, (t - p.FadeFrom) / (1 - p.FadeFrom));
                var position = p.Origin + (p.Velocity * age + .5f * p.Gravity * age * age * Vector2.down) * p.Cell;
                var renderer = p.Renderer;
                float pixels = size * p.Cell / renderer.sprite.bounds.size.x;
                renderer.transform.position = position;
                renderer.transform.localScale = new Vector3(pixels * p.Stretch, pixels, 1);
                renderer.transform.rotation = Quaternion.Euler(0, 0, p.Angle + p.Spin * age);
                var tint = p.Tint; tint.a *= alpha; renderer.color = tint;
            }
        }
    }
}
