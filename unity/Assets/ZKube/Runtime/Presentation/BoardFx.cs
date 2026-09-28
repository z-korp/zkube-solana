using System.Collections.Generic;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Board particles from the Jelly block-clear art target: per cleared block, a
    // glow, a ring and twelve shards and sparks thrown out under light gravity.
    // Sprites come from one fixed pool; when it is full a burst draws fewer
    // particles instead of allocating. Effects are presentation only and never
    // hold up the trace.
    public sealed class BoardFx : MonoBehaviour
    {
        // Block clears leave the reserve free, so a combo or perfect-clear burst
        // always has sprites even after a full-board clear.
        public const int PoolSize = 240, CelebrationReserve = 48;
        private const float BurstDelay = .06f, ParticleLife = .52f, RingLife = .36f, GlowLife = .22f, Gravity = 3;
        private const int Directions = 12;
        private enum Kind { Shard, Spark, Ring, Glow }
        private struct Particle
        {
            public SpriteRenderer Renderer;
            public Kind Kind;
            public Vector2 Origin, Velocity;
            public float Start, Life, Size, Spin, Angle, Cell, Scale;
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

        // The block-clear burst centred on one cleared block; cell is its height in pixels.
        public void BlockClear(Vector2 center, float cell, Color tint, int particles)
        {
            int budget = PoolSize - CelebrationReserve - live.Count;
            if (budget < 2) return;
            float start = Time.unscaledTime + BurstDelay;
            Spawn(Kind.Glow, center, Vector2.zero, cell, tint, start, GlowLife, 2.4f, 0, 0, 1);
            Spawn(Kind.Ring, center, Vector2.zero, cell, tint, start, RingLife, .8f, 0, 0, 1);
            int count = Mathf.Clamp(particles, 0, Mathf.Min(Directions, budget - 2));
            for (int n = 0; n < count; n++)
            {
                // Twelve directions 30 degrees apart, starting 8.6 degrees above the
                // horizontal, at three alternating speeds; shards and sparks alternate.
                int i = n * Directions / Mathf.Max(1, count);
                float angle = (8.6f + 30 * i) * Mathf.Deg2Rad, speed = i % 3 == 0 ? 1.5f : i % 3 == 1 ? 1.85f : 2.2f;
                bool shard = i % 2 == 0;
                Spawn(shard ? Kind.Shard : Kind.Spark, center, new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * speed, cell, tint, start, ParticleLife,
                    shard ? .2f : .27f, shard ? -240 : 240, 31 * i, 1);
            }
        }

        // A celebration burst: a large ring and glow with sparks all around, for
        // combos and perfect clears. scale grows the whole burst.
        public void Celebrate(Vector2 center, float cell, Color tint, int sparks, float scale)
        {
            float start = Time.unscaledTime;
            Spawn(Kind.Glow, center, Vector2.zero, cell, tint, start, GlowLife * 2, 2.4f, 0, 0, scale);
            Spawn(Kind.Ring, center, Vector2.zero, cell, tint, start, RingLife * 1.5f, .8f, 0, 0, scale);
            for (int i = 0; i < sparks; i++)
            {
                float angle = (i + .5f) * 2 * Mathf.PI / sparks, speed = (i % 2 == 0 ? 2.4f : 3.2f) * scale;
                Spawn(i % 3 == 0 ? Kind.Shard : Kind.Spark, center, new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * speed, cell, tint, start,
                    ParticleLife * 1.3f, i % 3 == 0 ? .2f : .3f, i % 2 == 0 ? 240 : -240, 29 * i, 1);
            }
        }

        // How many particles each of this many blocks may throw with the pool that is left.
        public int ParticlesPerBlock(int blocks) =>
            blocks <= 0 ? 0 : Mathf.Clamp((PoolSize - CelebrationReserve - live.Count - 2 * blocks) / blocks, 0, Directions);

        private void Spawn(Kind kind, Vector2 origin, Vector2 velocity, float cell, Color tint, float start, float life, float size, float spin, float angle, float scale)
        {
            var renderer = Take();
            if (renderer == null) return;
            renderer.sprite = art.SkinUi(kind == Kind.Shard ? SkinSlots.FxShard : kind == Kind.Spark ? SkinSlots.FxSpark : kind == Kind.Ring ? SkinSlots.FxRing : SkinSlots.FxGlow);
            renderer.color = Color.clear;
            live.Add(new Particle { Renderer = renderer, Kind = kind, Origin = origin, Velocity = velocity, Start = start, Life = life, Size = size,
                Spin = spin, Angle = angle, Cell = cell, Tint = tint, Scale = scale });
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
                float t = age / p.Life, size, alpha;
                var position = p.Origin;
                switch (p.Kind)
                {
                    case Kind.Ring: size = Mathf.Lerp(.8f, 3, t); alpha = Mathf.Lerp(.75f, 0, t); break;
                    case Kind.Glow: size = p.Size; alpha = Mathf.Lerp(.6f, 0, t); break;
                    default:
                        size = p.Size * Mathf.Lerp(1, .35f, t);
                        alpha = t < .35f ? 1 : Mathf.InverseLerp(1, .35f, t);
                        position += (p.Velocity * age + .5f * Gravity * age * age * Vector2.down) * p.Cell;
                        break;
                }
                var renderer = p.Renderer;
                float pixels = size * p.Cell * p.Scale, bounds = renderer.sprite.bounds.size.x;
                renderer.transform.position = position;
                renderer.transform.localScale = Vector3.one * (pixels / bounds);
                renderer.transform.rotation = Quaternion.Euler(0, 0, p.Angle + p.Spin * age);
                var tint = p.Tint; tint.a *= alpha; renderer.color = tint;
            }
        }

        // Drops every live effect, for a board that is being rebuilt or recovered.
        public void Clear()
        {
            foreach (var p in live) p.Renderer.gameObject.SetActive(false);
            live.Clear();
        }
    }
}
