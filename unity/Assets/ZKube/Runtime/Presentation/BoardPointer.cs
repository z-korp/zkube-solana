using UnityEngine;
using UnityEngine.EventSystems;

namespace ZKube.Presentation
{
    // Pointer coordinates are the same pixels used by BoardLayout. The drag
    // threshold belongs to input, never to native collision or movement rules.
    public sealed class BoardPointer : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler, ICancelHandler
    {
        public BoardController Owner;
        public void OnPointerDown(PointerEventData e) => Owner.BeginDrag(e.pointerId, e.position);
        public void OnDrag(PointerEventData e) => Owner.Drag(e.pointerId, e.position);
        public void OnPointerUp(PointerEventData e) => Owner.EndDrag(e.pointerId, e.position);
        public void OnCancel(BaseEventData e) => Owner.CancelDrag();
        private void OnDisable() { if (Owner != null) Owner.CancelDrag(); }
    }
}
