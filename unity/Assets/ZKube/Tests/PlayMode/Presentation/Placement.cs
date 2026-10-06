using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // The placement rule (owner, 2026-10-06), checked on a drawn page. A page is
    // three bands: the top says where you are, the middle shows, the bottom does.
    // Every control carries the role the kit placed it by, and a role has one
    // place:
    //   Back         top left, in the title row, 48 dp, alone there
    //   foot row     Primary, Secondary, Tertiary, Destructive: under everything
    //                the page shows, in that reading order, in two rows at most,
    //                one primary a page, 48 dp tall or more
    //   Step         the two arrows of one bar, the lowest row, at its ends
    //   Tab          the bottom edge
    //   Skip         a lesson's, top right, 48 dp tall
    //   Anywhere     a scene's tap: the whole screen
    //   the rest     in the middle band, under the title row
    // A control without a role was placed by its page, which the rule forbids.
    public static class Placement
    {
        private static readonly ScreenKit.Role[] Foot = { ScreenKit.Role.Primary, ScreenKit.Role.Secondary, ScreenKit.Role.Tertiary, ScreenKit.Role.Destructive };

        // What a finger can land on: the control's rect and what its face reaches past it.
        private static Rect Reach(Button button)
        {
            var rect = SkinUi.ScreenRect((RectTransform)button.transform);
            if (!(button.targetGraphic is Graphic face)) return rect;
            var past = face.raycastPadding; float scale = button.transform.lossyScale.x;
            return new Rect(rect.x + past.x * scale, rect.y + past.y * scale, rect.width - (past.x + past.z) * scale, rect.height - (past.y + past.w) * scale);
        }
        // What scrolls (a page taller than its phone, a board's rows inside their card) shows
        // its controls through its window: one the window cuts or hides is not on the page as
        // it stands. A page that scrolls is checked at its top and at its foot, so each of its
        // controls is checked where it is whole.
        private static bool Hidden(Button button)
        {
            var rect = SkinUi.ScreenRect((RectTransform)button.transform);
            for (var window = button.GetComponentInParent<RectMask2D>(); window != null;
                window = window.transform.parent == null ? null : window.transform.parent.GetComponentInParent<RectMask2D>())
            {
                var shown = SkinUi.ScreenRect(window.rectTransform);
                if (rect.yMin < shown.yMin - .5f || rect.yMax > shown.yMax + .5f || rect.xMin < shown.xMin - .5f || rect.xMax > shown.xMax + .5f) return true;
            }
            return false;
        }

        public static void Check(Transform page, Rect safe, float density, string at)
        {
            var controls = page.GetComponentsInChildren<Button>().Where(button => button.gameObject.activeInHierarchy)
                .Select(button => (button, rect: Reach(button), placed: button.GetComponent<Placed>())).ToList();
            Assert.That(controls, Is.Not.Empty, at + ": the page has controls");
            var unplaced = controls.Where(control => control.placed == null).Select(control => control.button.name).ToArray();
            Assert.That(unplaced, Is.Empty, at + ": placed by the page itself, with no role");
            controls.RemoveAll(control => Hidden(control.button));
            // A scene's tap takes the whole screen, under everything the scene shows.
            foreach (var control in controls.Where(control => control.placed.Role == ScreenKit.Role.Anywhere))
                Assert.That(control.rect.xMin <= safe.xMin + .5f && control.rect.xMax >= safe.xMax - .5f && control.rect.yMin <= safe.yMin + .5f && control.rect.yMax >= safe.yMax - .5f,
                    Is.True, at + ": " + control.button.name + " " + control.rect + " takes the whole screen");
            controls.RemoveAll(control => control.placed.Role == ScreenKit.Role.Anywhere);
            List<(Button button, Rect rect)> Of(params ScreenKit.Role[] roles) =>
                controls.Where(control => roles.Contains(control.placed.Role)).Select(control => (control.button, control.rect)).ToList();
            float dp48 = 48 * density - .5f;
            string Name((Button button, Rect rect) control) => control.button.name + " " + control.rect;

            // Back: one, top left, 48 dp, its top on the page's edge under the safe top.
            var back = Of(ScreenKit.Role.Back);
            Assert.That(back.Count, Is.LessThanOrEqualTo(1), at + ": one Back");
            float titleRow = float.PositiveInfinity;
            if (back.Count == 1)
            {
                var rect = back[0].rect; titleRow = rect.yMin;
                Assert.That(rect.width >= dp48 && rect.height >= dp48, Is.True, at + ": Back reaches 48 dp, " + rect);
                Assert.That(rect.xMax, Is.LessThan(safe.center.x - safe.width / 4), at + ": Back is top left, " + rect);
                Assert.That(rect.yMax, Is.InRange(safe.yMax - (ScreenKit.TopClearDp + 1) * density, safe.yMax + .5f), at + ": Back hangs from the page's edge, " + rect);
            }
            // A page titled at its top without a Back keeps its controls under the title too.
            var plates = page.GetComponentsInChildren<Image>().Where(image => image.gameObject.activeInHierarchy && image.name == "Screen title plate")
                .Select(image => SkinUi.ScreenRect(image.rectTransform)).ToList();
            if (back.Count == 0 && plates.Count != 0 && controls.All(control => control.rect.yMax <= plates.Max(plate => plate.yMax) + .5f)) titleRow = plates.Min(plate => plate.yMin);
            // The top band is Back's and a lesson's Skip: every other control stands under the title row
            // (a chip's 48 dp reach may pass its card's edge; where the control stands is its middle).
            foreach (var control in controls.Where(control => control.placed.Role != ScreenKit.Role.Back && control.placed.Role != ScreenKit.Role.Skip))
                Assert.That(control.rect.center.y, Is.LessThanOrEqualTo(titleRow + .5f), at + ": " + control.button.name + " " + control.rect + " is in the top band");

            // Skip: a lesson's way out, top right, hanging from the page's edge like Back.
            foreach (var skip in Of(ScreenKit.Role.Skip))
            {
                Assert.That(skip.rect.height, Is.GreaterThanOrEqualTo(dp48), at + ": " + Name(skip) + " is 48 dp tall");
                Assert.That(skip.rect.xMin, Is.GreaterThan(safe.center.x + safe.width / 4), at + ": Skip is top right, " + skip.rect);
                Assert.That(skip.rect.yMax, Is.InRange(safe.yMax - (ScreenKit.TopClearDp + 1) * density, safe.yMax + .5f), at + ": Skip hangs from the page's edge, " + skip.rect);
            }

            // Tabs: on the bottom edge, under everything else.
            var tabs = Of(ScreenKit.Role.Tab);
            float tabTop = tabs.Count == 0 ? float.NegativeInfinity : tabs.Max(tab => tab.rect.yMax);
            foreach (var control in controls.Where(control => control.placed.Role != ScreenKit.Role.Tab))
                Assert.That(control.rect.yMin, Is.GreaterThanOrEqualTo(tabTop - .5f), at + ": " + control.button.name + " " + control.rect + " is under the tab bar's top " + tabTop);

            // The stepper: two arrows of one bar, 48 dp each, the lowest row on the tab bar.
            var steps = Of(ScreenKit.Role.Step).OrderBy(step => step.rect.x).ToList();
            float stepperTop = float.NegativeInfinity;
            if (steps.Count != 0)
            {
                Assert.That(steps.Count, Is.EqualTo(2), at + ": a stepper has its two arrows, whatever can be stepped");
                Assert.That(steps[0].rect.y, Is.EqualTo(steps[1].rect.y).Within(.5f), at + ": the arrows share one bar");
                foreach (var step in steps) Assert.That(step.rect.width >= dp48 && step.rect.height >= dp48, Is.True, at + ": " + Name(step) + " reaches 48 dp");
                Assert.That(steps[0].rect.xMax, Is.LessThan(safe.center.x - safe.width / 4), at + ": the first arrow is at the bar's left end");
                Assert.That(steps[1].rect.xMin, Is.GreaterThan(safe.center.x + safe.width / 4), at + ": the second arrow is at the bar's right end");
                // Nothing stands under the stepper's row. The foot may share it, between the arrows
                // (the map, whose path needs a bar's height); everything else is over it.
                stepperTop = steps.Max(step => step.rect.yMax); float stepperFoot = steps.Min(step => step.rect.yMin);
                foreach (var control in controls.Where(control => control.placed.Role != ScreenKit.Role.Tab && control.placed.Role != ScreenKit.Role.Step))
                {
                    bool between = Foot.Contains(control.placed.Role) && control.rect.xMin >= steps[0].rect.xMax - .5f && control.rect.xMax <= steps[1].rect.xMin + .5f;
                    Assert.That(control.rect.yMin, Is.GreaterThanOrEqualTo((between ? stepperFoot - (control.rect.height - steps[0].rect.height) : stepperTop) - .5f),
                        at + ": " + control.button.name + " " + control.rect + " is under the stepper, the lowest row");
                }
            }

            // The foot row: one primary, under all the page shows, read in its order, never three rows.
            var foot = Of(Foot);
            Assert.That(Of(ScreenKit.Role.Primary).Count, Is.LessThanOrEqualTo(1), at + ": one primary a page");
            if (foot.Count != 0)
            {
                float footTop = foot.Max(control => control.rect.yMax);
                foreach (var control in controls.Where(control => !Foot.Contains(control.placed.Role) && control.placed.Role != ScreenKit.Role.Tab && control.placed.Role != ScreenKit.Role.Step &&
                    control.placed.Role != ScreenKit.Role.Back && control.placed.Role != ScreenKit.Role.Skip))
                    Assert.That(control.rect.yMin, Is.GreaterThanOrEqualTo(footTop - .5f), at + ": " + control.button.name + " " + control.rect + " is beside or under the foot row, whose top is " + footTop);
                foreach (var control in foot) Assert.That(control.rect.height, Is.GreaterThanOrEqualTo(dp48), at + ": " + Name(control) + " is 48 dp tall");
                var rows = foot.GroupBy(control => Mathf.Round(control.rect.center.y)).OrderByDescending(row => row.Key).ToList();
                Assert.That(rows.Count, Is.LessThanOrEqualTo(2), at + ": the foot never takes three rows");
                var read = rows.SelectMany(row => row.OrderBy(control => control.rect.x)).Select(control => control.button.GetComponent<Placed>().Role).ToArray();
                Assert.That(read, Is.EqualTo(read.OrderBy(role => System.Array.IndexOf(Foot, role)).ToArray()), at + ": the foot reads primary, secondary, tertiary, the destructive one last");
                for (int i = 0; i < foot.Count; i++) for (int j = i + 1; j < foot.Count; j++)
                    Assert.That(foot[i].rect.Overlaps(foot[j].rect), Is.False, at + ": " + Name(foot[i]) + " and " + Name(foot[j]) + " overlap");
            }
            // Everything a finger lands on reaches 48 dp one way at least.
            foreach (var control in controls)
                Assert.That(Mathf.Max(control.rect.width, control.rect.height), Is.GreaterThanOrEqualTo(dp48), at + ": " + control.button.name + " " + control.rect + " reaches 48 dp");
        }
    }
}
