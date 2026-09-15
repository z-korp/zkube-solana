#if UNITY_EDITOR || ZKUBE_EVIDENCE
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace ZKube.Presentation.Evidence
{
    // Shared rendered-input path for both offline evidence surfaces. Screen
    // hit testing, drag events and click interception follow ordinary UI input.
    public static class EvidencePointer
    {
        public static IEnumerator Drag(Vector2 from, Vector2 to, Action<string, Vector2, GameObject> record = null)
        {
            var e = new PointerEventData(EventSystem.current) { pointerId = -1, position = from, pressPosition = from, button = PointerEventData.InputButton.Left };
            var hit = Raycast(e);
            record?.Invoke("pointer-down-before", from, hit.gameObject);
            e.pointerCurrentRaycast = hit; e.pointerPressRaycast = hit;
            var press = ExecuteEvents.ExecuteHierarchy(hit.gameObject, e, ExecuteEvents.pointerDownHandler);
            record?.Invoke("pointer-down-after", from, hit.gameObject);
            var drag = ExecuteEvents.GetEventHandler<IDragHandler>(hit.gameObject);
            if (drag == null) throw new InvalidOperationException("No drag handler at evidence screen position " + from);
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
                record?.Invoke("drag-before", e.position, e.pointerCurrentRaycast.gameObject);
                ExecuteEvents.Execute(drag, e, ExecuteEvents.dragHandler);
                record?.Invoke("drag-after", e.position, e.pointerCurrentRaycast.gameObject); yield return null;
            }
            ExecuteEvents.Execute(press, e, ExecuteEvents.pointerUpHandler);
            ExecuteEvents.Execute(drag, e, ExecuteEvents.endDragHandler);
            record?.Invoke("drag-end", e.position, drag);
        }
        public static void Click(Button button, Action<string, Vector2, GameObject> record = null)
        {
            if (button == null || !button.isActiveAndEnabled || !button.interactable)
                throw new InvalidOperationException("Evidence requires an available button");
            Canvas.ForceUpdateCanvases();
            var rect = button.GetComponent<RectTransform>();
            Tap(RectTransformUtility.WorldToScreenPoint(null, rect.TransformPoint(rect.rect.center)), button.gameObject, record);
        }
        public static void Tap(Vector2 screen, GameObject expected = null, Action<string, Vector2, GameObject> record = null)
        {
            var e = new PointerEventData(EventSystem.current) { pointerId = -1, position = screen, pressPosition = screen, button = PointerEventData.InputButton.Left };
            var hit = Raycast(e); e.pointerCurrentRaycast = hit; e.pointerPressRaycast = hit;
            record?.Invoke("tap-before", screen, hit.gameObject);
            var click = ExecuteEvents.GetEventHandler<IPointerClickHandler>(hit.gameObject);
            if (expected != null && click != expected)
                throw new InvalidOperationException("Screen tap is intercepted before " + expected.name + " by " + hit.gameObject.name);
            var press = ExecuteEvents.ExecuteHierarchy(hit.gameObject, e, ExecuteEvents.pointerDownHandler);
            if (press != null) ExecuteEvents.Execute(press, e, ExecuteEvents.pointerUpHandler);
            if (click != null) ExecuteEvents.Execute(click, e, ExecuteEvents.pointerClickHandler);
            record?.Invoke("tap-after", screen, hit.gameObject);
        }
        private static RaycastResult Raycast(PointerEventData e)
        {
            Canvas.ForceUpdateCanvases();
            var hits = new List<RaycastResult>(); EventSystem.current.RaycastAll(e, hits);
            if (hits.Count == 0) throw new InvalidOperationException("No UI target at evidence screen position " + e.position);
            return hits[0];
        }
    }
}
#endif
