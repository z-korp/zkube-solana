using System.IO;
using UnityEditor.SceneManagement;
using UnityEngine;
using ZKube.Local.App;

namespace ZKube.Editor
{
    public static class ZKubeStoreScene
    {
        public const string Path = "Assets/ZKube/Scenes/Store.unity";
        public static void Create()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("zKube Store", typeof(StoreStartup));
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
            EditorSceneManager.SaveScene(scene, Path);
        }
    }
}
