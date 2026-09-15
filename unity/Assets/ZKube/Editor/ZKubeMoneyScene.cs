using System;
using System.IO;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using ZKube.Integration.App;

namespace ZKube.Editor
{
    public static class ZKubeMoneyScene
    {
        public const string Path = "Assets/ZKube/Scenes/Money.unity";
        public const string EvidencePath = "Assets/ZKube/Scenes/MoneyEvidence.unity";

        public static void Configure(MoneyStartup startup)
        {
            // Canonical schema assets are scene dependencies, not Resources
            // copies that could enter the separate store build.
            startup.Configure(Load<TextAsset>("Assets/ZKube/Integration/Generated/solana.json"),
                Load<TextAsset>("Assets/ZKube/Integration/Generated/session.json"),
                Load<TMP_FontAsset>("Assets/ZKube/Art/Generated/Resources/ZKube/Fonts/LilitaOne-Regular.asset"),
                Load<TMP_FontAsset>("Assets/ZKube/Art/Generated/Resources/ZKube/Fonts/Outfit-Regular.asset"));
            // Deployment configuration deliberately remains unset. Evidence
            // uses its own explicit scene and never replaces a failed connection.
        }

        public static void Create()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Money input", typeof(EventSystem), typeof(StandaloneInputModule));
            Configure(new GameObject("zKube Money", typeof(MoneyStartup)).GetComponent<MoneyStartup>());
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
            if (!EditorSceneManager.SaveScene(scene, Path)) throw new IOException("Could not save the money scene");
        }

        public static void CreateEvidence()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Money evidence input", typeof(EventSystem), typeof(StandaloneInputModule));
            var source = new GameObject("Inactive money startup template");
            source.SetActive(false);
            var template = source.AddComponent<MoneyStartup>();
            Configure(template);
            var host = new GameObject("Explicit offline money evidence", typeof(MoneyOverviewEvidenceHost))
                .GetComponent<MoneyOverviewEvidenceHost>();
            host.Configure(template);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(EvidencePath));
            if (!EditorSceneManager.SaveScene(scene, EvidencePath)) throw new IOException("Could not save the money evidence scene");
        }

        private static T Load<T>(string path) where T : UnityEngine.Object
            => AssetDatabase.LoadAssetAtPath<T>(path) ?? throw new InvalidOperationException("Missing money scene asset: " + path);
    }
}
