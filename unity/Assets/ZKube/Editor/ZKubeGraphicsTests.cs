using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace ZKube.Editor
{
    public static class ZKubeGraphicsTests
    {
        private const BindingFlags Members = BindingFlags.Public | BindingFlags.NonPublic |
                                             BindingFlags.Instance | BindingFlags.Static | BindingFlags.FlattenHierarchy;
        public static void Configure()
        {
            if (Application.isBatchMode) throw new InvalidOperationException("Rendered board tests require the graphics Editor");
            SetViewport(430, 932);
        }

        private static void SetViewport(int width, int height)
        {
            if (width < 240 || height < 240 || width > 4096 || height > 4096)
                throw new ArgumentOutOfRangeException(nameof(width));
            // Unity exposes no public fixed Game-view size API. These Editor
            // members are isolated here and checked against the pinned Editor:
            // https://github.com/Unity-Technologies/UnityCsReference/tree/master/Editor/Mono/GameView
            var assembly = typeof(EditorWindow).Assembly;
            var sizesType = assembly.GetType("UnityEditor.GameViewSizes", true);
            var sizes = sizesType.GetProperty("instance", Members).GetValue(null);
            var groupType = sizesType.GetProperty("currentGroupType", Members).GetValue(sizes);
            var group = sizesType.GetMethod("GetGroup", Members).Invoke(sizes, new[] { groupType });
            var groupClass = group.GetType();
            int count = (int)groupClass.GetMethod("GetTotalCount", Members).Invoke(group, null);
            int selected = -1;
            for (int index = 0; index < count; index++)
            {
                var size = groupClass.GetMethod("GetGameViewSize", Members).Invoke(group, new object[] { index });
                if ((int)size.GetType().GetProperty("width", Members).GetValue(size) == width &&
                    (int)size.GetType().GetProperty("height", Members).GetValue(size) == height &&
                    size.GetType().GetProperty("sizeType", Members).GetValue(size).ToString() == "FixedResolution")
                { selected = index; break; }
            }
            if (selected < 0)
            {
                var fixedSize = Enum.Parse(assembly.GetType("UnityEditor.GameViewSizeType", true), "FixedResolution");
                var size = Activator.CreateInstance(assembly.GetType("UnityEditor.GameViewSize", true),
                    new[] { fixedSize, (object)width, height, "zKube tests" });
                groupClass.GetMethod("AddCustomSize", Members).Invoke(group, new[] { size });
                selected = count;
            }
            var viewType = assembly.GetType("UnityEditor.GameView", true);
            var view = EditorWindow.GetWindow(viewType);
            viewType.GetProperty("selectedSizeIndex", Members).SetValue(view, selected);
            view.Show(); view.Focus(); view.Repaint();
        }
    }
}
