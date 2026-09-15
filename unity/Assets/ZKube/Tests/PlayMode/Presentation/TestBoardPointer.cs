using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    // Screen hit testing and event dispatch exercise ordinary UI input.
    public static class TestBoardPointer
    {
        public static IEnumerator Drag(Vector2 from, Vector2 to)
        {
            var e = new PointerEventData(EventSystem.current) { pointerId = -1, position = from, pressPosition = from, button = PointerEventData.InputButton.Left };
            var hit = Raycast(e);
            e.pointerCurrentRaycast = hit; e.pointerPressRaycast = hit;
            var press = ExecuteEvents.ExecuteHierarchy(hit.gameObject, e, ExecuteEvents.pointerDownHandler);
            var drag = ExecuteEvents.GetEventHandler<IDragHandler>(hit.gameObject);
            if (drag == null) throw new InvalidOperationException("No drag handler at screen position " + from);
            e.pointerPress = press; e.pointerDrag = drag;
            ExecuteEvents.Execute(drag, e, ExecuteEvents.initializePotentialDrag);
            ExecuteEvents.Execute(drag, e, ExecuteEvents.beginDragHandler);
            yield return null; // Render the immediate press selection before moving.
            for (int i = 1; i <= 6; i++)
            {
                var previous = e.position;
                e.position = Vector2.Lerp(from, to, i / 6f);
                e.delta = e.position - previous;
                e.pointerCurrentRaycast = Raycast(e);
                ExecuteEvents.Execute(drag, e, ExecuteEvents.dragHandler);
                yield return null;
            }
            ExecuteEvents.Execute(press, e, ExecuteEvents.pointerUpHandler);
            ExecuteEvents.Execute(drag, e, ExecuteEvents.endDragHandler);
        }
        public static void Click(Button button)
        {
            if (button == null || !button.isActiveAndEnabled || !button.interactable)
                throw new InvalidOperationException("Input requires an available button");
            Canvas.ForceUpdateCanvases();
            var rect = button.GetComponent<RectTransform>();
            Tap(RectTransformUtility.WorldToScreenPoint(null, rect.TransformPoint(rect.rect.center)), button.gameObject);
        }
        public static void Tap(Vector2 screen, GameObject expected = null)
        {
            var e = new PointerEventData(EventSystem.current) { pointerId = -1, position = screen, pressPosition = screen, button = PointerEventData.InputButton.Left };
            var hit = Raycast(e); e.pointerCurrentRaycast = hit; e.pointerPressRaycast = hit;
            var click = ExecuteEvents.GetEventHandler<IPointerClickHandler>(hit.gameObject);
            if (expected != null && click != expected)
                throw new InvalidOperationException("Screen tap is intercepted before " + expected.name + " by " + hit.gameObject.name);
            var press = ExecuteEvents.ExecuteHierarchy(hit.gameObject, e, ExecuteEvents.pointerDownHandler);
            if (press != null) ExecuteEvents.Execute(press, e, ExecuteEvents.pointerUpHandler);
            if (click != null) ExecuteEvents.Execute(click, e, ExecuteEvents.pointerClickHandler);
        }
        private static RaycastResult Raycast(PointerEventData e)
        {
            Canvas.ForceUpdateCanvases();
            var hits = new List<RaycastResult>(); EventSystem.current.RaycastAll(e, hits);
            if (hits.Count == 0) throw new InvalidOperationException("No UI target at screen position " + e.position);
            return hits[0];
        }
    }
}
