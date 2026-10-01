using UnityEngine;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // The phones the pages are tested on, each with the safe area its device
    // reports while the game runs full screen (status and navigation bars
    // hidden, the display cutout kept), as measured on the offline emulator:
    // a 136 px cutout, 68 dp at 360 x 640 and 47 dp at the Seeker's 1200 x 2670.
    // An Editor pass on these frames stands for a device pass.
    public static class Phones
    {
        public const float CompactTopInsetDp = 68, SeekerTopInsetDp = 47;
        public static readonly Rect CompactScreen = new Rect(0, 0, 360, 640), SeekerScreen = new Rect(0, 0, 417, 929);

        // A 360 x 640 dp phone, its safe area 360 x 572 dp.
        public static void Compact(PageShell shell, float density = 1) => Use(shell, CompactScreen, CompactTopInsetDp, density);
        // The Seeker, 417 x 929 dp, its safe area 417 x 882 dp.
        public static void Seeker(PageShell shell, float density = 1) => Use(shell, SeekerScreen, SeekerTopInsetDp, density);
        // The v3 wireframes' Seeker frame, 400 x 890 dp with its safe area 47 dp down:
        // the frame the wireframe geometry is measured on.
        public static readonly Rect WireframeScreen = new Rect(0, 0, 400, 890);
        public static void WireframeSeeker(PageShell shell, float density = 1) => Use(shell, WireframeScreen, SeekerTopInsetDp, density);
        // The emulator's default phone, 1080 x 2340 px at 440 dpi (392.7 x 850.9 dp),
        // its safe area about 392 x 760 dp: the 136 px cutout above and the
        // navigation bar's 41.5 dp below, the tightest it reports.
        public const float EmulatorTopInsetDp = 49.5f, EmulatorBottomInsetDp = 41.5f;
        public static readonly Rect EmulatorScreen = new Rect(0, 0, 392.7f, 850.9f);
        public static void EmulatorDefault(PageShell shell, float density = 1) => Use(shell, EmulatorScreen, EmulatorTopInsetDp, density, EmulatorBottomInsetDp);
        // A phone of a given width in dp with the compact phone's height and inset.
        public static void CompactOfWidth(PageShell shell, float widthDp, float density = 1) =>
            Use(shell, new Rect(0, 0, widthDp, CompactScreen.height), CompactTopInsetDp, density);

        private static void Use(PageShell shell, Rect screenDp, float topInsetDp, float density, float bottomInsetDp = 0)
        {
            var screen = new Rect(screenDp.x * density, screenDp.y * density, screenDp.width * density, screenDp.height * density);
            shell.Simulate(screen, new Rect(screen.x, screen.y + bottomInsetDp * density, screen.width, screen.height - (topInsetDp + bottomInsetDp) * density));
        }
        public static void Clear(PageShell shell) => shell.EndSimulation();
    }
}
