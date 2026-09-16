using System;
using System.IO;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using ZKube.Integration.App;
using ZKube.Local.App;
using ZKube.Presentation;

namespace ZKube.Editor
{
    public static class ZKubeAppScene
    {
        public const string Path = "Assets/ZKube/Scenes/App.unity";
        public static void Create(string identity)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var root = new GameObject("zKube");
            var startup = root.AddComponent<AppStartup>();
            AppIdentity product;
            if (identity == "store") product = root.AddComponent<StoreIdentity>();
            else if (identity == "money")
            {
                var money = root.AddComponent<MoneyIdentity>();
                money.Configuration = new MoneyConfiguration {
                    SolanaSchema = Load<TextAsset>("Assets/ZKube/Integration/Generated/solana.json"),
                    SessionSchema = Load<TextAsset>("Assets/ZKube/Integration/Generated/session.json") };
                product = money;
            }
            else throw new ArgumentException("Unknown application identity", nameof(identity));
            startup.Configuration = new AppStartupConfiguration { Identity = product,
                DisplayFont = Load<TMP_FontAsset>("Assets/ZKube/Art/Generated/Resources/ZKube/Fonts/LilitaOne-Regular.asset"),
                BodyFont = Load<TMP_FontAsset>("Assets/ZKube/Art/Generated/Resources/ZKube/Fonts/Outfit-Regular.asset") };
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
            if (!EditorSceneManager.SaveScene(scene, Path)) throw new IOException("Could not save the application scene");
        }
        private static T Load<T>(string path) where T : UnityEngine.Object =>
            AssetDatabase.LoadAssetAtPath<T>(path) ?? throw new InvalidOperationException("Missing application asset: " + path);
    }
}
