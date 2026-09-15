using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using ZKube.Presentation;

namespace ZKube.Editor
{
    public static class ZKubeBoardScene
    {
        public const string Path = "Assets/ZKube/Scenes/Board.unity";
        // Root executes under the shared Editor lock after generated art Prepare.
        // Production gets the view and provider binding; the conditional harness
        // attaches at runtime only in Editor/evidence builds, never in this scene.
        [MenuItem("ZKube/Create Balam Board Scene")]
        public static void Create()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Balam Board", typeof(BoardController));
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
            EditorSceneManager.SaveScene(scene, Path);
            Debug.Log("Created Balam board scene. Root controls build scene registration: " + Path);
        }
    }
}
