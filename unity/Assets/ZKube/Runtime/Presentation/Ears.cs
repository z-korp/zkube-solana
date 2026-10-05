using UnityEngine;

namespace ZKube.Presentation
{
    // The app's one listener, made before the first scene and kept for the
    // life of the process: every source is heard, the pages' and a board's
    // alike, whichever was made first and whichever is on screen.
    public static class Ears
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Listen() => Object.DontDestroyOnLoad(new GameObject("Ears", typeof(AudioListener)));
    }
}
