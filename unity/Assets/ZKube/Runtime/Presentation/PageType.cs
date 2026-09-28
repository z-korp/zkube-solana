using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace ZKube.Presentation
{
    // The Lumen type roles the pages set: Fraunces for titles, Nunito at the
    // weight of its role for everything else. Sizes are the caller's, in dp.
    public enum TypeRole { Title, Number, Button, Body, Caption, Label }

    public sealed class PageType : IDisposable
    {
        private readonly SkinUi ui;
        private readonly Dictionary<TypeRole, TMP_FontAsset> fonts = new Dictionary<TypeRole, TMP_FontAsset>();
        private readonly Dictionary<TMP_FontAsset, Material> shadows = new Dictionary<TMP_FontAsset, Material>();

        public PageType(SkinUi skin) { ui = skin ?? throw new ArgumentNullException(nameof(skin)); }

        public TMP_FontAsset Font(TypeRole role)
        {
            if (fonts.TryGetValue(role, out var font)) return font;
            string name = role == TypeRole.Title ? "Fraunces-650" : role == TypeRole.Body ? "Nunito-700" :
                role == TypeRole.Caption ? "Nunito-800" : role == TypeRole.Label ? "Nunito-900" : "Nunito-1000";
            font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + name) ?? throw new InvalidOperationException("Prepare the bundled font " + name);
            fonts.Add(role, font);
            return font;
        }

        public TMP_Text Label(string name, string value, Rect rect, TypeRole role, float sizeDp, string token, Transform parent,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center)
        {
            var text = ui.Label(name, value, rect, sizeDp, token, parent, role == TypeRole.Title, alignment);
            Apply(text, role);
            return text;
        }

        // Titles track 2% open and labels 9%, in capitals; text casts a soft
        // shadow and never glows.
        public void Apply(TMP_Text text, TypeRole role)
        {
            var font = Font(role);
            text.font = font; text.fontSharedMaterial = Shadow(font);
            text.characterSpacing = role == TypeRole.Label ? 9 : role == TypeRole.Title ? 2 : 0;
            text.fontStyle = role == TypeRole.Label ? FontStyles.UpperCase : FontStyles.Normal;
        }

        public float Height(string value, float width, TypeRole role, float sizeDp)
        {
            var probe = Probe(role, sizeDp);
            try { return Mathf.Ceil(probe.GetPreferredValues(value, width, float.PositiveInfinity).y) + 2 * ui.Density; }
            finally { UnityEngine.Object.Destroy(probe.gameObject); }
        }
        public float Width(string value, TypeRole role, float sizeDp)
        {
            var probe = Probe(role, sizeDp);
            try { return Mathf.Ceil(probe.GetPreferredValues(value, float.PositiveInfinity, float.PositiveInfinity).x) + 2 * ui.Density; }
            finally { UnityEngine.Object.Destroy(probe.gameObject); }
        }
        private TextMeshProUGUI Probe(TypeRole role, float sizeDp)
        {
            var go = new GameObject("Temporary type measurement", typeof(RectTransform), typeof(TextMeshProUGUI));
            go.hideFlags = HideFlags.HideAndDontSave;
            var text = go.GetComponent<TextMeshProUGUI>();
            text.enableAutoSizing = false; text.textWrappingMode = TextWrappingModes.Normal;
            Apply(text, role); text.fontSize = sizeDp * ui.Density * ui.Scale;
            return text;
        }

        private Material Shadow(TMP_FontAsset font)
        {
            if (shadows.TryGetValue(font, out var material)) return material;
            material = new Material(font.material) { name = font.name + " page shadow" };
            material.EnableKeyword(ShaderUtilities.Keyword_Underlay);
            material.SetColor(ShaderUtilities.ID_UnderlayColor, new Color(0, .02f, .05f, .55f));
            material.SetFloat(ShaderUtilities.ID_UnderlayOffsetY, -.6f);
            material.SetFloat(ShaderUtilities.ID_UnderlaySoftness, .35f);
            shadows.Add(font, material);
            return material;
        }

        public void Dispose()
        {
            foreach (var material in shadows.Values) UnityEngine.Object.Destroy(material);
            shadows.Clear(); fonts.Clear();
        }
    }
}
