// Minimal stand-ins for the UnityEngine surface that Integration code touches
// when compiled off-Editor. Included by harness.py unless --no-unity-shim.
using System;

namespace UnityEngine
{
    public static class Application
    {
        public static string dataPath =>
            Environment.GetEnvironmentVariable("ZKUBE_UNITY_DATA_PATH")
            ?? throw new InvalidOperationException("ZKUBE_UNITY_DATA_PATH is not set; run through unity/tools/harness.py");
    }
}
